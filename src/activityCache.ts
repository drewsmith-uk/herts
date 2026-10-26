import type Dexie from 'dexie';
import type { Table } from 'dexie';
import { redactSavedMessage, type Action } from '../shared/core';
import { retainRecoveryDetail, type ActivitySummary, type ActivityPage, type ActivityDetails } from '../shared/activity';
import { pendingDraft, pendingDraftKeys } from './draftJournal';

export interface ActivityCacheRow { key: string; kind: 'meta' | 'summary' | 'action' | 'retired' | 'recent' | 'seen'; contextId?: string; value: any }
export interface ActivityCacheDB extends Dexie { activityCache: Table<ActivityCacheRow, string>; drafts: Table<any, string>; submissions: Table<any, string> }
interface SyncPosition { revision: number; generation?: string; cursor?: string; rebase?: string }
interface SavedSummary { generation?: string; summary: ActivitySummary }
interface SavedAction { generation?: string; version: number; action: Action }
function legacySummary(contextId: string, list: Action[]): ActivitySummary {
  const main = list.find(a => !a.cancelled && ['send', 'continue'].includes(a.kind)), send = list.find(a => a.kind === 'send');
  const brief = (action?: Action) => action && ({ id: action.id, kind: action.kind, state: action.state, receipt: action.receipt,
    phase: action.phase, createdAt: action.createdAt, updatedAt: action.updatedAt });
  return { contextId, version: 0, main: brief(main), latestSend: brief(send),
    hasSubmission: !!main, recoveryCount: list.filter(retainRecoveryDetail).length, pendingRecovery: false };
}
export class ActivityCache {
  constructor(private db: ActivityCacheDB) {}
  private get table() { return this.db.activityCache; }
  private get tables() { return [this.table, this.db.drafts, this.db.submissions]; }
  async position(): Promise<SyncPosition> { return (await this.table.get('position'))?.value || { revision: 0 }; }
  private async putPosition(position: SyncPosition) { await this.table.put({ key: 'position', kind: 'meta', value: position }); }
  async read() {
    const rows = await this.table.where('kind').anyOf('summary', 'action').toArray();
    return {
      summaries: Object.fromEntries(rows.filter(row => row.kind === 'summary').map(row => [row.contextId!, (row.value as SavedSummary).summary])),
      actions: rows.filter(row => row.kind === 'action').map(row => (row.value as SavedAction).action).sort((a, b) => b.createdAt - a.createdAt),
    };
  }
  async seed(actions: Action[]) {
    await this.db.transaction('rw', this.tables, async () => {
      if (await this.table.get('seeded')) return;
      const contexts = new Map<string, Action[]>();
      for (const action of actions) {
        const list = contexts.get(action.taskId) || []; list.push(action); contexts.set(action.taskId, list);
      }
      const summaries = new Map<string, ActivitySummary>();
      for (const [contextId, list] of contexts) {
        const summary = legacySummary(contextId, list);
        summaries.set(contextId, summary);
        await this.table.put({ key: `summary:${contextId}`, kind: 'summary', contextId, value: { summary } });
      }
      const latest = (actions: Action[]) => actions.reduce((at, action) => Math.max(at, action.createdAt), 0);
      const recent = [...contexts.entries()].sort((a, b) => latest(b[1]) - latest(a[1])).slice(0, 21);
      for (const [contextId, list] of recent) await this.table.put({ key: `recent:${contextId}`, kind: 'recent', contextId, value: latest(list) });
      const retained = new Set(recent.map(([id]) => id));
      const removed: Action[] = [];
      for (const action of actions) {
        const summary = summaries.get(action.taskId)!;
        if (retainRecoveryDetail(action) || retained.has(action.taskId) && (action.id === summary.main?.id || action.id === summary.latestSend?.id || action.targetId && action.targetId === summary.main?.id))
          await this.saveAction(action, undefined, 0);
        else removed.push(action);
      }
      await this.removeConfirmedInputs(removed);
      await this.trim();
      await this.table.put({ key: 'seeded', kind: 'meta', value: true });
    });
  }
  async legacy(actions: Action[]) {
    await this.db.transaction('rw', this.tables, async () => {
      const current = await this.position();
      await this.putPosition({ revision: current.revision + 1 });
      await this.table.delete('seeded');
      await this.table.where('kind').equals('summary').delete();
      await this.seed(actions);
    });
  }
  async legacyDetails(contextId: string, actions: Action[]) {
    await this.db.transaction('rw', this.tables, async () => {
      const summary = legacySummary(contextId, actions);
      await this.table.put({ key: `summary:${contextId}`, kind: 'summary', contextId, value: { summary } });
      for (const action of actions) if (retainRecoveryDetail(action) || action.id === summary.main?.id || action.id === summary.latestSend?.id || action.targetId && action.targetId === summary.main?.id)
        await this.saveAction(action, undefined, 0);
      await this.trim();
    });
  }
  private async saveAction(action: Action, generation: string | undefined, version: number) {
    const previous = (await this.table.get(`action:${action.id}`))?.value as SavedAction | undefined;
    const retired = (await this.table.get(`retired:${action.id}`))?.value as { generation?: string; version: number; deletedAt?: number } | undefined;
    if (generation && retired && retired.generation === generation && retired.version >= version && !action.savedMessageDeletedAt) return;
    const deletedAt = action.savedMessageDeletedAt || previous?.action.savedMessageDeletedAt || retired?.deletedAt;
    const chosen = previous && previous.generation === generation && previous.action.updatedAt > action.updatedAt ? previous.action : action;
    const clean = redactSavedMessage(deletedAt ? { ...chosen, savedMessageDeletedAt: deletedAt } : chosen);
    await this.table.put({ key: `action:${action.id}`, kind: 'action', contextId: action.taskId, value: { generation, version, action: clean } satisfies SavedAction });
    if (deletedAt) await this.table.put({ key: `retired:${action.id}`, kind: 'retired', contextId: action.taskId, value: { generation, version, deletedAt } });
  }
  private async applySummary(summary: ActivitySummary, generation: string) {
    const prior = (await this.table.get(`summary:${summary.contextId}`))?.value as SavedSummary | undefined;
    if (prior?.generation === generation && prior.summary.version > summary.version) return false;
    await this.table.put({ key: `summary:${summary.contextId}`, kind: 'summary', contextId: summary.contextId, value: { generation, summary } satisfies SavedSummary });
    return true;
  }
  async reset(expected: SyncPosition) {
    return this.db.transaction('rw', this.tables, async () => {
      const current = await this.position(); if (current.revision !== expected.revision) return false;
      await this.table.where('kind').equals('seen').delete();
      await this.putPosition({ revision: current.revision + 1, generation: current.generation });
      return true;
    });
  }
  async page(page: ActivityPage, expected: SyncPosition) {
    return this.db.transaction('rw', this.tables, async () => {
      const current = await this.position();
      if (current.revision !== expected.revision || current.cursor !== expected.cursor) return false;
      const next: SyncPosition = { ...current, revision: current.revision + 1, generation: page.generation, cursor: page.cursor };
      const retiredActions: Action[] = [];
      if (page.rebase) {
        next.rebase = crypto.randomUUID();
        await this.table.where('kind').equals('seen').delete();
      }
      for (const { summary, retired } of page.changes) {
        if (next.rebase) await this.table.put({ key: `seen:${summary.contextId}`, kind: 'seen', contextId: summary.contextId, value: next.rebase });
        if (!await this.applySummary(summary, page.generation)) continue;
        for (const id of retired) {
          const cached = (await this.table.get(`action:${id}`))?.value as SavedAction | undefined;
          if (cached?.generation === page.generation && cached.version > summary.version) continue;
          const previous = (await this.table.get(`retired:${id}`))?.value;
          await this.table.put({ key: `retired:${id}`, kind: 'retired', contextId: summary.contextId,
            value: { generation: page.generation, version: summary.version, deletedAt: previous?.deletedAt } });
          await this.table.delete(`action:${id}`);
          if (cached) retiredActions.push(cached.action);
        }
      }
      await this.removeConfirmedInputs(retiredActions, true);
      if (page.complete && next.rebase) {
        const seen = new Set((await this.table.where('kind').equals('seen').toArray()).filter(row => row.value === next.rebase).map(row => row.contextId));
        for (const row of await this.table.where('kind').equals('summary').toArray()) if (!seen.has(row.contextId)) await this.table.delete(row.key);
        await this.table.where('kind').equals('seen').delete(); delete next.rebase;
      }
      if (page.complete) {
        const retired = await this.table.where('kind').equals('retired').toArray();
        await this.table.bulkDelete(retired.filter(row => !row.value.deletedAt).map(row => row.key));
      }
      await this.putPosition(next);
      await this.trim();
      return true;
    });
  }
  async details(details: ActivityDetails, expectedGeneration?: string) {
    return this.db.transaction('rw', this.tables, async () => {
      const current = await this.position();
      if (current.generation && details.generation !== current.generation && current.generation !== expectedGeneration) return false;
      if (current.generation !== details.generation) {
        await this.putPosition({ revision: current.revision + 1, generation: details.generation });
        await this.table.where('kind').equals('seen').delete();
      }
      if (!await this.applySummary(details.summary, details.generation)) return false;
      for (const action of details.actions) await this.saveAction(action, details.generation, details.summary.version);
      await this.trim();
      return true;
    });
  }
  async touch(contextId: string) {
    await this.db.transaction('rw', this.tables, async () => {
      await this.table.put({ key: `recent:${contextId}`, kind: 'recent', contextId, value: Date.now() });
      await this.trim();
    });
  }
  async remember(actions: Action[]) {
    await this.db.transaction('rw', this.tables, async () => {
      const position = await this.position();
      for (const action of actions) {
        const summary = (await this.table.get(`summary:${action.taskId}`))?.value as SavedSummary | undefined;
        await this.saveAction(action, position.generation, (summary?.summary.version || 0) + 1);
      }
      await this.trim();
    });
  }
  private async removeConfirmedInputs(actions: Action[], authoritative = false) {
    const deferred = (await this.table.where('kind').equals('meta').toArray()).filter(row => row.key.startsWith('receipt-cleanup:'));
    if (!actions.length && !deferred.length) return;
    const removable = new Set([...actions.filter(action => authoritative || !retainRecoveryDetail(action)).map(action => action.id), ...deferred.map(row => row.value as string)]);
    const protectedIds = new Set((await this.db.drafts.toArray()).map(draft => draft.submissionId));
    for (const key of pendingDraftKeys('core:draft:')) protectedIds.add((pendingDraft(key)?.value as { submissionId?: string } | null)?.submissionId);
    const submissions = await this.db.submissions.toArray();
    const ids = submissions.filter(submission => submission.confirmed && removable.has(submission.id) && !protectedIds.has(submission.id)).map(submission => submission.id);
    for (const submission of submissions) if (submission.confirmed && removable.has(submission.id) && protectedIds.has(submission.id))
      await this.table.put({ key: `receipt-cleanup:${submission.id}`, kind: 'meta', value: submission.id });
    await this.db.submissions.bulkDelete(ids);
    const existing = new Set(submissions.map(submission => submission.id));
    await this.table.bulkDelete([...ids.map(id => `receipt-cleanup:${id}`), ...deferred.filter(row => !existing.has(row.value)).map(row => row.key)]);
  }
  private async trim() {
    const recent = (await this.table.where('kind').equals('recent').toArray()).sort((a, b) => b.value - a.value);
    const retained = new Set(recent.slice(0, 21).map(row => row.contextId));
    await this.table.bulkDelete(recent.slice(21).map(row => row.key));
    const summaries = new Map((await this.table.where('kind').equals('summary').toArray()).map(row => [row.contextId, (row.value as SavedSummary).summary]));
    const obsolete = (await this.table.where('kind').equals('action').toArray()).filter(row => {
      const action = (row.value as SavedAction).action, summary = summaries.get(row.contextId);
      const newer = summary && action.updatedAt > Math.max(summary.main?.updatedAt || 0, summary.latestSend?.updatedAt || 0);
      return !retainRecoveryDetail(action) && !newer && (!retained.has(row.contextId) || !summary ||
        action.id !== summary.main?.id && action.id !== summary.latestSend?.id && !(action.targetId && action.targetId === summary.main?.id));
    });
    await this.removeConfirmedInputs(obsolete.map(row => (row.value as SavedAction).action));
    await this.table.bulkDelete(obsolete.map(row => row.key));
  }
}
