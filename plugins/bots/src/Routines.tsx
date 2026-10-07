import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { Button, ButtonLink, DialogFrame, DialogHeading, EmptyState, ItemList, ItemMeta, ItemRow, PageHeader, StatusMessage, pluginLocal, pluginQuery } from '@herts/plugin-api/client';
import type { Bot, Routine } from '@herts/plugin-api/client';
import { reviewRoutineAction, deviceZone, statusLabel, resultHref, routineHref, useSavedDrafts, errorText, formatTime, href, ID, useOnlineAction } from './state';
import { scheduleSummary,toSchedule } from './schedule';
import { RoutineEditor } from './RoutineEditor';
import { Results } from './Results';
import {DraftList} from './DraftList';
import {ActionRecovery} from './FormRecovery';
import { RecentActions } from './RecentActions';
export function Routines({ bot, bots, parts }: { bot: Bot; bots: Bot[]; parts:string[] }) {
  const local = useRef(pluginLocal(ID)).current, action = useOnlineAction(`routine-actions:${bot.name}`), drafts=useSavedDrafts(`routine:${bot.name}:`);
  const [data, setData] = useState<{ jobs: Routine[]; timezone: string }>(), [loading, setLoading] = useState(true), [cached, setCached] = useState(false);
  const [error, setError] = useState(''), [version, setVersion] = useState(0), [working, setWorking] = useState<{ id: string; label: string; kind:string }>();
  const [editor, setEditor] = useState<{routine?:Routine;draftId?:string}>(), [removing, setRemoving] = useState<Routine>(), [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true, working = false, fresh = false;
    const key = `routines:${bot.name}`;
    void local.kv.get(key).then(row => { if (alive && !fresh && row) { setData(row.value); setCached(true); } }).catch(e => { if (alive) setError(errorText(e)); });
    async function load() {
      if (working) return; working = true; if (alive) setLoading(true);
      try {
        if (!action.online) { if (alive) setCached(true); return; }
        const result = await pluginQuery(ID, 'routines', { profile: bot.name });
        if (alive) { fresh = true; setData(result); setCached(false); setError(''); await local.kv.put({ key, value: result }); }
      } catch (e) { if (alive) { setError(errorText(e)); setCached(true); } }
      finally { working = false; if (alive) setLoading(false); }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => { alive = false; clearInterval(timer); };
  }, [bot.name, version, local, action.online]);
  async function change(kind: string, job: Routine) {
    setWorking({ id: job.id, kind, label: kind === 'run' ? 'Starting routine…' : kind === 'remove' ? 'Deleting routine…' : kind === 'pause' ? 'Pausing…' : 'Resuming…' }); setNotice('');
    try { await action.run('routine', { action: kind, profile: bot.name, id: job.id, name:job.name }); await action.acknowledge(); setRemoving(undefined); setNotice(`${job.name}: ${kind === 'run' ? 'run requested' : kind === 'remove' ? 'deleted' : kind === 'pause' ? 'paused' : 'resumed'}.`); setVersion(v => v + 1); }
    catch { /* The durable action error is shown below. */ }
    finally { setWorking(undefined); }
  }
  let selected='';let run:string|undefined;
  try{selected=parts[4]?decodeURIComponent(parts[4]):'';run=parts[6]?decodeURIComponent(parts[6]):undefined;}catch{return <StatusMessage>Invalid routine link.</StatusMessage>;}
  if(parts[5]==='results') {const job=data?.jobs.find(j=>j.id===selected);return job?<Results key={`${selected}:${run||'list'}`} bot={bot} job={job} run={run}/>:<><ButtonLink href={routineHref(bot.name)}>Back to routines</ButtonLink><StatusMessage tone="notice">{loading?'Loading routine…':error||(!action.online?action.connection+' Reconnect to load this routine.':'This routine is no longer available.')}</StatusMessage></>;}
  const locked=action.busy||action.locked;
  return <>
    <ButtonLink variant="quiet" className="bots-back" href={href(bot.name)}><ArrowLeft size={16}/> Bot Chat</ButtonLink>
    <PageHeader title="Routines" description={`${bot.title} · Hermes runs these even when Herts is closed.`} count={data?.jobs.length} actions={<Button variant="primary" onClick={() => setEditor({draftId:`routine:${bot.name}:new:${crypto.randomUUID()}`})}><Plus size={16}/> New routine</Button>}/>
    <DraftList drafts={drafts} open={row=>{const id=row.id.slice(`routine:${bot.name}:`.length);setEditor({draftId:row.id,routine:data?.jobs.find(j=>j.id===id)||(!id.startsWith('new:')&&id!=='new'?{id,profile:bot.name,name:row.fields.name||'',prompt:row.fields.prompt||'',schedule:toSchedule(row.fields),deliver:row.fields.deliver||'bot-chat',enabled:true,revision:row.fields.expectedRevision}:undefined)});}}/>
    <div className="bots-toolbar"><Button variant="quiet" disabled={!action.online || loading} onClick={() => { action.clearError(); setNotice(''); setVersion(v => v + 1); }}><RefreshCw size={16} className={loading ? 'spin' : ''}/>{loading ? 'Refreshing…' : 'Refresh routines'}</Button><RecentActions bots={bots} profile={bot.name}/></div>
    {loading && !data && <p className="bots-loading" role="status"><LoaderCircle size={16} className="spin"/> Loading routines…</p>}
    {cached && <StatusMessage tone="notice">{data ? `${!action.online?action.connection+' ':''}Showing saved routines. Refresh to verify their current state.` : 'Reconnect to load routines. You can draft a new routine offline.'}</StatusMessage>}
    {notice && <StatusMessage tone="notice">{notice}</StatusMessage>}
    {(error || action.error) && <StatusMessage>{error || action.error}</StatusMessage>}
    <ItemList>{data?.jobs.filter(job=>!selected||job.id===selected).map(job => <ItemRow key={job.id} className="bot-routine" leading={<Clock size={20}/>} role="group" aria-label={job.name} aria-busy={working?.id === job.id}>
      <h2 className="item-title">{job.name}</h2>
      <ItemMeta><span>{job.enabled ? 'Enabled' : 'Paused'}</span><span>{scheduleSummary(job.schedule)} · Schedule: {data.timezone}</span></ItemMeta>
      <ItemMeta>Next: {job.nextRun ? `${formatTime(job.nextRun)} (${deviceZone()})` : job.enabled ? 'Not scheduled yet' : 'Paused'}</ItemMeta>
      <p className="bot-description">{job.prompt}</p>
      <div className="button-row"><Button disabled={locked} onClick={()=>setEditor({routine:job})}>Edit routine</Button><ButtonLink href={resultHref(bot.name,job.id)}>Results</ButtonLink></div>
      {job.error && <StatusMessage>{job.error}</StatusMessage>}
      <details><summary>Details and actions</summary><p>{job.prompt}</p><ItemMeta>Last run: {formatTime(job.lastRun)} · {statusLabel(job.status)}</ItemMeta><ItemMeta>Results: {job.deliver === 'bot-chat' ? 'Bot Chat' : job.deliver === 'local' ? 'Saved in Hermes' : job.deliver}</ItemMeta>
        <div className="button-row"><Button disabled={!action.online||locked} onClick={()=>void change(job.enabled?'pause':'resume',job)}>{working?.id===job.id&&['pause','resume'].includes(working.kind)?working.label:job.enabled?'Pause':'Resume'}</Button><Button disabled={!action.online || locked} onClick={() => void change('run', job)}>{working?.id===job.id&&working.kind==='run'?working.label:job.enabled?'Run now':'Resume & run now'}</Button><Button variant="quiet" disabled={!action.online || locked} onClick={() => { action.clearError(); setRemoving(job); }}>Delete</Button></div>
      </details>
    </ItemRow>)}</ItemList>
    {data && !data.jobs.length && !loading && !error && <EmptyState icon={<Clock/>} title="No routines yet" description="Create a routine to give this bot something to do on a schedule."/>}
    {selected&&<ButtonLink href={routineHref(bot.name)}>All routines</ButtonLink>}
    {selected&&data&&!data.jobs.some(j=>j.id===selected)&&<StatusMessage tone="notice">{!action.online?action.connection+' This routine is not in the saved list.':'This routine is no longer available.'}</StatusMessage>}
    <ActionRecovery action={action} review={()=>reviewRoutineAction(bot.name,action.record?.subject?.routineId,action.record?.subject?.title,action.record?.subject?.operation==='run')} finish={async()=>{await action.acknowledge();setVersion(v=>v+1);}}/>
    {editor&&<RoutineEditor key={editor.draftId||editor.routine?.id} {...editor} profile={bot.name} timezone={data?.timezone||'Hermes server timezone'} close={()=>setEditor(undefined)} done={()=>{setNotice('Routine saved.');setVersion(v=>v+1);if(!editor.routine)location.hash=routineHref(bot.name);}}/>}
    {removing && <DialogFrame className="bots-dialog" close={() => setRemoving(undefined)} busy={action.busy} aria-labelledby="routine-delete-title"><DialogHeading id="routine-delete-title" close={() => setRemoving(undefined)} busy={action.busy}>Delete {removing.name}?</DialogHeading><p>This removes its schedule from Hermes.</p>{action.error && <StatusMessage>{action.error}</StatusMessage>}<div className="button-row"><Button disabled={action.busy} onClick={() => setRemoving(undefined)}>Cancel</Button><Button variant="danger" disabled={action.busy} onClick={() => void change('remove', removing)}>{action.busy ? 'Deleting…' : 'Delete routine'}</Button></div></DialogFrame>}
  </>;
}
