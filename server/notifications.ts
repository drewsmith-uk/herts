import webpush from 'web-push';
import { z } from 'zod';
import { Store, digest } from './store.js';
import type { PushStatus, PushTest } from '../shared/notifications.js';

const subscriptionSchema = z.object({
  endpoint: z.url().max(4096), expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(1024), auth: z.string().min(1).max(1024) })
});
interface SubscriptionRow { id: string; data: string; created_at: number; invalid: number; last_error: string | null; last_accepted: number | null }
const invalidRequest = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export class Notifications {
  keys: { publicKey: string; privateKey: string }; timer: NodeJS.Timeout; running = false;
  private onNotice = () => { void this.flush(); };
  constructor(public store: Store, private subject = 'https://localhost') {
    this.keys = store.getMeta('vapid') || webpush.generateVAPIDKeys(); store.setMeta('vapid', this.keys);
    store.on('notice', this.onNotice); this.timer = setInterval(this.onNotice, 30_000);
  }
  subscribe(input: unknown) {
    const subscription = subscriptionSchema.parse(input), endpoint = new URL(subscription.endpoint);
    const permitted = ['googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || (endpoint.port && endpoint.port !== '443') || !permitted.some(d => endpoint.hostname === d || endpoint.hostname.endsWith(`.${d}`))) throw invalidRequest('Unsupported push service.');
    const id = digest(subscription.endpoint);
    if (this.row(id)?.invalid) throw invalidRequest('This notification registration has expired. Repair notifications on this device.', 409);
    // Re-registering the same device preserves its delivery history. A new device
    // receives future alerts, not a burst of yesterday's completed work.
    this.store.db.prepare('INSERT INTO subscriptions(id,data,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(subscription), Date.now());
    return id;
  }
  private row(id: string) { return this.store.db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id) as SubscriptionRow | undefined; }
  status(endpoint: string): PushStatus {
    const row = this.row(digest(endpoint));
    return { registered: !!row && !row.invalid, needsRepair: !row || !!row.invalid, error: row?.last_error || undefined, lastAcceptedAt: row?.last_accepted || undefined };
  }
  unsubscribe(endpoint: string) { this.store.db.prepare('DELETE FROM subscriptions WHERE id=?').run(digest(endpoint)); }
  private async send(sub: SubscriptionRow, payload: { id: string; kind: string; taskTitle?: string }) {
    try {
      await webpush.sendNotification(JSON.parse(sub.data), JSON.stringify(payload), {
        TTL: payload.kind === 'approval' ? 60 : payload.kind === 'test' ? 120 : 3600, timeout: 10_000,
        vapidDetails: { subject: this.subject, ...this.keys }
      });
      this.store.db.prepare('UPDATE subscriptions SET last_error=NULL,last_accepted=? WHERE id=?').run(Date.now(), sub.id);
      return undefined;
    } catch (error: any) {
      const code = Number(error.statusCode), invalid = [404, 410].includes(code);
      // Never persist or log provider response bodies: these can contain endpoints
      // and credentials. Keep expired records so Settings can explain and repair them.
      const message = invalid ? 'This device’s notification registration has expired. Repair notifications to reconnect it.'
        : [401, 403].includes(code) ? `The push service rejected the app’s credentials (${code}).`
        : Number.isInteger(code) && code >= 400 && code <= 599 ? `The push service could not accept the notification (${code}).`
        : 'Could not reach the push service. Delivery is unconfirmed.';
      this.store.db.prepare('UPDATE subscriptions SET invalid=?,last_error=? WHERE id=?').run(invalid ? 1 : 0, message, sub.id);
      return message;
    }
  }
  async flush() {
    if (this.running) return; this.running = true;
    try {
      const notices = this.store.db.prepare('SELECT * FROM notices WHERE at>? ORDER BY at').all(Date.now() - 86_400_000) as any[];
      const subscriptions = this.store.db.prepare('SELECT * FROM subscriptions WHERE invalid=0').all() as SubscriptionRow[];
      const taskTitles = new Map<string, string>();
      for (const task of this.store.snapshot().tasks) {
        // Execution notices refer to conversation contexts; reminders use task IDs.
        // Use the local task title and keep even long Unicode titles within push limits.
        const chars = Array.from(task.title.replace(/\s+/g, ' ').trim());
        const title = chars.slice(0, 240).join('') + (chars.length > 240 ? '…' : '');
        taskTitles.set(task.id, title); if (task.contextId) taskTitles.set(task.contextId, title);
      }
      for (const sub of subscriptions) for (const notice of notices) {
        if (notice.at < sub.created_at) continue;
        this.store.db.prepare('INSERT OR IGNORE INTO deliveries(notice_id,subscription_id) VALUES (?,?)').run(notice.id, sub.id);
        const d = this.store.db.prepare('SELECT * FROM deliveries WHERE notice_id=? AND subscription_id=?').get(notice.id, sub.id) as any;
        if (d.delivered || d.attempts >= 5 || (notice.kind === 'approval' && Date.now() - notice.at > 300_000)) continue;
        // A device can be disabled while a previous push is in flight.
        const current = this.row(sub.id); if (!current || current.invalid) break;
        this.store.db.prepare('UPDATE deliveries SET attempts=attempts+1 WHERE notice_id=? AND subscription_id=?').run(notice.id, sub.id);
        const taskTitle = taskTitles.get(notice.task_id);
        const error = await this.send(current, { id: notice.id, kind: notice.kind, ...(taskTitle ? { taskTitle } : {}) });
        if (!error) this.store.db.prepare('UPDATE deliveries SET delivered=1 WHERE notice_id=? AND subscription_id=?').run(notice.id, sub.id);
        else break; // Retry later; don't hammer an expired or unavailable push service.
      }
    } finally { this.running = false; }
  }
  testStatus(id: string): PushTest | undefined {
    const row = this.store.db.prepare('SELECT data FROM notification_tests WHERE id=?').get(id) as any;
    return row && JSON.parse(row.data);
  }
  async test(endpoint: string, id: string): Promise<PushTest> {
    const subscriptionId = digest(endpoint), prior = this.store.db.prepare('SELECT * FROM notification_tests WHERE id=?').get(id) as any;
    if (prior) {
      if (prior.subscription_id !== subscriptionId) throw invalidRequest('This test belongs to another notification registration.', 409);
      return JSON.parse(prior.data); // A lost response must not submit another push.
    }
    const sub = this.row(subscriptionId);
    if (!sub || sub.invalid) throw invalidRequest('Repair notifications on this device before sending a test.', 409);
    this.store.db.prepare('INSERT INTO notification_tests VALUES (?,?,?)').run(id, subscriptionId, JSON.stringify({ id, state: 'sending' }));
    const error = await this.send(sub, { id, kind: 'test' });
    // The device acknowledgement may arrive before the push provider's response.
    const result: PushTest = { ...this.testStatus(id)!, state: error ? 'failed' : 'accepted', ...(error ? { error } : {}) };
    this.store.db.prepare('UPDATE notification_tests SET data=? WHERE id=?').run(JSON.stringify(result), id);
    return result;
  }
  confirmTest(id: string) {
    const test = this.testStatus(id);
    if (test && !test.shownAt) this.store.db.prepare('UPDATE notification_tests SET data=? WHERE id=?').run(JSON.stringify({ ...test, shownAt: Date.now() }), id);
  }
  close() { clearInterval(this.timer); this.store.off('notice', this.onNotice); }
}
