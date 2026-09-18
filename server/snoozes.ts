import { Store } from './store.js';

// Scheduling belongs to Herts, so it runs with the app closed and Hermes offline.
// Recheck at least once a minute to handle wall-clock changes; recover overdue
// tasks on startup. The store commits each return and notification atomically.
export class Snoozes {
  private timer?: NodeJS.Timeout;
  private closed = false;
  private changed = () => this.schedule();
  constructor(private store: Store) { store.on('change', this.changed); this.tick(); }
  private tick = () => {
    if (this.closed) return;
    try { this.store.wakeSnoozed(); }
    finally { this.schedule(); }
  };
  private schedule() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const next = this.store.snapshot().tasks.filter(t => t.status === 'snoozed' && t.snoozedUntil).reduce((at,t) => Math.min(at,t.snoozedUntil!), Infinity);
    this.timer = setTimeout(this.tick, Math.max(1, Math.min(60_000, next - Date.now())));
    this.timer.unref();
  }
  close() { this.closed = true; clearTimeout(this.timer); this.store.off('change', this.changed); }
}
