import { setImmediate } from 'node:timers/promises';
import { Conflict } from '../shared/core.js';
import { digest, type Store } from './store.js';

export const transcriptionRetentionMs = 24 * 60 * 60 * 1000;
export type TranscriptionInput = { id: string; uploadId: string };
const expired = () => Object.assign(new Error('This transcription was cleared. Your saved recording can be transcribed again.'), { statusCode: 410 });

/** Keep recovery results briefly; durable tombstones still prevent duplicate work. */
export class Transcriptions {
  constructor(private store: Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS transcriptions (id TEXT PRIMARY KEY, upload_id TEXT, expires_at INTEGER NOT NULL, discarded INTEGER NOT NULL DEFAULT 0)');
    store.db.exec('CREATE INDEX IF NOT EXISTS transcriptions_expiry ON transcriptions(expires_at) WHERE discarded=0');
  }
  private row(id: string) {
    return this.store.db.prepare('SELECT * FROM transcriptions WHERE id=?').get(id) as { id: string; upload_id: string | null; expires_at: number; discarded: number } | undefined;
  }
  read(input: TranscriptionInput) {
    const prior = this.store.receipt(input.id, input);
    const row = this.row(input.id);
    if (row?.discarded || row && row.expires_at <= Date.now()) { this.discard(input); throw expired(); }
    if (prior?.discarded) throw expired();
    return prior as { transcript: string } | undefined;
  }
  begin(input: TranscriptionInput) {
    if (this.row(input.id) || this.store.getMeta(`audio:${input.id}`)) throw new Conflict('Transcription outcome is unconfirmed. Retry explicitly with a new request.');
    this.store.db.transaction(() => {
      this.store.db.prepare('INSERT INTO transcriptions VALUES (?,?,?,0)').run(input.id, input.uploadId, Date.now() + transcriptionRetentionMs);
      this.store.setMeta(`audio:${input.id}`, true);
    })();
  }
  finish(input: TranscriptionInput, transcript: string) {
    if (this.row(input.id)?.discarded) throw expired();
    const result = { transcript };
    this.store.saveReceipt(input.id, input, result);
    return result;
  }
  discard(input: TranscriptionInput) {
    // Validate the fingerprint even after content has been erased.
    const prior = this.store.receipt(input.id, input), row = this.row(input.id);
    if (row?.upload_id && row.upload_id !== input.uploadId) throw new Conflict('Transcription identity was reused for another recording.');
    this.store.db.transaction(() => {
      if (!prior) this.store.saveReceipt(input.id, input, { discarded: true });
      else this.store.db.prepare('UPDATE receipts SET data=? WHERE id=?').run(JSON.stringify({ discarded: true }), input.id);
      this.store.setMeta(`audio:${input.id}`, true);
      this.store.db.prepare('INSERT INTO transcriptions VALUES (?,NULL,?,1) ON CONFLICT(id) DO UPDATE SET upload_id=NULL,discarded=1').run(input.id, Date.now());
      this.store.db.prepare('INSERT OR IGNORE INTO discarded_uploads VALUES (?)').run(input.uploadId);
    })();
  }
  sweep(now = Date.now()) {
    for (const row of this.store.db.prepare('SELECT id,upload_id FROM transcriptions WHERE discarded=0 AND expires_at<=?').all(now) as { id: string; upload_id: string | null }[]) {
      if (row.upload_id) this.discard({ id: row.id, uploadId: row.upload_id });
      else {
        this.store.db.prepare('UPDATE receipts SET data=? WHERE id=?').run(JSON.stringify({ discarded: true }), row.id);
        this.store.db.prepare('UPDATE transcriptions SET discarded=1 WHERE id=?').run(row.id);
      }
    }
  }
  async migrateLegacy() {
    const rows = this.store.db.prepare("SELECT substr(m.key,7) AS id,r.hash FROM meta m LEFT JOIN receipts r ON r.id=substr(m.key,7) WHERE m.key LIKE 'audio:%' AND NOT EXISTS (SELECT 1 FROM transcriptions t WHERE t.id=substr(m.key,7))").all() as { id: string; hash?: string }[];
    if (!rows.length) return;
    const uploads = (this.store.db.prepare('SELECT id,data FROM uploads').all() as { id: string; data: string }[]).filter(u => /^(audio\/|video\/webm)/.test(JSON.parse(u.data).type));
    for (const row of rows) {
      let uploadId: string | undefined;
      // Old receipts retained a hash, not the upload ID. Match that exact hash;
      // never guess ownership from a filename. Yield during large migrations.
      if (row.hash) for (let i = 0; i < uploads.length; i++) {
        if (digest({ id: row.id, uploadId: uploads[i].id }) === row.hash) { uploadId = uploads[i].id; break; }
        if (i % 100 === 0) await setImmediate();
      }
      this.store.db.prepare('INSERT OR IGNORE INTO transcriptions VALUES (?,?,?,0)').run(row.id, uploadId || null, Date.now() + transcriptionRetentionMs);
      await setImmediate();
    }
  }
}
