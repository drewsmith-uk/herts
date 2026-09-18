import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Store } from '../server/store';
import { Articles, extractArticle, fetchArticleHtml, publicAddress } from '../server/articles';
import { applyReadingOp, emptyReading, normalizeUrl, sharedUrls, type ReadingOp, type ReadingItem } from '../shared/reading';
const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).forEach(close => close()));
function fixture() { const store = new Store(':memory:'); closes.push(() => store.close()); return store; }
const create = (url = 'https://example.com/article'): ReadingOp => ({ id: randomUUID(), itemId: randomUUID(), contextId: randomUUID(), kind: 'create', url, at: Date.now() });
const link = { key: 'root', storedId: 'tip', title: 'A conversation', source: 'telegram' };
const articleHtml = `<html><head><title>A complete article</title></head><body><main><article><h1>A complete article</h1>${Array.from({length:10}, (_, i) => `<p>Paragraph ${i}. ${'An informative article about gardens and growing plants in different seasons. '.repeat(8)}</p>`).join('')}</article></main></body></html>`;
describe('reading items and shared conversation identity', () => {
  it('captures independently of tasks, keeps raw URL fragments and query, and deduplicates receipts', () => {
    const store = fixture(), op = create('https://EXAMPLE.com:443/a?q=1#section');
    store.readingMutation(op); store.readingMutation(op);
    expect(store.snapshot().tasks).toEqual([]); expect(store.actions()).toEqual([]);
    expect(store.reading().items).toHaveLength(1); expect(store.reading().items[0].url).toBe('https://example.com/a?q=1#section');
    expect(store.context(op.contextId!)?.link).toBeNull();
    expect(() => store.readingMutation({ ...op, url: 'https://example.com/other' })).toThrow('operation ID');
  });
  it('returns the same reading item for repeated and rotated conversation links, even when read', () => {
    const store = fixture(), op = { ...create(), conversationId: 'tip' };
    store.readingMutation(op, { link, aliases: ['legacy'] });
    store.readingMutation({ id: randomUUID(), itemId: op.itemId, kind: 'read', read: true, baseReadAt: null, at: 200 });
    const next = { ...create(), conversationId: 'rotated-tip' };
    const result = store.readingMutation(next, { link: { ...link, key: 'new-root', storedId: 'rotated-tip' }, aliases: ['root','tip'] });
    expect(result.itemId).toBe(op.itemId); expect(store.reading().items).toHaveLength(1); expect(store.reading().items[0].readAt).toBe(200);
    const different = { ...create('https://example.com/second'), conversationId: 'legacy' };
    store.readingMutation(different);
    expect(store.reading().items).toHaveLength(2); expect(new Set(store.reading().items.map(i => i.contextId)).size).toBe(1);
    store.readingMutation(create()); expect(store.reading().items).toHaveLength(3);
  });
  it('shares a context with a later task without changing read state, ordering or task-link filtering data', () => {
    const store = fixture(), reading = { ...create(), conversationId: 'tip' }; store.readingMutation(reading, { link, aliases: [] });
    const taskId = randomUUID(); store.createLinked({ id: randomUUID(), taskId, title: 'Do this', kind: 'create', at: 1 }, link);
    expect(store.task(taskId)?.contextId).toBe(store.reading().items[0].contextId);
    store.mutate({ id: randomUUID(), taskId, kind: 'move', status: 'done', baseStatus: 'inbox', at: 2 });
    expect(store.reading().items[0].readAt).toBeNull(); expect(store.reading().unread.ids).toEqual([reading.itemId]);
    expect(() => store.createLinked({ id: randomUUID(), taskId: randomUUID(), title: 'Duplicate', kind: 'create', at: 3 }, link)).toThrow('already belongs');
  });
  it('keeps unread manual order, conflicts on stale reordering and reopens at the top', () => {
    const store = fixture(), a = create(), b = create(); store.readingMutation(a); store.readingMutation(b);
    const stale = store.reading().unread.version;
    store.readingMutation({ id: randomUUID(), itemId: a.itemId, kind: 'reorder', listVersion: stale, beforeId: b.itemId, at: 3 });
    expect(store.reading().unread.ids).toEqual([a.itemId,b.itemId]);
    expect(() => store.readingMutation({ id: randomUUID(), itemId: b.itemId, kind: 'reorder', listVersion: stale, at: 4 })).toThrow('reordered');
    store.readingMutation({ id: randomUUID(), itemId: b.itemId, kind: 'read', read: true, baseReadAt: null, at: 5 });
    store.readingMutation({ id: randomUUID(), itemId: b.itemId, kind: 'read', read: false, baseReadAt: 5, at: 6 });
    expect(store.reading().unread.ids).toEqual([b.itemId,a.itemId]);
  });
  it('renames only the selected reading item while retaining its task, context and offline article', () => {
    const store = fixture(), op = { ...create(), title: 'Original title', conversationId: 'tip' };
    store.readingMutation(op, { link, aliases: [] });
    store.readingMutation({ ...create('https://example.com/second'), conversationId: 'tip' });
    store.createLinked({ id: randomUUID(), taskId: randomUUID(), title: 'Related task', kind: 'create', at: 1 }, link);
    const article = extractArticle(articleHtml, op.url!, store.reading().items[0]); store.saveArticle(article);
    const before = store.snapshot(), item = before.reading!.items.find(i => i.id === op.itemId)!;
    store.readingMutation({ id: randomUUID(), itemId: op.itemId, kind: 'title', title: '  My reading title  ', baseTitle: item.title, at: op.at + 1 });
    const after = store.snapshot();
    expect(after.reading!.items.find(i => i.id === op.itemId)).toEqual({ ...item, title: 'My reading title', updatedAt: op.at + 1 });
    expect(after.reading!.items.filter(i => i.id !== op.itemId)).toEqual(before.reading!.items.filter(i => i.id !== op.itemId));
    expect(after.reading!.unread).toEqual(before.reading!.unread);
    expect(after.contexts).toEqual(before.contexts); expect(after.tasks).toEqual(before.tasks);
    expect(store.article(op.itemId)).toEqual(article); expect(store.actions()).toEqual([]);
    store.saveArticle(article); expect(store.reading().items.find(i => i.id === op.itemId)?.title).toBe('My reading title');
  });
  it('protects competing title edits, merges independent read changes and does not replay accepted renames', () => {
    const store = fixture(), op = { ...create(), title: 'Original' }; store.readingMutation(op);
    const rename: ReadingOp = { id: randomUUID(), itemId: op.itemId, kind: 'title', title: 'First edit', baseTitle: 'Original', at: 2 };
    store.readingMutation(rename);
    expect(() => store.readingMutation({ ...rename, id: randomUUID(), title: 'Competing edit' })).toThrow('title changed on another device');
    store.readingMutation({ id: randomUUID(), itemId: op.itemId, kind: 'read', read: true, baseReadAt: null, at: 3 });
    store.readingMutation({ ...rename, id: randomUUID(), title: 'Read item title', baseTitle: 'First edit', at: 4 });
    store.readingMutation(rename);
    expect(store.reading().items[0]).toMatchObject({ title: 'Read item title', readAt: 3, updatedAt: 4 });
    expect(store.reading().unread.ids).toEqual([]);
    expect(() => store.readingMutation({ ...rename, id: randomUUID(), title: 'Read item title' })).not.toThrow();
    for (const title of ['', '   ', 'x'.repeat(2001)]) expect(() => store.readingMutation({ ...rename, id: randomUUID(), title })).toThrow('Enter a title');
  });
  it('preserves a version-one task, receipt and binding through migration and reopen', async () => {
    const dir = await mkdtemp('/tmp/reading-migration-'); let store = new Store(`${dir}/tasks.sqlite`);
    try {
      const op = { id: randomUUID(), taskId: randomUUID(), title: 'Legacy', kind: 'create' as const, at: 1 }; store.mutate(op);
      const task = store.task(op.taskId)!; delete task.contextId; store.saveTask(task);
      const binding = { runtimeId: 'runtime', storedId: 'stored', epoch: 'epoch', generation: randomUUID(), seq: 9, ready: false, monitored: true, known: true }; store.saveBinding(task.id, binding);
      store.db.exec('DELETE FROM context_aliases; DELETE FROM contexts; DROP TABLE notification_tests; DROP TABLE subscriptions; CREATE TABLE subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL); PRAGMA user_version = 1;'); store.close(); store = new Store(`${dir}/tasks.sqlite`);
      expect(store.task(task.id)?.contextId).toBe(task.id); expect(store.binding(task.id)).toEqual(binding);
      expect(store.mutate(op)).toEqual({ accepted: true, id: op.id }); expect(store.snapshot().tasks).toHaveLength(1);
      expect(store.db.pragma('user_version',{simple:true})).toBe(5);
    } finally { store.close(); await rm(dir,{recursive:true,force:true}); }
  });
});
describe('article safety and honest offline copies', () => {
  it.each(['127.0.0.1','10.2.3.4','172.16.1.2','192.168.0.1','169.254.169.254','100.64.1.2','0.0.0.0','::1','fc00::1','fe80::1','::ffff:127.0.0.1','224.0.0.1'])('rejects non-public fetch destination %s', ip => expect(publicAddress(ip)).toBe(false));
  it('permits public unicast addresses and rejects internal URLs before fetching', async () => {
    expect(publicAddress('8.8.8.8')).toBe(true); expect(publicAddress('2606:4700:4700::1111')).toBe(true);
    await expect(fetchArticleHtml('http://127.0.0.1/private', AbortSignal.timeout(1000))).rejects.toThrow('public website');
    expect(() => normalizeUrl('https://secret:token@example.com')).toThrow('credentials');
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow();
  });
  it('extracts article text and strips executable HTML, remote images and unsafe links', () => {
    const item = applyReadingOp(emptyReading(),create()).items[0];
    const article = extractArticle(articleHtml.replace('</article>', '<script>throw new Error("executed")</script><img src="https://tracker.example/pixel" onerror="alert(1)"><p><a href="javascript:alert(1)">Danger</a><a href="/more">More</a></p></article>'), item.url, item);
    expect(article.status).toBe('saved'); expect(article.text).toContain('Paragraph 9');
    expect(article.html).not.toMatch(/<script|<img|onerror|javascript:/); expect(article.html).toContain('https://example.com/more');
    expect(article.warning).toContain('May be incomplete');
  });
  it('labels login walls, click-loaded pages and short previews as incomplete', () => {
    const item = applyReadingOp(emptyReading(),create()).items[0];
    expect(extractArticle(articleHtml.replace('<body>', '<body><div class="paywall">Subscribe to read</div>'), item.url, item).status).toBe('excerpt');
    expect(extractArticle(articleHtml.replace('<body>', '<body><p>Click to read the full article</p>'), item.url, item).status).toBe('excerpt');
    expect(extractArticle('<html><body>Sign in</body></html>', item.url, item).status).toBe('unavailable');
  });
  it('removes only the selected item’s download and refuses stale fetch results', () => {
    const store = fixture(), a = create(), b = create(); store.readingMutation(a); store.readingMutation(b);
    const articleA = extractArticle(articleHtml, a.url!, store.reading().items[0]);
    store.saveArticle(articleA); store.saveArticle(extractArticle(articleHtml,b.url!,store.reading().items[1]));
    store.readingMutation({ id: randomUUID(), itemId: a.itemId, kind: 'read', read: true, baseReadAt: null, at: 10 });
    expect(store.article(a.itemId)).toBeUndefined(); expect(store.article(b.itemId)).toBeDefined(); expect(store.saveArticle(articleA)).toBe(false);
    store.readingMutation({ id: randomUUID(), itemId: a.itemId, kind: 'read', read: false, baseReadAt: 10, at: 11 });
    expect(store.saveArticle(articleA)).toBe(false);
    store.readingMutation({ id: randomUUID(), itemId: b.itemId, kind: 'offline', offline: 'remove', at: 12 });
    expect(store.article(b.itemId)).toBeUndefined();
  });
  it('does not restore an in-flight article after marking read', async () => {
    const store = fixture(), op = create(); store.readingMutation(op);
    let finish!: (value: {html:string;url:string}) => void;
    const manager = new Articles(store, async () => new Promise(resolve => { finish = resolve; }));
    const pending = manager.get(op.itemId);
    store.readingMutation({ id: randomUUID(), itemId: op.itemId, kind: 'read', read: true, baseReadAt: null, at: 5 });
    finish({ html: articleHtml, url: op.url! }); await pending;
    expect(store.article(op.itemId)).toBeUndefined(); manager.close();
  });
  it('extracts shared URLs from every Android field without dropping query parameters or fragments', () => {
    expect(sharedUrls('Article https://example.com/a?x=1#p', 'https://example.com/a?x=1#p', 'Also https://example.org/second.')).toEqual(['https://example.com/a?x=1#p','https://example.org/second']);
  });
});
