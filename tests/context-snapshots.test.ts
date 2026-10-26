import { describe, expect, it } from 'vitest';
import { applyContextObservations, type ContextObservation } from '../src/contextSnapshots';
import type { CoreSnapshot } from '../src/data';

const context = (id: string, title = id) => ({ id, title, aliases: [], link: null });
const observation = (id: string, revision: number): ContextObservation => ({ revision, context: context(id, `Current ${id}`),
  settings: { defaults: { revision, values: { effort: 'high' } }, conversation: { revision, values: { fast: true } } } });
const snapshot = (revision: number): CoreSnapshot => ({ revision, contexts: [context('first'), context('second')], hiddenConversations: ['hidden'],
  sessionSettings: { defaults: { revision: 1, values: {} }, conversations: {} } });

describe('focused conversation snapshots', () => {
  it('preserves independent current conversations when an older full snapshot arrives', () => {
    const result = applyContextObservations(snapshot(1), [observation('first', 3), observation('second', 2)]);
    expect(result.contexts.map(context => context.title)).toEqual(['Current first', 'Current second']);
    expect(result.sessionSettings?.defaults.revision).toBe(3);
    expect(result.sessionSettings?.conversations.second.revision).toBe(2);
    expect(result.revision).toBe(1);
    expect(result.hiddenConversations).toEqual(['hidden']);
  });
  it('accepts a newer full snapshot without retaining obsolete focused metadata', () => {
    const full = snapshot(4);
    const result = applyContextObservations(full, [observation('first', 5), observation('second', 3)]);
    expect(result.contexts.map(context => context.title)).toEqual(['Current first', 'second']);
    expect(result.sessionSettings?.conversations.second).toBeUndefined();
    expect(result.revision).toBe(4);
  });
  it('clears only the selected settings record and retains another conversation', () => {
    const full = snapshot(1);
    full.sessionSettings!.conversations = { first: { revision: 1, values: { fast: true } }, second: { revision: 1, values: { effort: 'low' } } };
    const current = observation('first', 2); current.settings.conversation = null;
    const result = applyContextObservations(full, [current]);
    expect(result.sessionSettings?.conversations.first).toBeUndefined();
    expect(result.sessionSettings?.conversations.second).toEqual(full.sessionSettings!.conversations.second);
  });
});
