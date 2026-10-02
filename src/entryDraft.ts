import { pendingDraft, stageDraft, draftIsCurrent, acknowledgeDraft, type DraftWrite } from './draftJournal';
import { useEffect, useRef, useState } from 'react';
import { createLocalConversation, db, getState, rebuild, saveConversationDraft, useApp, type Draft } from './data';
import type { ConversationContext } from '../shared/conversations';

export interface CaptureAdapter {
  key: string;
  pluginId?: string;
  id?: string;
  route: (id: string) => string;
  initialText?: string;
  initialFields?: Record<string, string>;
  legacy?: { read: () => Promise<{ text: string; files?: string[]; fields?: Record<string, string> } | undefined>; clear: () => Promise<unknown>; recordingOwner?: string };
}
export function firstLine(text: string) { return text.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 2000) || ''; }

/** Let a plugin protect a capture's draft/audio before removing its destination. */
export async function entryDraftStatus(pluginId: string, key: string) {
  const generation = getState().plugins.entries.find(p => p.manifest.id === pluginId)?.generation;
  return db.transaction('r', db.kv, db.drafts, db.recordings, async () => {
    const id = (await db.kv.get(`entry-slot:${pluginId}:${generation ?? 0}:${key}`))?.value;
    if (typeof id !== 'string' || await db.kv.get(`context-draft-deleted:${id}`)) return { draft: false, recording: false };
    const draft = await db.drafts.get(id), fields = (await db.kv.get(`entry-fields:${id}`))?.value || {};
    return { draft: !!(draft?.text.trim() || draft?.files.length || Object.values(fields).some(Boolean)), recording: !!await db.recordings.where('owner').equals(`chat:${id}`).count() };
  });
}

/** One context and draft, even when an entry is saved before its first message. */
export function useEntryDraft(adapter: CaptureAdapter) {
  const state = useApp(), [id, setId] = useState(''), [loadedKey, setLoadedKey] = useState(''), [fields, setFields] = useState<Record<string, string>>({}), [error, setError] = useState('');
  const current = useRef(adapter); current.current = adapter;
  const [generation] = useState(() => adapter.pluginId ? state.plugins.entries.find(p => p.manifest.id === adapter.pluginId)?.generation : undefined);
  const key = `entry-slot:${adapter.pluginId || 'core'}:${generation ?? 0}:${adapter.key}`;
  const values = useRef(fields); values.current = fields;
  const identity = `${key}:${adapter.id || ''}`;
  function guard() {
    if (adapter.pluginId && !getState().plugins.entries.some(p => p.manifest.id === adapter.pluginId && p.enabled && p.generation === generation)) throw new Error('This plugin changed. Reopen this entry before saving.');
  }
  useEffect(() => {
    let alive = true;
    void (async () => {
      const draftId = adapter.id || await db.transaction('rw', db.kv, async () => {
        const saved = (await db.kv.get(key))?.value;
        if (typeof saved === 'string' && !await db.kv.get(`context-draft-deleted:${saved}`)) return saved;
        const next = crypto.randomUUID(); await db.kv.put({ key, value: next }); return next;
      });
      const journalKey = `${adapter.pluginId || 'core'}:${generation ?? 0}:entry-fields:${draftId}`, pending = pendingDraft(journalKey);
      const meta = pending?.value || (await db.kv.get(`entry-fields:${draftId}`))?.value;
      const legacy = !await db.drafts.get(draftId) ? await adapter.legacy?.read() : undefined;
      const nextFields = meta || { ...legacy?.fields, ...adapter.initialFields };
      if (!alive) return;
      values.current = nextFields; setFields(nextFields);
      const savedDraft = await db.drafts.get(draftId);
      const text = savedDraft?.text || adapter.initialText || legacy?.text || '';
      if (adapter.legacy?.recordingOwner) await db.recordings.where('owner').equals(adapter.legacy.recordingOwner).modify({ owner: `chat:${draftId}` });
      if (text || savedDraft?.files.length || legacy?.files?.length || Object.values(nextFields).some(Boolean) || await db.recordings.where('owner').equals(`chat:${draftId}`).count()) {
        guard();
        if (!getState().snapshot.contexts.some(c => c.id === draftId)) await createLocalConversation(nextFields.title || (adapter.pluginId ? firstLine(text) : '') || 'New conversation', draftId);
        if (!await db.drafts.get(draftId)) await saveConversationDraft({ id: draftId, text, files: legacy?.files || [] });
        await db.kv.put({ key: `entry-fields:${draftId}`, value: nextFields });
        await db.kv.put({ key: `entry-route:${draftId}`, value: adapter.route(draftId) });
        // Text and any recoverable recordings now belong to the same conversation.
        if (legacy) await adapter.legacy?.clear();
      }
      if (pending) acknowledgeDraft(journalKey, pending);
      if (adapter.pluginId) await db.kv.put({ key: `entry-owner:${draftId}`, value: { id: adapter.pluginId, generation } });
      if (alive) { setId(draftId); setLoadedKey(identity); }
    })().catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [key, adapter.id]);
  const context: ConversationContext = state.snapshot.contexts.find(c => c.id === id) || { id, title: fields.title || 'New conversation', link: null, aliases: [] };
  async function saveMetadata(title: string, staged?: DraftWrite) {
    const journalKey = `${adapter.pluginId || 'core'}:${generation ?? 0}:entry-fields:${id}`;
    guard();
    if (!getState().snapshot.contexts.some(c => c.id === id)) await createLocalConversation(values.current.title || (adapter.pluginId ? title : '') || 'New conversation', id);
    await db.transaction('rw', db.kv, async () => {
      if (adapter.pluginId && ((await db.kv.get(`plugin-generation:${adapter.pluginId}`))?.value ?? 0) !== generation) throw new Error('This plugin was reset. Reopen this entry.');
      if (!staged || draftIsCurrent(journalKey, staged)) await db.kv.put({ key: `entry-fields:${id}`, value: staged?.value || values.current });
      await db.kv.put({ key: `entry-route:${id}`, value: current.current.route(id) });
    });
    if (staged) acknowledgeDraft(journalKey, staged);
  }
  async function persist(draft: Draft) {
    guard();
    await saveConversationDraft(draft);
    await saveMetadata(firstLine(draft.text));
  }
  async function updateFields(patch: Record<string, string>) {
    const next = { ...values.current, ...patch }; values.current = next; setFields(next);
    try { const staged = stageDraft(`${adapter.pluginId || 'core'}:${generation ?? 0}:entry-fields:${id}`, next); await saveMetadata('', staged); }
    catch (e) { setError((e as Error).message); }
  }
  async function complete() {
    guard();
    await db.transaction('rw', db.kv, async () => {
      if ((await db.kv.get(key))?.value === id) await db.kv.delete(key);
      await db.kv.delete(`entry-route:${id}`);
      if (adapter.pluginId) await db.kv.bulkDelete([`context-draft:${id}`, `entry-owner:${id}`]);
    });
    await current.current.legacy?.clear();
    await rebuild();
  }
  return { id: loadedKey === identity ? id : '', context, fields, updateFields, persist, complete, error, owner: adapter.pluginId ? `${adapter.pluginId}:${generation}` : undefined };
}
