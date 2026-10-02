import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { ArticleExtractor } from '../server/articleExtraction';
import { ArticleWeb } from '../server/articleWeb';
import { createApp } from '../server/app';

const good = `<html><title>Safe article</title><body><article>${'<p>A useful paragraph about gardens and growing plants in different seasons. '.repeat(15)}</p></article></body></html>`;
const nested = '<html><body><article>' + '<div>'.repeat(1250) + '<p>' + 'Synthetic article content. '.repeat(12) + '</p>' + '</div>'.repeat(1250) + '</article></body></html>';

it('terminates pathological extraction while Herts keeps answering requests, then processes a good article', async () => {
  const dataDir = await mkdtemp('/tmp/herts-parser-');
  const { app, articles } = await createApp({ dataDir, origin: 'http://127.0.0.1:8790', identity: 'fixture', dev: true, hermesBase: '', hermesToken: '' });
  const controller = new AbortController();
  articles.fetchHtml = async url => ({ url, html: url.endsWith('/bad') ? nested : good });
  const web = articles.forPlugin(controller.signal);
  try {
    let finished = false;
    const started = Date.now(), stalled = expect(web.readArticle('https://example.com/bad', controller.signal)).rejects.toThrow(/too long|could not be saved/).finally(() => { finished = true; });
    let beats = 0; const timer = setInterval(() => beats++, 20);
    try {
      // Keep checking throughout parsing, including after worker startup.
      do {
        const before = Date.now();
        expect((await app.inject('/api/v1/state')).statusCode).toBe(200);
        expect(Date.now() - before).toBeLessThan(1500);
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (!finished);
      await stalled;
    } finally { clearInterval(timer); }
    expect(beats).toBeGreaterThan(3); expect(Date.now() - started).toBeLessThan(16000);
    expect((await web.readArticle('https://example.com/good', controller.signal)).text).toContain('growing plants');
  } finally { controller.abort(); await app.close(); await rm(dataDir, { recursive: true, force: true }); }
}, 30000);

it('bounds queued work and cancels queued and running parses without occupying the next slot', async () => {
  const extractor = new ArticleExtractor(10000, 1, 1), active = new AbortController(), queued = new AbortController();
  const first = expect(extractor.extract(nested, 'https://example.com/one', active.signal)).rejects.toThrow('interrupted');
  const second = expect(extractor.extract(nested, 'https://example.com/two', queued.signal)).rejects.toThrow('interrupted');
  await expect(extractor.extract(good, 'https://example.com/three')).rejects.toThrow('busy');
  queued.abort(); active.abort(); await Promise.all([first, second]);
  expect((await extractor.extract(good, 'https://example.com/next')).status).toBe('saved');
}, 15000);

it('supports already-installed Reading plugins without synchronous HTML parsing', async () => {
  const host = new ArticleWeb(), lifetime = new AbortController(), web = host.forPlugin(lifetime.signal);
  host.fetchHtml = async url => ({ url, html: good });
  try {
    expect(() => web.extractArticle(nested, 'https://example.com/not-fetched')).toThrow('web.readArticle');
    const page = await web.fetchHtml('https://example.com/legacy', lifetime.signal);
    expect(web.extractArticle(page.html, page.url).text).toContain('growing plants');
    lifetime.abort(); expect(() => web.extractArticle(page.html, page.url)).toThrow();
  } finally { lifetime.abort(); }
}, 10000);

it('backs off repeated failures across reading items, while allowing later retries', async () => {
  const host = new ArticleWeb(), controller = new AbortController(), web = host.forPlugin(controller.signal);
  const fetcher = vi.fn(async () => { throw new Error('Unavailable page'); }); host.fetchHtml = fetcher;
  const now = Date.now(), time = vi.spyOn(Date, 'now');
  try {
    time.mockReturnValue(now);
    await expect(web.readArticle('https://example.com/failure#one', controller.signal)).rejects.toThrow('Unavailable');
    await expect(web.readArticle('https://example.com/failure#two', controller.signal)).rejects.toThrow('Unavailable');
    expect(fetcher).toHaveBeenCalledTimes(1);
    time.mockReturnValue(now + 31000);
    await expect(web.readArticle('https://example.com/failure', controller.signal)).rejects.toThrow('Unavailable');
    time.mockReturnValue(now + 62000);
    await expect(web.readArticle('https://example.com/failure', controller.signal)).rejects.toThrow('Unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { time.mockRestore(); controller.abort(); }
});
