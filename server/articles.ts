import { fetchArticleHtml } from './publicWeb.js';
import { extractArticle as parseArticle } from './articleExtraction.js';
import { retainsArticle, type Article, type ReadingItem } from '../shared/reading.js';
import { Store } from './store.js';
export { fetchArticleHtml, publicAddress } from './publicWeb.js';

export async function extractArticle(html: string, url: string, item: ReadingItem, signal?: AbortSignal): Promise<Article> {
  return { ...await parseArticle(html, url, signal), itemId: item.id, version: item.downloadVersion };
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
        article = await extractArticle(result.html, result.url, item, controller.signal);
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
