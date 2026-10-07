import {useState} from 'react';
import {Button,DialogFrame,StatusMessage,reviewPluginAction} from '@herts/plugin-api/client';
import {ID,errorText,type useOnlineAction,type useSavedForm} from './state';
export function DraftTools({draft,disabled}:{draft:ReturnType<typeof useSavedForm<any>>;disabled:boolean}){
 const [confirm,setConfirm]=useState(false),[error,setError]=useState('');
 return <>{draft.status&&<div className="draft-tools"><p role="status">{draft.status}</p><Button variant="quiet" disabled={disabled} onClick={()=>setConfirm(true)}>Discard draft</Button></div>}
 {!draft.loaded&&draft.error&&<Button onClick={draft.retry}>Retry opening draft</Button>}
 {confirm&&<DialogFrame aria-labelledby="discard-draft-title" close={()=>setConfirm(false)} busy={draft.discarding}><h2 id="discard-draft-title">Discard this draft?</h2><p>Your edits on this device will be removed. Saved Hermes settings are kept.</p>{error&&<StatusMessage>{error}</StatusMessage>}<div className="button-row"><Button autoFocus disabled={draft.discarding} onClick={()=>setConfirm(false)}>Keep draft</Button><Button variant="danger" disabled={draft.discarding} onClick={()=>void draft.discard().then(()=>setConfirm(false)).catch(e=>setError(errorText(e)))}>Discard changes</Button></div></DialogFrame>}</>;
}
export function ActionRecovery({action,review,finish}:{action:ReturnType<typeof useOnlineAction>;review():Promise<string>;finish():Promise<void>}){
 const [current,setCurrent]=useState(''),[checking,setChecking]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
 if(!action.record||action.record.state==='failed')return null;
 const done=action.confirmed;
 return <section className="action-recovery" aria-label="Save recovery"><StatusMessage tone="notice">{done?'Saved in Hermes. Finish clearing the local draft; saving again is not needed.':action.record.state==='pending'?'This save is still pending. Check its status; no new save will be sent.':'The previous save is unconfirmed. Check its status and review Hermes before another attempt.'}</StatusMessage>
 <div className="button-row"><Button disabled={action.busy||checking} onClick={()=>void action.check()}>Check save status</Button>{done&&<Button disabled={checking||action.busy} onClick={()=>{setChecking(true);void finish().catch(e=>setError(errorText(e))).finally(()=>setChecking(false));}}>Finish saved change</Button>}{!done&&<Button disabled={!action.online||checking||action.busy} onClick={()=>{setChecking(true);void review().then(setCurrent).catch(e=>setError(errorText(e))).finally(()=>setChecking(false));}}>Review current values</Button>}</div>
 {current&&!done&&<><p className="reviewed-values">{current}</p>{action.record.state==='unknown'&&<><label className="check-field"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I checked Hermes and need to make another attempt.</label><Button disabled={!confirmed||checking} onClick={()=>{setChecking(true);void reviewPluginAction(ID,action.record!.id).then(()=>action.acknowledge()).finally(()=>setChecking(false)).catch(e=>setError(errorText(e)));}}>Allow another save</Button></>}</>}{error&&<StatusMessage>{error}</StatusMessage>}</section>;
}
