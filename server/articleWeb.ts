import { createHash } from 'node:crypto';
import { fetchArticleHtml } from './publicWeb.js';
import { extractArticle } from './articleExtraction.js';
import type { ReadablePage, ServerServices } from '../sdk/server.js';

export class ArticleWeb {
  fetchHtml = fetchArticleHtml;
  private failures = new Map<string, { attempts: number; after: number; error: Error }>();
  private async prepare(url: string, signal: AbortSignal) {
    const address = new URL(url); address.hash = '';
    const key = address.href, failure = this.failures.get(key);
    signal.throwIfAborted();
    if (failure && failure.after > Date.now()) throw failure.error;
    try {
      const fetched = await this.fetchHtml(url, signal);
      const article = await extractArticle(fetched.html, fetched.url, signal);
      signal.throwIfAborted(); this.failures.delete(key);
      return { fetched, article };
    } catch (error) {
      if (!signal.aborted) {
        const attempts = (failure?.attempts || 0) + 1;
        this.failures.set(key, { attempts, after: Date.now() + Math.min(300000, 30000 * 2 ** Math.min(attempts - 1, 4)), error: error instanceof Error ? error : new Error('Article processing failed. Try again later.') });
        while (this.failures.size > 128) this.failures.delete(this.failures.keys().next().value!);
      }
      throw error;
    }
  }
  forPlugin(lifetime: AbortSignal): ServerServices['web'] {
    const prepared = new Map<string, ReadablePage>();
    const key = (html: string, url: string) => createHash('sha256').update(url).update('\0').update(html).digest('hex');
    const signal = (request: AbortSignal) => AbortSignal.any([lifetime, request]);
    lifetime.addEventListener('abort', () => prepared.clear(), { once: true });
    return {
      readArticle: async (url, request) => {
        return (await this.prepare(url, signal(request))).article;
      },
      // Previously installed API-v1 plugins synchronously extract after awaiting
      // fetchHtml. Prepare their result in the worker during that awaited step.
      fetchHtml: async (url, request) => {
        const combined = signal(request), { fetched, article } = await this.prepare(url, combined);
        combined.throwIfAborted();
        prepared.set(key(fetched.html, fetched.url), article);
        while (prepared.size > 8) prepared.delete(prepared.keys().next().value!);
        return fetched;
      },
      extractArticle: (html, url) => {
        lifetime.throwIfAborted();
        const article = prepared.get(key(html, url));
        if (!article) throw new Error('Use web.readArticle to save this page, or extract the unmodified result of web.fetchHtml.');
        return structuredClone(article);
      },
    };
  }
}
