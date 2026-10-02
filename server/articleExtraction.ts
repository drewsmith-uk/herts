import { Worker } from 'node:worker_threads';
import type { ReadablePage } from '../sdk/server.js';

type Job = { html: string; url: string; signal?: AbortSignal; resolve: (value: ReadablePage) => void; reject: (error: Error) => void; cleanup: () => void; begin: () => void; worker?: Worker; settled: boolean };
/** Deadlines live on the request thread; parsing and sanitising never do. */
export class ArticleExtractor {
  private active = new Set<Job>();
  private queued: Job[] = [];
  constructor(private timeoutMs = 5000, private concurrency = 2, private maxQueued = 8) {}
  extract(html: string, url: string, signal?: AbortSignal): Promise<ReadablePage> {
    if (signal?.aborted) return Promise.reject(new Error('Article download interrupted.'));
    if (Buffer.byteLength(html) > 5 * 1024 * 1024) return Promise.reject(new Error('This page is too large to save as an article.'));
    if (this.active.size >= this.concurrency && this.queued.length >= this.maxQueued) return Promise.reject(new Error('Article processing is busy. Try again later.'));
    return new Promise((resolve, reject) => {
      const job: Job = { html, url, signal, resolve, reject, cleanup: () => {}, begin: () => {}, settled: false };
      const abort = () => this.finish(job, new Error('Article download interrupted.'));
      const expired = () => this.finish(job, new Error('This page took too long to process. Try again later.'));
      // Queueing/imports get a separate bounded startup window. Untrusted HTML
      // is not parsed until the parent starts the shorter processing deadline.
      let timer = setTimeout(expired, 10000);
      job.begin = () => { clearTimeout(timer); timer = setTimeout(expired, this.timeoutMs); };
      signal?.addEventListener('abort', abort, { once: true });
      job.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.queued.push(job); this.drain();
    });
  }
  private drain() {
    while (this.active.size < this.concurrency && this.queued.length) {
      const job = this.queued.shift()!;
      this.active.add(job);
      try {
        const worker = new Worker(new URL('./articleWorker.mjs', import.meta.url), {
          workerData: { html: job.html, url: job.url },
          resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
          // The worker is plain JS and must not inherit a test runner or TS loader.
          execArgv: [],
        });
        job.worker = worker;
        worker.on('message', result => {
          if (job.settled) return;
          if (result.ready) { job.begin(); worker.postMessage('parse'); }
          else this.finish(job, result.error ? new Error(result.error) : undefined, result.article);
        });
        worker.once('error', () => this.finish(job, new Error('This page could not be saved as an article.')));
        worker.once('exit', () => { if (!job.settled) this.finish(job, new Error('Article processing was interrupted.')); });
      } catch { this.finish(job, new Error('Article processing is unavailable. Try again later.')); }
    }
  }
  private finish(job: Job, error?: Error, article?: ReadablePage) {
    if (job.settled) return;
    job.settled = true; job.cleanup();
    this.queued = this.queued.filter(queued => queued !== job);
    // Release the slot only once the worker has actually stopped.
    const stopped = job.worker ? job.worker.terminate() : Promise.resolve();
    void stopped.catch(() => {}).then(() => {
      this.active.delete(job); this.drain();
      if (error) job.reject(error); else if (article) job.resolve(article); else job.reject(new Error('Article processing returned no result.'));
    });
  }
}
const extractor = new ArticleExtractor();
export const extractArticle = (html: string, url: string, signal?: AbortSignal) => extractor.extract(html, url, signal);
