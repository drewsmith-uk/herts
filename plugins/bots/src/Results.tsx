import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react';
import { Button, ButtonLink, EmptyState, ItemList, ItemMeta, ItemRow, MessageAuthor, MessageMarkdown, PageHeader, StatusMessage, pluginLocal, pluginQuery, useCore, useMessageSpeech } from '@herts/plugin-api/client';
import type { Bot, Routine, RoutineRun } from '@herts/plugin-api/client';
import { deviceZone, errorText, formatTime, ID, resultHref, routineHref, statusLabel } from './state';
type Result = { text:string; conversationId?:string; messages?:{role:string;text:string;timestamp?:number;index:number}[]; hasMore:boolean;nextOffset:number;offset:number };
export function Results({bot,job,run}:{bot:Bot;job:Routine;run?:string}){
 const core=useCore(),online=core.online&&core.gateway.online,local=useRef(pluginLocal(ID)).current;
 const [runs,setRuns]=useState<RoutineRun[]>(),[pages,setPages]=useState<Result[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[cached,setCached]=useState(false),[attempt,setAttempt]=useState(0),[failedMore,setFailedMore]=useState(false);
 const sequence=useRef(0),pagesRef=useRef(pages);pagesRef.current=pages;
 const {speaking,speak}=useMessageSpeech(setError),key=`results:${bot.name}:${job.id}:${run||'list'}`;
 useEffect(()=>{
  const current=++sequence.current;setLoading(true);setError('');
  void(async()=>{try{
   const saved=await local.kv.get(key);if(current!==sequence.current)return;
   if(saved){if(run){const savedPages=Array.isArray(saved.value)?saved.value:[{...saved.value,offset:0}];if(!pagesRef.current.length)setPages(savedPages);}else setRuns(saved.value);setCached(true);}
   if(!online){setCached(true);if(!saved&&!pagesRef.current.length)throw new Error('These results have not been saved on this device. Reconnect to load them.');return;}
   const value=await pluginQuery(ID,run?'result':'runs',{profile:bot.name,id:job.id,...(run?{run,offset:0}:{})});if(current!==sequence.current)return;
   if(run){const existing=pagesRef.current.length?pagesRef.current:Array.isArray(saved?.value)?saved.value:[];const next=[{...value,offset:0},...existing.slice(1)];setPages(next);await local.kv.put({key,value:next});}else{setRuns(value);await local.kv.put({key,value});}
   if(current===sequence.current)setCached(false);
  }catch(e){if(current===sequence.current){setError(errorText(e));setCached(true);}}finally{if(current===sequence.current)setLoading(false);}})();
  return()=>{sequence.current++;};
 },[key,attempt,online,local]);
 async function more(){if(loading||!run)return;const current=sequence.current,offset=pages.at(-1)?.nextOffset||0;setLoading(true);setError('');setFailedMore(false);
  try{const value=await pluginQuery(ID,'result',{profile:bot.name,id:job.id,run,offset});if(current!==sequence.current)return;const next=[...pagesRef.current,{...value,offset}];setPages(next);await local.kv.put({key,value:next});}
  catch(e){if(current===sequence.current){setError(errorText(e));setFailedMore(true);}}finally{if(current===sequence.current)setLoading(false);}
 }
 return <section className="bot-results">
  <ButtonLink className="bots-back" variant="quiet" href={run?resultHref(bot.name,job.id):routineHref(bot.name,job.id)}><ArrowLeft size={16}/>{run?'All runs':'Routines'}</ButtonLink>
  <PageHeader title={`${job.name} · Results`} description={`${bot.title} · Times shown in ${deviceZone()}.`}/>
  {run&&<ItemMeta>Recorded run</ItemMeta>}
  {cached&&<StatusMessage tone="notice">{!online?(core.online?'Hermes is unavailable. ':'Offline. '):''}Showing results saved on this device.</StatusMessage>}
  {loading&&<p className="bots-loading" role="status"><LoaderCircle className="spin" size={16}/> Loading results…</p>}
  {error&&<StatusMessage>{error} <Button disabled={loading||!online} onClick={()=>failedMore?void more():setAttempt(n=>n+1)}>Retry results</Button></StatusMessage>}
  {!run&&<ItemList divided>{runs?.map(row=><ItemRow variant="preview" key={row.id} href={resultHref(bot.name,job.id,row.id)} aria-label={`Read result: ${row.title}, ${formatTime(row.at)}`} trailing={<ArrowRight size={17}/>}><h2 className="item-title">{row.title}</h2><ItemMeta>{formatTime(row.at)} · {statusLabel(row.status)}</ItemMeta><p className="item-preview">{row.preview||'No preview available.'}</p></ItemRow>)}</ItemList>}
  {!run&&!loading&&!error&&runs&&!runs.length&&<EmptyState icon={<ArrowRight/>} title="No recorded runs" description="Results will appear after this routine runs."/>}
  {run&&<div className="history">{pages.map(page=><section key={page.offset}>{page.messages?.length?page.messages.map(message=><article className={`message ${message.role==='user'?'from-user':''}`} key={message.index}><MessageAuthor name={message.role==='assistant'?bot.title:'Instructions'} mark={message.role==='assistant'?bot.title.slice(0,1):undefined} timestamp={message.timestamp} speaking={speaking===`${page.offset}:${message.index}`} onSpeak={message.role==='assistant'&&message.text.trim()?()=>void speak(`${page.offset}:${message.index}`,page.conversationId||key,message.text,()=>pluginQuery(ID,'speak',{profile:bot.name,id:job.id,run,offset:page.offset,index:message.index})):undefined}/><MessageMarkdown text={message.text} conversationId={page.conversationId}/></article>):<MessageMarkdown text={page.text} conversationId={page.conversationId}/>}</section>)}</div>}
  {run&&!loading&&!error&&pages.length>0&&!pages.some(p=>p.text.trim()||p.messages?.some(m=>m.text.trim()))&&<EmptyState icon={<ArrowRight/>} title="No output recorded" description="Hermes has no visible messages for this run."/>}
  {run&&pages.at(-1)?.hasMore&&<Button disabled={loading||!online} onClick={()=>void more()}>Load more result</Button>}
 </section>;
}
