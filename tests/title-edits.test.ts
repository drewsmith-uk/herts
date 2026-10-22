import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { Gateway, GatewayError } from '../server/gateway';
import { TitleEdits } from '../server/titleEdits';

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function fixture() {
  const store = new Store(':memory:'); stores.push(store);
  const gateway = new Gateway('', '');
  let title = 'Original', revision = 2;
  const http = vi.spyOn(gateway, 'http').mockImplementation(async (path, body: any, method) => {
    if (path.includes('mutation-snapshot')) return { session_id: 's', exists: true, runtime_revision: revision };
    if (method === 'PATCH') {
      if (body.expected_revision !== revision) throw new GatewayError('Conflict', false, 409, 'revision_conflict');
      title = body.title; return { session_id: 's', title, revision: ++revision };
    }
    return { id: 's', profile: 'default', title };
  });
  return { store, gateway, http, edits: new TitleEdits(store, gateway), change(value: string) { title = value; revision++; } };
}

it('reads the revision before the title and prevents an intervening edit', async () => {
  const f = fixture();
  const snapshot = f.gateway.mutationSnapshot.bind(f.gateway);
  vi.spyOn(f.gateway, 'mutationSnapshot').mockImplementation(async id => { const row = await snapshot(id); f.change('Elsewhere'); return row; });
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('changed in Hermes');
  expect(f.http.mock.calls.some(call => call[2] === 'PATCH')).toBe(false);
});

it('retains a lost receipt across restart and reconciles through reads without repeating the write', async () => {
  const f = fixture(), write = f.gateway.renameConversation.bind(f.gateway);
  vi.spyOn(f.gateway, 'renameConversation').mockImplementation(async (...args) => { await write(...args); throw new GatewayError('Lost', true); });
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('Lost');
  await new TitleEdits(f.store, f.gateway).rename('c', 's', 'Mine', 'Original', 'op');
  expect(f.http.mock.calls.filter(call => call[2] === 'PATCH')).toHaveLength(1);
  expect(f.store.getMeta('title-edit:op').state).toBe('confirmed');
  await expect(f.edits.rename('other', 's', 'Mine', 'Original', 'op')).rejects.toThrow('reused');
});

it('keeps an unconfirmed request uncertain when its target title is absent', async () => {
  const f = fixture();
  vi.spyOn(f.gateway, 'renameConversation').mockRejectedValue(new GatewayError('Lost', true));
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('Lost');
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('unconfirmed');
  expect(f.gateway.renameConversation).toHaveBeenCalledTimes(1);
});

it('rejects missing revisions and incorrect receipt destinations', async () => {
  const f = fixture(); f.http.mockResolvedValueOnce({ session_id: 's', exists: true });
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('revision');
  f.http.mockResolvedValueOnce({ session_id: 'another', title: 'Mine', revision: 3 });
  await expect(f.gateway.renameConversation('s', 'Mine', 'op', 2)).rejects.toMatchObject({ uncertain: true });
});

it('does not project an old successful edit over a newer title', async () => {
  const f = fixture();
  await f.edits.rename('c', 's', 'Mine', 'Original', 'op'); f.change('Newer title');
  await expect(f.edits.rename('c', 's', 'Mine', 'Original', 'op')).rejects.toThrow('changed after');
  expect(f.http.mock.calls.filter(call => call[2] === 'PATCH')).toHaveLength(1);
});
