import { hasSavedMessage, type Action, type Upload } from '../shared/core';
import { api, db, getState, publish, acceptSnapshot, purgeDeletedSavedMessages, rebuild, saveConversationDraft, type Draft, type LocalFile } from './data';

export async function copySavedMessage(action: Action, fallback: Draft): Promise<Draft> {
  // Downloads happen before the transaction: an unavailable attachment leaves
  // both the existing input and the saved copy intact.
  const files: LocalFile[] = [];
  for (const id of action.uploadIds) {
    if (await db.files.get(id)) continue;
    const { upload }: { upload: Upload } = await api(`/uploads/${id}/info`);
    const response = await fetch(`/api/v1/uploads/${id}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Could not restore ${upload.name}. Your draft and saved message are unchanged.`);
    const blob = await response.blob();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
    if (blob.size !== upload.size || hash !== upload.hash) throw new Error(`Could not verify ${upload.name}. Try copying the message again.`);
    files.push({ id, name: upload.name, type: upload.type, blob, hash, ...(upload.owner ? { owner: upload.owner } : {}) });
  }
  return db.transaction('rw', db.kv, db.drafts, db.files, async () => {
    const cached = (await db.kv.get('state'))?.value?.actions?.find((a: Action) => a.id === action.id) as Action | undefined;
    const current = getState().actions.find(a => a.id === action.id);
    if (!hasSavedMessage(current || action) || cached?.savedMessageDeletedAt)
      throw new Error('This saved message is no longer available.');
    const draft = await db.drafts.get(action.taskId) || fallback;
    const next: Draft = {
      id: action.taskId,
      text: !draft.text.trim() ? action.text : !action.text || draft.text === action.text ? draft.text : `${draft.text}\n\n${action.text}`,
      files: [...new Set([...draft.files, ...action.uploadIds])],
    };
    if (next.files.length > 20) throw new Error('The combined draft has more than 20 attachments. Remove some from the input before copying this message.');
    for (const id of action.uploadIds)
      if (!files.some(file => file.id === id) && !await db.files.get(id)) throw new Error('A saved attachment is no longer on this device. Try copying the message again.');
    await db.files.bulkPut(files);
    await saveConversationDraft(next);
    return next;
  });
}

export async function deleteSavedMessage(id: string) {
  const { action }: { action: Action } = await api(`/actions/${id}/discard-saved-message`, {});
  const state = getState(), current = state.actions.find(a => a.id === id);
  const actions = await purgeDeletedSavedMessages(state.actions.map(a => a.id === id ? { ...(current && current.updatedAt > action.updatedAt ? current : action), savedMessageDeletedAt: action.savedMessageDeletedAt } : a));
  publish({ actions });
  await acceptSnapshot(state.remote, actions);
  await rebuild();
}
