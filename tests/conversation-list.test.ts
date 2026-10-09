// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conversation } from '../shared/core';
import { useConversationList } from '../src/useConversationList';

const mocks = vi.hoisted(() => ({ api: vi.fn(), read: vi.fn(), put: vi.fn(), app: { online: true, connectionVersion: 0 } }));
vi.mock('../src/data', () => ({ api: mocks.api, db: { kv: { where: () => ({ startsWith: (prefix: string) => ({ toArray: () => mocks.read(prefix) }) }), put: mocks.put } }, useApp: () => mocks.app }));
const conversation = (key: string, updatedAt = 1): Conversation => ({ key, id: key, aliases: [key], title: key, preview: '', source: 'desktop', updatedAt });
const page = (conversations: Conversation[], hasMore = false) => ({ conversations, hasMore });
const key = (query = '', offset = 0, showAll = false, filters = '') => `conversations:plugins:${filters}:${showAll}:${query}:${offset}`;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, records: Map<string, any>, result: ReturnType<typeof useConversationList>;
let input: Parameters<typeof useConversationList>[0], version: string;
function Harness() { result = useConversationList(input, version); return null; }
const render = () => act(async () => { root.render(createElement(Harness)); });
const request = () => act(async () => { await vi.advanceTimersByTimeAsync(250); });
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetAllMocks();
  records = new Map(); input = { query: '', showAll: false, filterKey: '', offset: 0 }; version = '1';
  mocks.app.online = true; mocks.app.connectionVersion = 0;
  mocks.read.mockImplementation(async (prefix: string) => [...records].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })));
  mocks.put.mockImplementation(async ({ key, value }) => { records.set(key, value); });
  mocks.api.mockImplementation(() => new Promise(() => {}));
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shows saved pages before requesting, then replaces them with the authoritative result including an empty list', async () => {
  records.set(key(), page([conversation('saved')], true));
  const response = deferred<ReturnType<typeof page>>(); mocks.api.mockReturnValueOnce(response.promise);
  await render();
  expect(result.rows.map(c => c.key)).toEqual(['saved']); expect(result.busy).toBe(true); expect(mocks.api).not.toHaveBeenCalled();
  await request(); expect(result.rows[0].key).toBe('saved');
  await act(async () => response.resolve(page([])));
  expect(result).toMatchObject({ rows: [], busy: false, cached: false, more: false, error: '' });
  expect(records.get(key()).conversations).toEqual([]);
});

it('searches saved titles, previews and messages, preferring the newest duplicate', async () => {
  records.set('conversations:old', page([conversation('old', 1), { ...conversation('title', 2), title: 'Needle title' }, { ...conversation('preview', 3), preview: 'Needle preview' }]));
  records.set('conversations:new', page([{ ...conversation('old', 4), title: 'Newest title' }]));
  records.set('history:old:latest:0', { messages: [{ role: 'assistant', content: 'Needle in older history' }] });
  records.set('conversations:broken', { conversations: [null, { key: 'broken' }] });
  input.query = 'NEEDLE'; await render();
  expect(result.rows.map(c => c.key)).toEqual(['old', 'preview', 'title']);
  expect(result.rows[0].title).toBe('Newest title'); expect(result.busy).toBe(true);
});

it('restores only the selected cached page range and respects an exact empty result', async () => {
  records.set(key(), page([conversation('first')], true));
  records.set(key('', 50), page([conversation('second')], true));
  records.set(key('', 100), page([conversation('third')]));
  input.offset = 50; await render(); expect(result.rows.map(c => c.key)).toEqual(['first', 'second']);
  records.set(key('absent'), page([])); input.query = 'absent'; input.offset = 0; await render();
  expect(result.rows).toEqual([]);
});

it('ignores a cache read that completes after the server response', async () => {
  const cache = deferred<any[]>(); mocks.read.mockReturnValueOnce(cache.promise);
  mocks.api.mockResolvedValueOnce(page([conversation('fresh')]));
  await render(); await request(); expect(result.rows[0].key).toBe('fresh');
  await act(async () => cache.resolve([{ key: key(), value: page([conversation('stale')]) }]));
  expect(result.rows[0].key).toBe('fresh'); expect(result.cached).toBe(false);
});

it('ignores late cache and network results after changing search or filters, and aborts on unmount', async () => {
  const oldCache = deferred<any[]>(), oldResponse = deferred<ReturnType<typeof page>>();
  mocks.read.mockReturnValueOnce(oldCache.promise); mocks.api.mockReturnValueOnce(oldResponse.promise);
  input.query = 'old'; await render(); await request();
  const oldSignal: AbortSignal = mocks.api.mock.calls[0][4];
  input.query = 'new'; mocks.api.mockResolvedValueOnce(page([conversation('new')]));
  await render(); expect(result.rows).toEqual([]); expect(oldSignal.aborted).toBe(true); await request();
  await act(async () => { oldCache.resolve([{ key: key('old'), value: page([conversation('old')]) }]); oldResponse.resolve(page([conversation('old')])); });
  expect(result.rows.map(c => c.key)).toEqual(['new']); expect(records.has(key('old'))).toBe(false);
  const filteredCache = deferred<any[]>(); mocks.read.mockReturnValueOnce(filteredCache.promise);
  input.filterKey = 'tasks:active'; await render(); expect(result.rows).toEqual([]); await request();
  const signal: AbortSignal = mocks.api.mock.calls.at(-1)![4];
  await act(async () => root.unmount()); expect(signal.aborted).toBe(true);
  await act(async () => filteredCache.resolve([]));
});

it('loads from the network when cache reads and writes fail', async () => {
  mocks.read.mockRejectedValue(new Error('Storage unavailable')); mocks.put.mockRejectedValue(new Error('Storage unavailable'));
  mocks.api.mockResolvedValueOnce(page([conversation('fresh')]));
  await render(); expect(result.rows).toEqual([]); expect(result.busy).toBe(true); await request();
  expect(result).toMatchObject({ busy: false, cached: false, error: '' }); expect(result.rows[0].key).toBe('fresh');
});

it('keeps displayed rows on failed refresh and retries successfully', async () => {
  mocks.api.mockResolvedValueOnce(page([conversation('saved')])); await render(); await request();
  mocks.read.mockRejectedValue(new Error('Storage unavailable')); mocks.api.mockRejectedValueOnce(new Error('Offline'));
  version = '2'; await render(); expect(result.rows[0].key).toBe('saved'); await request();
  expect(result).toMatchObject({ busy: false, cached: true, more: false, error: '' }); expect(result.rows[0].key).toBe('saved');
  mocks.api.mockResolvedValueOnce(page([conversation('recovered')]));
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  await request();
  expect(result.rows[0].key).toBe('recovered'); expect(result.cached).toBe(false);
});

it('keeps newer displayed rows when a failed refresh finds an older partial cache', async () => {
  mocks.api.mockResolvedValueOnce(page([conversation('newest', 3), conversation('retained', 2)]));
  await render(); await request();
  records.set(key(), page([{ ...conversation('newest', 1), title: 'Stale title' }]));
  mocks.api.mockRejectedValueOnce(new Error('Offline')); version = '2';
  await render(); await request();
  expect(result.rows.map(c => c.key)).toEqual(['newest', 'retained']);
  expect(result.rows[0].title).toBe('newest'); expect(result.cached).toBe(true);
});

it('retains rows during pagination, deduplicates page boundaries and drops pages after the new end', async () => {
  mocks.api.mockResolvedValueOnce(page([conversation('first')], true)); await render(); await request();
  input.offset = 50;
  const second = deferred<ReturnType<typeof page>>();
  mocks.api.mockResolvedValueOnce(page([conversation('first')], true)).mockReturnValueOnce(second.promise);
  await render(); await request(); expect(result.rows.map(c => c.key)).toEqual(['first']); expect(result.busy).toBe(true);
  await act(async () => second.resolve(page([conversation('first', 2), conversation('second')])));
  expect(result.rows.map(c => c.key)).toEqual(['first', 'second']); expect(result.rows[0].updatedAt).toBe(2); expect(result.more).toBe(false);
  version = '2'; mocks.api.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([conversation('obsolete-page')]));
  await render(); await request(); expect(result.rows).toEqual([]); expect(result.more).toBe(false);
});
