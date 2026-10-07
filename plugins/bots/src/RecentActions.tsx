import { useEffect, useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { Button, ButtonLink, DialogFrame, DialogHeading, ItemMeta, StatusMessage, pluginActionStatus, pluginLocal, pluginQuery, reviewPluginAction, useCore } from '@herts/plugin-api/client';
import type { Bot, RemoteAction, Routine } from '@herts/plugin-api/client';
import { reviewRoutineAction, errorText, formatTime, href, ID, routineHref } from './state';
const operations:Record<string,string>={create:'Create routine',update:'Edit routine',pause:'Pause routine',resume:'Resume routine',remove:'Delete routine',run:'Run routine',hide:'Hide bot',unhide:'Unhide bot'};
const states={pending:'In progress',finished:'Completed',failed:'Failed',unknown:'Needs checking'};
export function RecentActions({bots,profile}:{bots:Bot[];profile?:string}){
 const core=useCore(),local=useRef(pluginLocal(ID)).current,[open,setOpen]=useState(false),[rows,setRows]=useState<RemoteAction[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[count,setCount]=useState(30),[more,setMore]=useState(false),[cached,setCached]=useState(false);
 const [review,setReview]=useState<{row:RemoteAction;text:string}>(),[reviewing,setReviewing]=useState(false),[checked,setChecked]=useState(false);
 useEffect(()=>{if(!open)return;let alive=true,working=false;const key=`actions:${profile||'all'}`;
  void local.kv.get(key).then(saved=>{if(alive&&saved){setRows(saved.value);setCached(true);}}).catch(()=>{});
  async function load(initial=false){if(working)return;working=true;if(initial)setLoading(true);
   try{if(!core.online){setCached(true);return;}const all:RemoteAction[]=[];let hasMore=false;for(let offset=0;offset<count;offset+=30){const page:RemoteAction[]=await pluginActionStatus(ID,undefined,{profile,offset});all.push(...page);hasMore=page.filter(a=>a.state!=='pending'&&(a.state!=='unknown'||a.reviewedAt)).length===30;}if(alive){const result=[...new Map(all.map(row=>[row.id,row])).values()];setRows(result);setMore(hasMore);setError('');setCached(false);await local.kv.put({key,value:result});}}
   catch(e){if(alive)setError(errorText(e));}finally{working=false;if(alive)setLoading(false);}
  }
  void load(true);const timer=setInterval(()=>{if(!document.hidden)void load();},10000);return()=>{alive=false;clearInterval(timer);};
 },[open,attempt,core.online,count,profile,local]);
 async function inspect(row:RemoteAction){if(!row.subject)return;setReviewing(true);setError('');setChecked(false);
  try{const subject=row.subject;let text:string;if(row.command==='routine'){text=await reviewRoutineAction(subject.profile,subject.routineId,subject.title,subject.operation==='run');}else{const bot=await pluginQuery(ID,'describe',{name:subject.profile});text=`${bot.title}\n${bot.hidden?'Hidden':'Visible'}\n${bot.description}\n${bot.soul}`;}setReview({row,text});}
  catch(e){setError(errorText(e));}finally{setReviewing(false);}
 }
 return <><Button variant="quiet" onClick={()=>setOpen(true)}><History size={16}/> Recent actions</Button>{open&&<DialogFrame className="bots-dialog" size="wide" close={()=>setOpen(false)} busy={reviewing} aria-labelledby="bot-actions-title">
  <DialogHeading id="bot-actions-title" close={()=>setOpen(false)} busy={reviewing}>Recent actions</DialogHeading>
  <p className="form-hint">{profile?bots.find(b=>b.name===profile)?.title||profile:'All bots'}. Unconfirmed actions stay here until reviewed and are never automatically repeated.</p>
  <Button variant="quiet" disabled={loading||!core.online} onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16} className={loading?'spin':''}/>{loading?'Checking actions…':'Refresh actions'}</Button>
  {cached&&<StatusMessage tone="notice">Showing actions saved on this device.</StatusMessage>}{error&&<StatusMessage>{error}</StatusMessage>}
  {!loading&&!error&&!rows.length&&<p>No recent changes to show.</p>}
  {review&&<section className="reviewed-values"><h3>Current values in Hermes</h3><p>{review.text}</p><label className="check-field"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> I checked this action’s effect in Hermes.</label><Button disabled={!checked||reviewing} onClick={()=>{setReviewing(true);void reviewPluginAction(ID,review.row.id).then(()=>{setReview(undefined);setAttempt(n=>n+1);}).catch(e=>setError(errorText(e))).finally(()=>setReviewing(false));}}>Mark reviewed</Button><p>This records your review. It does not repeat the action or change its unconfirmed outcome.</p></section>}
  {rows.map(row=>{const subject=row.subject,bot=bots.find(b=>b.name===subject?.profile),label=operations[subject?.operation||'']||(row.command==='create'?'Create bot':row.command==='configure'?'Edit bot':row.command==='routine'?'Routine change':'Open chat');return <article key={row.id} className="bot-activity-item"><h3>{label} · {subject?bot?.title||subject.profile:'Earlier action'}</h3><ItemMeta>{row.reviewedAt?'Reviewed · Outcome unconfirmed':states[row.state]} · {formatTime(row.createdAt)}</ItemMeta>{row.command==='routine'&&<p>{subject?.title||'Earlier routine'}</p>}{row.error&&<StatusMessage>{row.error}</StatusMessage>}{subject&&<div className="button-row"><ButtonLink href={row.command==='routine'?routineHref(subject.profile,subject.routineId):href(subject.profile)} onClick={()=>setOpen(false)}>{row.command==='routine'?'Inspect routine':'Inspect bot'}</ButtonLink>{row.state==='unknown'&&!row.reviewedAt&&<Button disabled={reviewing||!core.online||!core.gateway.online} onClick={()=>void inspect(row)}>Review action</Button>}</div>}</article>;})}
  {more&&<Button disabled={loading||!core.online} onClick={()=>setCount(n=>n+30)}>Load older actions</Button>}
  <div className="button-row"><Button disabled={reviewing} onClick={()=>setOpen(false)}>Close</Button></div>
 </DialogFrame>}</>;
}
