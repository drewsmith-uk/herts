import { api, db, type Recording } from './data';
import { pendingDraft, pendingDraftKeys } from './draftJournal';

const day = 24 * 60 * 60 * 1000;
const discardPrefix = 'audio-discard:';
function strings(value: unknown, result: Set<string>, seen = new WeakSet<object>()) {
  if (typeof value === 'string') result.add(value);
  else if (value && typeof value === 'object' && !(value instanceof Blob) && !seen.has(value)) {
    seen.add(value);
    if (value instanceof Map) for (const [key, entry] of value) { strings(key, result, seen); strings(entry, result, seen); }
    else if (Array.isArray(value) || value instanceof Set) for (const entry of value) strings(entry, result, seen);
    else for (const [key, entry] of Object.entries(value)) { result.add(key); strings(entry, result, seen); }
  }
}

/** Check every durable owner, including plugins and another window's journal. */
export async function cleanLocalFiles(discard: string[] = [], now = Date.now()) {
  await db.transaction('rw', [db.files, db.drafts, db.submissions, db.recordings, db.pluginPending, db.pluginLocal, db.kv], async () => {
    const referenced = new Set<string>();
    const explicit = new Set(discard);
    for (const table of [db.drafts, db.submissions, db.recordings, db.pluginPending, db.pluginLocal]) strings(await table.toArray(), referenced);
    for (const row of await db.kv.toArray()) {
      if (row.key.startsWith(discardPrefix)) explicit.add(row.value.uploadId);
      else strings(row.value, referenced);
    }
    for (const key of pendingDraftKeys('')) strings(pendingDraft(key)?.value, referenced);
    for (const file of await db.files.toArray()) {
      const old = [file.discardRequested, file.unreferencedAt];
      if (explicit.has(file.id)) file.discardRequested = true;
      if (referenced.has(file.id)) {
        delete file.unreferencedAt;
        if (old[0] !== file.discardRequested || old[1] !== file.unreferencedAt) await db.files.put(file);
        continue;
      }
      // Protect attachment creation in another window. Legacy files without a
      // timestamp must first be observed unreferenced for a full recovery day.
      file.unreferencedAt ??= now;
      if (file.discardRequested || now - file.unreferencedAt >= day) await db.files.delete(file.id);
      else if (old[0] !== file.discardRequested || old[1] !== file.unreferencedAt) await db.files.put(file);
    }
  });
}
export async function queueTranscriptionDiscard(recording: Pick<Recording, 'transcription'>) {
  const request = recording.transcription;
  if (request) await db.kv.put({ key: discardPrefix + request.id, value: request });
}
export async function deleteRecording(id: string) {
  let recording: Recording | undefined;
  await db.transaction('rw', db.recordings, db.kv, async () => {
    recording = await db.recordings.get(id);
    if (recording) await queueTranscriptionDiscard(recording);
    await db.recordings.delete(id);
  });
  if (recording?.transcription) await cleanLocalFiles([recording.transcription.uploadId]);
  void flushTranscriptionDiscards();
}
let flushing: Promise<void> | undefined;
export function flushTranscriptionDiscards(): Promise<void> {
  if (flushing) return flushing;
  return flushing = (async () => {
    for (const row of await db.kv.where('key').startsWith(discardPrefix).toArray()) {
      try {
        await api('/audio/discard', row.value, 'POST', 10000);
        await db.kv.delete(row.key);
        await cleanLocalFiles([row.value.uploadId]);
      } catch { break; } // Retry after reconnection or a server upgrade.
    }
  })().catch(() => {}).finally(() => { flushing = undefined; });
}
