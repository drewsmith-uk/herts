import { parentPort, workerData } from 'node:worker_threads';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import createDOMPurify from 'dompurify';
function normalizeUrl(raw) { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public HTTP or HTTPS URL.'); return url.href; }

function extractArticle(html, url) {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    const restricted = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html) || !!document.querySelector('[class*="paywall"], [id*="paywall"], [class*="subscription-wall"]');
    const pageText = document.body?.textContent || '';
    const clickLoaded = /(?:continue|click|tap) (?:to )?(?:read|view) (?:the )?(?:full|rest|more)|sign in to (?:read|continue)|subscribe to (?:read|continue)|unlock (?:this|the) article/i.test(pageText);
    const article = new Readability(document, { maxElemsToParse: 50000 }).parse();
    const base = { url, title: article?.title || '', byline: article?.byline || '', siteName: article?.siteName || new URL(url).hostname, fetchedAt: Date.now() };
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

parentPort.postMessage({ ready: true });
parentPort.once('message', () => {
  try { parentPort.postMessage({ article: extractArticle(workerData.html, workerData.url) }); }
  catch { parentPort.postMessage({ error: 'This page could not be saved as an article.' }); }
});
