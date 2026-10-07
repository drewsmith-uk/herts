import {useState,type FormEvent} from 'react';
import {Button,FormDialog,FormField,StatusMessage,pluginQuery} from '@herts/plugin-api/client';
import type {Routine} from '@herts/plugin-api/client';
import {errorText,ID,useOnlineAction,useSavedForm} from './state';
import {ActionRecovery,DraftTools} from './FormRecovery';
import {days,parseSchedule,scheduleSummary,toSchedule} from './schedule';
const values=(r?:Routine)=>({name:r?.name || '',prompt:r?.prompt || '',deliver:r?.deliver || 'bot-chat',expectedRevision:r?.revision,...parseSchedule(r?.schedule)});
export function RoutineEditor({profile,routine,draftId,timezone,close,done}:{profile:string;routine?:Routine;draftId?:string;timezone:string;close():void;done():void}){
 const key=draftId || `routine:${profile}:${routine?.id || 'new'}`,draft=useSavedForm(key,values(routine),(fields,initial)=>({...initial,...fields,expectedRevision:fields.expectedRevision})),action=useOnlineAction(key),[saving,setSaving]=useState(false),[error,setError]=useState(''),[current,setCurrent]=useState<Routine>(),[checking,setChecking]=useState(false);
 const busy=saving||action.busy||draft.discarding||checking,locked=busy||action.locked,v=draft.value,schedule=toSchedule(v);
 const set=(key:keyof typeof v,value:string)=>draft.change({...v,[key]:value});
 async function finish(){await draft.clear();await action.acknowledge();done();close();}
 async function save(e:FormEvent){e.preventDefault();if(locked)return;setSaving(true);setError('');try{await action.run('routine',{action:routine?'update':'create',profile,...(routine?{id:routine.id,expectedRevision:v.expectedRevision}:{}),name:v.name,prompt:v.prompt,schedule,...(['bot-chat','local'].includes(v.deliver)?{deliver:v.deliver}:{})});await finish();}catch(e){setError(errorText(e));}finally{setSaving(false);}}
 async function review(){const data=await pluginQuery(ID,'routines',{profile});const jobs:Routine[]=data.jobs;const found=routine?jobs.find(j=>j.id===routine.id):jobs.find(j=>j.name===v.name);if(found)setCurrent(found);return found?`${found.name}\n${found.prompt}\n${scheduleSummary(found.schedule)}\nDelivery: ${found.deliver==='bot-chat'?'Bot Chat':'Save only'}`:'No matching routine is currently listed in Hermes.';}
 return <FormDialog id="routine-editor-title" title={routine?'Edit routine':'Create routine'} close={close} busy={busy} onSubmit={save} error={error||draft.error||action.error} footer={<div className="button-row"><Button disabled={busy} onClick={close}>Close</Button><Button type="submit" variant="primary" disabled={!draft.loaded||!action.ready||!action.online||locked}>{saving?'Saving…':'Save routine'}</Button></div>}>
 <ActionRecovery action={action} review={review} finish={finish}/>
 <fieldset disabled={locked||!draft.loaded}>
 <FormField label="Name"><input required maxLength={200} value={v.name} onChange={e=>set('name',e.target.value)}/></FormField>
 <FormField label="Instructions"><textarea required maxLength={100000} rows={6} value={v.prompt} onChange={e=>set('prompt',e.target.value)}/></FormField>
 <FormField label="Frequency"><select value={v.frequency} onChange={e=>set('frequency',e.target.value)}>{[['daily','Every day'],['weekly','Every week'],['interval','At an interval'],['once','Once'],['advanced','Advanced schedule']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></FormField>
 {v.frequency==='advanced'&&<FormField label="Cron expression or Hermes schedule"><input required maxLength={200} value={v.schedule} onChange={e=>set('schedule',e.target.value)}/><span className="form-hint">For example, 0 9 * * 1-5 runs at 09:00 on weekdays.</span></FormField>}
 {v.frequency==='once'&&<FormField label="Date and time"><input required type="datetime-local" value={v.once} onChange={e=>set('once',e.target.value)}/></FormField>}
 {v.frequency==='interval'&&<FormField label="Every (minutes)"><input required type="number" min="1" step="1" value={v.minutes} onChange={e=>set('minutes',e.target.value)}/></FormField>}
 {['daily','weekly'].includes(v.frequency)&&<FormField label="Time"><input required type="time" value={v.time} onChange={e=>set('time',e.target.value)}/></FormField>}
 {v.frequency==='weekly'&&<FormField label="Day"><select value={v.day} onChange={e=>set('day',e.target.value)}>{days.map((day,i)=><option value={i} key={day}>{day}</option>)}</select></FormField>}
 <p role="status" className="form-hint">{scheduleSummary(schedule)} · Schedule timezone: {timezone}.</p>
 <FormField label="Results"><select value={v.deliver} onChange={e=>set('deliver',e.target.value)}><option value="bot-chat">Deliver to Bot Chat</option><option value="local">Save only</option>{!['bot-chat','local'].includes(v.deliver)&&<option value={v.deliver}>Keep existing delivery</option>}</select></FormField>
 </fieldset>
 {!action.online&&<StatusMessage tone="notice">{action.connection} Your draft stays on this device.</StatusMessage>}
 {routine&&<div><Button disabled={!action.online||locked} onClick={()=>{setChecking(true);void review().catch(e=>setError(errorText(e))).finally(()=>setChecking(false));}}>Review current routine</Button>{current&&<section className="reviewed-values"><h3>Current values in Hermes</h3><p>{current.name}</p><p>{current.prompt}</p><p>{scheduleSummary(current.schedule)} · {current.deliver==='bot-chat'?'Bot Chat':'Save only'}</p><div className="button-row"><Button disabled={locked} onClick={()=>{draft.replace(values(current));setCurrent(undefined);setError('');action.clearError();}}>Use current values</Button><Button disabled={locked} onClick={()=>{draft.change({...v,expectedRevision:current.revision});setCurrent(undefined);setError('');action.clearError();}}>Keep my reviewed draft</Button></div><p>Keeping your draft allows its values to replace these settings when you save.</p></section>}</div>}
 <DraftTools draft={draft} disabled={locked}/>
 </FormDialog>;
}
