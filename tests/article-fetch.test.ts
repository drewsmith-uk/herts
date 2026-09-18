import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ addresses: [] as {address:string;family:number}[][], replies: [] as {status:number;headers:Record<string,string>;body?:string}[], requests: [] as any[] }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => fixture.addresses.shift() || [{address:'93.184.216.34',family:4}]) }));
async function transport() {
  const { EventEmitter } = await import('node:events');
  return { request: (url: URL, options: any, done: any) => {
    fixture.requests.push({url:url.href,options}); const req = new EventEmitter() as any;
    req.end = () => queueMicrotask(() => { const reply=fixture.replies.shift()!;const res=new EventEmitter() as any;res.statusCode=reply.status;res.headers=reply.headers;res.destroy=()=>{};done(res);if(reply.body)res.emit('data',Buffer.from(reply.body));res.emit('end'); });
    req.destroy = (e: Error) => req.emit('error',e); return req;
  }};
}
vi.mock('node:http', transport); vi.mock('node:https', transport);
import { fetchArticleHtml } from '../server/articles';
beforeEach(()=>{fixture.addresses=[];fixture.replies=[];fixture.requests=[];});
it('pins the checked address and never forwards browser credentials', async()=>{
  fixture.replies.push({status:200,headers:{'content-type':'text/html'},body:'<p>Article</p>'});
  expect((await fetchArticleHtml('https://public.example/article',AbortSignal.timeout(1000))).html).toContain('Article');
  const {options}=fixture.requests[0]; const result=await new Promise(resolve=>options.lookup('public.example',{all:true},(_e:any,addresses:any)=>resolve(addresses)));
  expect(result).toEqual([{address:'93.184.216.34',family:4}]); expect(options.headers.Cookie).toBeUndefined();expect(options.headers.Authorization).toBeUndefined();
});
it('rejects a redirect to a private or mixed public/private DNS destination', async()=>{
  fixture.addresses.push([{address:'93.184.216.34',family:4}],[{address:'93.184.216.34',family:4},{address:'100.64.0.1',family:4}]);
  fixture.replies.push({status:302,headers:{location:'https://internal.example/secret'}});
  await expect(fetchArticleHtml('https://public.example/article',AbortSignal.timeout(1000))).rejects.toThrow('public website');expect(fixture.requests).toHaveLength(1);
});
it('bounds redirects, document bytes and non-HTML content',async()=>{
  fixture.replies=Array.from({length:6},()=>({status:302,headers:{location:'/again'}}));
  await expect(fetchArticleHtml('https://public.example/article',AbortSignal.timeout(1000))).rejects.toThrow('too many'); expect(fixture.requests).toHaveLength(6);
  fixture.replies=[{status:200,headers:{'content-type':'text/html'},body:'x'.repeat(5*1024*1024+1)}];
  await expect(fetchArticleHtml('https://public.example/article',AbortSignal.timeout(1000))).rejects.toThrow('too large');
  fixture.replies=[{status:200,headers:{'content-type':'application/pdf'},body:'PDF'}];
  await expect(fetchArticleHtml('https://public.example/article',AbortSignal.timeout(1000))).rejects.toThrow('supported');
});
