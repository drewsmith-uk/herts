import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
function normalizeUrl(raw:string){const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a public HTTP or HTTPS URL.');return url.href;}

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

export { extractArticle } from './articleExtraction.js';
