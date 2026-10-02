import { useRef, useState } from 'react';
import { MessageComposer, useEntryDraft, firstLine, FormField, PageHeader, type Draft, type SharedContent } from '@herts/plugin-api/client';
import { createTask, db, useApp } from './data';
import { spacePath, spaceName } from './model';

export function TaskCapture({ spaceId, recordRequest, shared, id, onSaved }: { spaceId: string; recordRequest?: string; shared?: SharedContent; id?: string; onSaved?: () => void }) {
  const state = useApp();
  const [version, setVersion] = useState(0), consumed = useRef<string | undefined>(undefined);
  return <>{(shared || id) && <><a className="back-link" href={`#${spacePath(spaceId)}`}>Tasks</a><PageHeader title="New task" description={`${spaceName(state.snapshot, spaceId)} Inbox`}/></>}<TaskEntry key={version} spaceId={spaceId} recordRequest={recordRequest === consumed.current ? undefined : recordRequest} shared={shared} id={id} saved={() => { consumed.current = recordRequest; onSaved?.(); setVersion(n => n + 1); }}/></>
}
function TaskEntry({ spaceId, recordRequest, shared, id, saved }: { spaceId: string; recordRequest?: string; shared?: SharedContent; id?: string; saved: () => void }) {
  const state = useApp(), captureKey = `capture:${spaceId}`, generation = state.plugins.entries.find(p => p.manifest.id === 'tasks')!.generation;
  const entry = useEntryDraft({ key: shared ? `share:${JSON.stringify(shared)}` : captureKey, pluginId: 'tasks', id,
    route: draftId => `/plugins/tasks/capture/${spaceId}/${draftId}`,
    initialText: shared ? [shared.text, shared.url].filter((v, i, a) => v && a.indexOf(v) === i).join('\n') || shared.title : undefined,
    initialFields: shared?.title ? { title: shared.title.slice(0, 2000) } : undefined,
    legacy: shared ? undefined : { read: async () => { const draft = await db.drafts.get(captureKey); return draft ? { text: draft.text, files: draft.files } : undefined; }, clear: () => db.drafts.delete(captureKey), recordingOwner: `plugin:tasks:${generation}:${captureKey}` },
  });
  async function prepare(draft: Draft) { await createTask(entry.fields.title?.trim() || firstLine(draft.text) || 'Attached files', spaceId, draft.id); }
  if (!entry.id) return <p role="status">{entry.error || 'Opening draft…'}</p>;
  return <><MessageComposer docked context={entry.context} persist={entry.persist} prepare={prepare} owner={entry.owner}
    recordRequest={recordRequest} saveLabel="Save to Inbox" allowSaveEmpty={!!entry.fields.title?.trim()}
    fields={<details className="entry-details"><summary>Task details</summary><FormField label="Title (optional)"><input aria-label="New task title" maxLength={2000} value={entry.fields.title || ''} placeholder="Uses the first line of your message" onChange={event => void entry.updateFields({ title: event.target.value })}/></FormField></details>}
    onSaved={async () => { await entry.complete(); if (shared || id) { history.replaceState(null, '', `/#${spacePath(spaceId)}`); dispatchEvent(new PopStateEvent('popstate')); } else saved(); }}
    onSent={async () => { await entry.complete(); if (shared) history.replaceState(null, '', '/'); location.hash = `/task/${entry.id}`; }}/>{entry.error && <p role="alert">{entry.error}</p>}</>;
}
