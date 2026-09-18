import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
import { normalizeUrl, retainsArticle, type Article, type ReadingItem } from '../shared/reading.js';
import { Store } from './store.js';

export function publicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function fetchArticleHtml(raw: string, signal: AbortSignal): Promise<{ html: string; url: string }> {
  let url = new URL(normalizeUrl(raw));
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(new Error('Download interrupted.'));
      signal.addEventListener('abort', abort, { once: true });
      lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Automatic downloads require a public website.');
    const pinned = addresses[0];
    const response = await new Promise<{ status: number; location?: string; type: string; encoding: string; body: string }>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        signal, agent: false,
        headers: { 'User-Agent': 'HertsReader/1.0', Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
        // Pin the validated address for this request, keeping the original hostname
        // for TLS certificate verification. Validate anew on every redirect.
        lookup: ((_host: string, options: any, callback: any) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
      }, res => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) { res.destroy(); resolve({ status, location: res.headers.location, type: '', encoding: '', body: '' }); return; }
        const parts: Buffer[] = []; let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 5 * 1024 * 1024) { request.destroy(new Error('This page is too large to save as an article.')); return; } parts.push(chunk); });
        res.on('error', reject);
        res.on('end', () => resolve({ status, type: String(res.headers['content-type'] || ''), encoding: String(res.headers['content-encoding'] || ''), body: Buffer.concat(parts).toString('utf8') }));
      });
      request.on('error', reject); request.end();
    });
    if (response.status >= 300 && response.status < 400 && response.location) { url = new URL(normalizeUrl(new URL(response.location, url).href)); continue; }
    if (response.status < 200 || response.status >= 300) throw new Error('This website did not provide an accessible article.');
    if (!/^(text\/html|application\/xhtml\+xml)/i.test(response.type) || (response.encoding && response.encoding !== 'identity')) throw new Error('This link does not provide a supported article page.');
    return { html: response.body, url: url.href };
  }
  throw new Error('This website redirected too many times.');
}
export function extractArticle(html: string, url: string, item: ReadingItem): Article {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const restricted = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html) || !!document.querySelector('[class*="paywall"], [id*="paywall"], [class*="subscription-wall"]');
    const pageText = document.body?.textContent || '';
    const clickLoaded = /(?:continue|click|tap) (?:to )?(?:read|view) (?:the )?(?:full|rest|more)|sign in to (?:read|continue)|subscribe to (?:read|continue)|unlock (?:this|the) article/i.test(pageText);
    const article = new Readability(document, { maxElemsToParse: 50000 }).parse();
    const base = { itemId: item.id, version: item.downloadVersion, url, title: article?.title || '', byline: article?.byline || '', siteName: article?.siteName || new URL(url).hostname, fetchedAt: Date.now() };
    if (!article?.textContent?.trim() || article.textContent.trim().length < 120) return { ...base, html: '', text: '', status: 'unavailable', warning: 'Unavailable offline. Open the original link to read it.' };
    const purifier = createDOMPurify(dom.window);
    const clean = purifier.sanitize(article.content || '', { ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','strong','em','b','i','s','hr','a','table','thead','tbody','tr','td','th','caption','figure','figcaption','sup','sub'], ALLOWED_ATTR: ['href','title','colspan','rowspan'], ALLOW_DATA_ATTR: false });
    const body = document.createElement('div'); body.innerHTML = clean;
    for (const a of body.querySelectorAll('a')) {
      try { a.href = normalizeUrl(new URL(a.getAttribute('href') || '', url).href); a.target = '_blank'; a.rel = 'noopener noreferrer'; } catch { a.removeAttribute('href'); }
    }
    const excerpt = restricted || clickLoaded || article.textContent.trim().length < 600;
    return { ...base, html: body.innerHTML, text: body.textContent || '', status: excerpt ? 'excerpt' : 'saved', warning: excerpt ? 'Saved excerpt · May be incomplete. The website may require another click or sign-in for the full article.' : 'Saved article text. May be incomplete if the website loads more content after opening.' };
  } finally { dom.window.close(); }
}
export class Articles {
  active = new Map<string, { version: number; controller: AbortController; promise: Promise<Article> }>();
  closed = false; timer: NodeJS.Timeout;
  constructor(public store: Store, public fetchHtml = fetchArticleHtml) {
    this.timer = setInterval(() => this.prepare(), 15000);
    store.on('change', () => this.prepare()); this.prepare();
  }
  prepare() {
    if (this.closed) return;
    const state = this.store.reading();
    for (const [id, job] of this.active) { const item = state.items.find(i => i.id === id); if (!item || !retainsArticle(item, state) || item.downloadVersion !== job.version) job.controller.abort(); }
    for (const item of state.items) {
      if (this.active.size >= 2) break;
      if (retainsArticle(item, state) && !this.active.has(item.id) && !this.store.article(item.id)) void this.get(item.id).catch(() => {});
    }
  }
  async get(id: string): Promise<Article> {
    const state = this.store.reading(), item = state.items.find(i => i.id === id);
    if (!item) throw new Error('Reading item not found.');
    const cached = this.store.article(id); if (cached?.version === item.downloadVersion) return cached;
    const prior = this.active.get(id); if (prior?.version === item.downloadVersion) return prior.promise;
    if (prior) { prior.controller.abort(); await prior.promise.catch(() => {}); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const promise = (async () => {
      let article: Article;
      try {
        const result = await this.fetchHtml(item.url, controller.signal); controller.signal.throwIfAborted();
        article = extractArticle(result.html, result.url, item);
      } catch (e) {
        article = { itemId: id, version: item.downloadVersion, url: item.url, title: '', byline: '', siteName: new URL(item.url).hostname, html: '', text: '', fetchedAt: Date.now(), status: 'unavailable', warning: controller.signal.aborted ? 'Download interrupted. Retry when connected.' : e instanceof Error ? e.message : 'Unavailable offline.' };
      } finally { clearTimeout(timer); }
      if (!this.closed) this.store.saveArticle(article);
      return article;
    })();
    this.active.set(id, { version: item.downloadVersion, controller, promise });
    try { return await promise; } finally { if (this.active.get(id)?.promise === promise) this.active.delete(id); }
  }
  close() { this.closed = true; clearInterval(this.timer); for (const job of this.active.values()) job.controller.abort(); }
}
