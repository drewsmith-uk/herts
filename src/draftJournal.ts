// IndexedDB can abort queued writes when the document closes. Keep a small,
// synchronous recovery copy until each plugin capture draft has committed.
// A separate payload per write lets an older window acknowledge its own write
// without deleting a newer window's pending draft.
const heads = 'herts:draft-head:';
const writes = 'herts:draft-write:';
export type DraftWrite = { token: string; value: unknown };

export function pendingDraft(key: string): DraftWrite | undefined {
  const token = localStorage.getItem(heads + key);
  if (!token) return;
  const payload = localStorage.getItem(`${writes}${key}:${token}`);
  return payload === null ? undefined : { token, value: JSON.parse(payload) };
}

export function stageDraft(key: string, value: unknown): DraftWrite {
  const previous = localStorage.getItem(heads + key);
  const write = { token: crypto.randomUUID(), value };
  const payloadKey = `${writes}${key}:${write.token}`;
  localStorage.setItem(payloadKey, JSON.stringify(value));
  try { localStorage.setItem(heads + key, write.token); }
  catch (error) { localStorage.removeItem(payloadKey); throw error; }
  if (previous) localStorage.removeItem(`${writes}${key}:${previous}`);
  return write;
}

export function draftIsCurrent(key: string, write: DraftWrite) {
  return localStorage.getItem(heads + key) === write.token;
}

export function acknowledgeDraft(key: string, write: DraftWrite) {
  localStorage.removeItem(`${writes}${key}:${write.token}`);
}

export function pendingDraftKeys(prefix: string) {
  return Object.keys(localStorage).filter(key => key.startsWith(heads + prefix)).map(key => key.slice(heads.length));
}

export function discardResetDrafts(pluginId: string, generation: number) {
  // Generation-specific keys also prevent an offline, stale window from
  // restoring a pre-reset draft into the plugin's new data.
  for (const key of Object.keys(localStorage)) {
    const prefix = [heads, writes].find(prefix => key.startsWith(`${prefix}${pluginId}:`));
    if (prefix && Number(key.slice(prefix.length).split(':')[1]) < generation) localStorage.removeItem(key);
  }
}
