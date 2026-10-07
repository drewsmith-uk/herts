import { useEffect, useRef, useState } from 'react';
import { performPluginAction, pluginActionStatus, pluginLocal, refresh, useCore, useUpdatePreparation, pluginQuery } from '@herts/plugin-api/client';
import type { RemoteAction, Routine, RoutineRun } from '@herts/plugin-api/client';
export const ID = 'bots';
export const href = (name = '') => `#/plugins/bots${name ? '/' + encodeURIComponent(name) : ''}`;
export const routineHref=(profile:string,id?:string)=>`${href(profile)}/routines${id?'/'+encodeURIComponent(id):''}`;
export const resultHref=(profile:string,id:string,run?:string)=>`${routineHref(profile,id)}/results${run?'/'+encodeURIComponent(run):''}`;
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed.';
export const formatTime = (value?: string | number) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';
export const deviceZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
export const statusLabel=(value?:string)=>({success:'Completed',finished:'Completed',failed:'Failed',error:'Failed',running:'Running',pending:'In progress',unknown:'Needs checking'}[value || ''] || (value?'Status unavailable':'No runs yet'));

/** A form's operation survives navigation. Acknowledging local cleanup never repeats Hermes work. */
export function useOnlineAction(scope?:string) {
  const core=useCore(),local=useRef(pluginLocal(ID)).current,working=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[record,setRecord]=useState<RemoteAction>(),[ready,setReady]=useState(!scope);
  const saved=useRef<RemoteAction | undefined>(undefined);
  const key=`operation:${scope}`;
  function remember(value:RemoteAction | undefined){saved.current=value;setRecord(value);}
  useEffect(()=>{let alive=true;if(scope)void local.kv.get(key).then(row=>{if(alive){if(row)remember(row.value);setReady(true);}}).catch(e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[key,local]);
  useUpdatePreparation({blocked:()=>working.current?'Wait for this bot action to finish or check its status.':undefined});
  async function storeRecord(value:RemoteAction){remember(value);if(scope)await local.kv.put({key,value});}
  async function check(){
    if(!saved.current)return;
    setBusy(true);setError('');
    try{const value=await pluginActionStatus(ID,saved.current.id);await storeRecord(value);return value;}
    catch(e){setError(`Status could not be checked. ${errorText(e)}`);}
    finally{setBusy(false);}
  }
  async function acknowledge(){if(scope)await local.kv.delete(key);remember(undefined);setError('');}
  async function run(command:string,input:unknown){
    if(working.current||!ready)throw new Error('An action is already pending.');
    if(scope && saved.current?.state==='finished')return saved.current.result;
    if(saved.current && !['failed','finished'].includes(saved.current.state))throw new Error('Check and review the previous action before another attempt.');
    working.current=true;setBusy(true);setError('');
    try{
      if(!core.online||!core.gateway.online)throw new Error('Reconnect to Hermes to save. Your draft remains on this device.');
      const id=crypto.randomUUID();
      await storeRecord({id,command,pluginId:ID,state:'pending',createdAt:Date.now()});
      let result:RemoteAction;
      try{result=await performPluginAction(ID,command,input,id);}
      catch(e){try{result=await pluginActionStatus(ID,id);}catch{await storeRecord({...saved.current!,state:'unknown'});throw new Error('The save is unconfirmed. Check its status before trying again.');}}
      for(let n=0;result.state==='pending'&&n<60;n++){await storeRecord(result);await new Promise(resolve=>setTimeout(resolve,1000));try{result=await pluginActionStatus(ID,id);}catch{throw new Error('The save is unconfirmed. Check its status before trying again.');}}
      await storeRecord(result);
      if(result.state!=='finished')throw new Error(result.error || 'This action is still pending. Check its status.');
      void refresh().catch(()=>{});
      return result.result;
    }catch(e){setError(errorText(e));throw e;}finally{working.current=false;setBusy(false);}
  }
  return {run,busy,error,ready,record,check,acknowledge,clearError:()=>setError(''),online:core.online&&core.gateway.online,connection:core.online?'Hermes is unavailable.':'Offline.',locked:!!record&&record.state!=='failed',confirmed:record?.state==='finished'};
}

export function useSavedForm<T>(key:string,initial:T,restore?:(fields:Partial<T>,initial:T)=>T){
 const local=useRef(pluginLocal(ID)).current,baseline=useRef(initial),pending=useRef<Promise<unknown>>(Promise.resolve()),revision=useRef(0);
 const [value,setValue]=useState(initial),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[restored,setRestored]=useState(false),[saving,setSaving]=useState(false),[discarding,setDiscarding]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let alive=true;void local.drafts.get(key).then(row=>{if(!alive)return;if(row?.fields&&revision.current===0){setValue(restore?restore(row.fields,initial):{...initial,...row.fields});setRestored(true);setSaved(true);}setError('');setLoaded(true);}).catch(e=>{if(alive)setError(errorText(e));});return()=>{alive=false;};},[key,local,attempt]);
 useUpdatePreparation({settle:()=>pending.current});
 function change(next:T){const current=++revision.current;setValue(next);setSaving(true);setError('');pending.current=local.drafts.put({id:key,fields:next});void pending.current.then(()=>{if(current===revision.current){setSaving(false);setSaved(true);}}).catch(e=>{setSaving(false);setError(errorText(e));});}
 async function clear(){await pending.current.catch(()=>{});await local.drafts.delete(key);setSaved(false);setRestored(false);}
 async function discard(){setDiscarding(true);try{await clear();setValue(baseline.current);setError('');}finally{setDiscarding(false);}}
 function replace(next:T){baseline.current=next;setRestored(false);change(next);}
 const status=saving?'Saving draft…':restored?'Restored draft · Saved on this device':saved?'Draft saved on this device':'';
 return {value,change,replace,loaded,error,clear,discard,discarding,status,saved,retry:()=>setAttempt(n=>n+1)};
}
export function useSavedDrafts(prefix:string){const local=useRef(pluginLocal(ID)).current,[rows,setRows]=useState<{id:string;fields:any}[]>([]);useEffect(()=>local.watchDrafts(rows=>setRows(rows.filter(r=>r.id?.startsWith(prefix))),()=>{}),[prefix,local]);return rows;}

/** Show the evidence available in Hermes without claiming an uncertain run succeeded. */
export async function reviewRoutineAction(profile:string,id?:string,title?:string,includeRuns=false){
 const data=await pluginQuery(ID,'routines',{profile}),jobs:Routine[]=data.jobs;
 const job=id?jobs.find(j=>j.id===id):title?jobs.find(j=>j.name===title):undefined;
 if(!job)return jobs.length&&!id&&!title?jobs.map(j=>`${j.name}: ${j.enabled?'Enabled':'Paused'}`).join('\n'):'The routine is not in the current Hermes list.';
 let text=`${job.name}\n${job.enabled?'Enabled':'Paused'}\n${job.prompt}\nSchedule: ${job.schedule} (${data.timezone})\nResults: ${job.deliver==='bot-chat'?'Bot Chat':job.deliver==='local'?'Saved in Hermes':job.deliver}\nLast run: ${formatTime(job.lastRun)} · ${statusLabel(job.status)}`;
 if(includeRuns){const runs:RoutineRun[]=await pluginQuery(ID,'runs',{profile,id:job.id});text+='\nRecent recorded runs:\n'+(runs.slice(0,3).map(run=>`${formatTime(run.at)} · ${statusLabel(run.status)}\n${run.preview}`).join('\n')||'No runs recorded.');}
 return text;
}
