import { useEffect, useState, type FormEvent } from 'react';
import { Button, FormDialog, FormField, ModelPicker, StatusMessage, pluginLocal, pluginQuery } from '@herts/plugin-api/client';
import type { Bot, BotDetails, BotSettings, ConversationContext } from '@herts/plugin-api/client';
import { errorText, ID, useOnlineAction, useSavedForm } from './state';
import {ActionRecovery,DraftTools} from './FormRecovery';
const settings=(bot:BotDetails):BotSettings=>({name:bot.name,title:bot.title,description:bot.description,soul:bot.soul,model:bot.model,provider:bot.provider,revision:bot.revision});
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
type Model={id:string;provider:string;providerName?:string;available:boolean};
export function BotEditor({bot,bots,draftId,warning,close,created}:{bot?:BotDetails;bots:Bot[];draftId?:string;warning?:string;close():void;created(context:ConversationContext):void}){
 const key=draftId || `edit:${bot?.name || 'new'}`,draft=useSavedForm<BotSettings>(key,bot?settings(bot):{name:'',title:'',description:'',mirrorCredentials:true}),action=useOnlineAction(key);
 const [saving,setSaving]=useState(false),[models,setModels]=useState<Model[]>([]),[modelLoading,setModelLoading]=useState(false),[modelError,setModelError]=useState(''),[attempt,setAttempt]=useState(0),[search,setSearch]=useState(''),[error,setError]=useState(''),[reloading,setReloading]=useState(false),[replace,setReplace]=useState(false);
 const busy=saving||action.busy||reloading||draft.discarding,locked=busy||action.locked,value=draft.value;
 const field=(key:keyof BotSettings,next:unknown)=>draft.change({...value,[key]:next});
 useEffect(()=>{let alive=true;const local=pluginLocal(ID),name=bot?.name || value.cloneFrom || 'default',key=`models:${name}`;setModels([]);setModelError('');setModelLoading(true);
 void(async()=>{let cached:Model[]=[];try{cached=(await local.kv.get(key))?.value || [];if(alive)setModels(cached);if(!action.online){if(alive)setModelError(cached.length?'Showing saved models.':'Reconnect to load models.');return;}const rows=await pluginQuery(ID,'models',{name});if(alive)setModels(rows);await local.kv.put({key,value:rows});}catch(e){if(alive)setModelError(`${cached.length?'Showing saved models. ':''}${errorText(e)}`);}finally{if(alive)setModelLoading(false);}})();return()=>{alive=false;};},[bot?.name,value.cloneFrom,action.online,attempt]);
 async function finish(result=action.record?.result){await draft.clear();await action.acknowledge();if(!bot&&result)created(result as ConversationContext);close();}
 async function save(event:FormEvent){event.preventDefault();if(locked)return;setSaving(true);setError('');try{const result=await action.run(bot?'configure':'create',!bot&&!value.soul?.trim()?{...value,soul:undefined}:value);await finish(result);}catch(e){setError(errorText(e));}finally{setSaving(false);}}
 async function reloadSaved(){if(!bot)return;setReloading(true);setError('');try{const saved:BotDetails=await pluginQuery(ID,'describe',{name:bot.name});await pluginLocal(ID).kv.put({key:`describe:${bot.name}`,value:saved});draft.replace(settings(saved));setReplace(false);action.clearError();}catch(e){setError(errorText(e));}finally{setReloading(false);}}
 async function review(){const rows:Bot[]=await pluginQuery(ID,'roster',{}),current=rows.find(b=>b.name===value.name);if(!current)return 'No bot with this identifier is currently listed in Hermes.';const detail:BotDetails=await pluginQuery(ID,'describe',{name:value.name});return `${detail.title}\n${detail.description}\nModel: ${detail.model}\n${detail.soul || 'No custom instructions'}`;}
 const inherited=bots.find(b=>b.name===(bot?.name || value.cloneFrom || 'default'));
 return <FormDialog id="bot-editor-title" title={bot?`Edit ${bot.title}`:'Create bot'} close={close} busy={busy} onSubmit={save} error={error||draft.error||action.error} footer={<div className="button-row"><Button disabled={busy} onClick={close}>Close</Button><Button type="submit" variant="primary" disabled={!draft.loaded||!action.ready||!action.online||locked}>{saving?'Saving…':bot?'Save bot':'Create bot'}</Button></div>}>
 {warning&&<StatusMessage tone="notice">{warning}</StatusMessage>}
 <ActionRecovery action={action} review={review} finish={()=>finish()}/>
 <fieldset disabled={locked||!draft.loaded}>
 <FormField label="Bot name"><input required maxLength={100} value={value.title} onChange={e=>draft.change({...value,title:e.target.value,...(!bot&&(!value.name||value.name===slug(value.title))?{name:slug(e.target.value)}:{})})}/></FormField>
 <FormField label="Description"><textarea rows={2} maxLength={4000} placeholder="What should this bot help with?" value={value.description} onChange={e=>field('description',e.target.value)}/></FormField>
 {!bot&&<FormField label="Start from"><select value={value.cloneFrom || ''} onChange={e=>field('cloneFrom',e.target.value || undefined)}><option value="">New bot</option>{bots.map(b=><option key={b.name} value={b.name}>Copy {b.title}</option>)}</select></FormField>}
 <FormField label="Persona"><textarea rows={6} maxLength={100000} value={value.soul || ''} placeholder="Describe how this bot should work and respond." onChange={e=>field('soul',e.target.value)}/></FormField>
 {!bot&&<p className="form-hint">Leave blank to keep the starting bot’s instructions.</p>}
 <details><summary>Model and profile settings</summary><fieldset disabled={locked}>
 <ModelPicker models={models} value={value.model&&value.provider?{id:value.model,provider:value.provider}:undefined} onChange={m=>draft.change({...value,provider:m?.provider || '',model:m?.id || ''})} search={search} setSearch={setSearch} disabled={locked||modelLoading&&!models.length} inheritedLabel={`${bot?'Keep current model':'Use starting model'}${inherited?.model?` (${inherited.model})`:''}`}/>
 {modelLoading&&<p role="status">Loading models…</p>}{modelError&&<StatusMessage tone="notice">{modelError} <Button disabled={!action.online||modelLoading} onClick={()=>setAttempt(n=>n+1)}>Retry models</Button></StatusMessage>}
 {!bot?<><FormField label="Profile identifier" htmlFor="bot-profile-id"><input id="bot-profile-id" onInvalid={e=>{const details=e.currentTarget.closest('details');if(details)details.open=true;}} required pattern="[a-z0-9][a-z0-9_\-]{0,63}" maxLength={64} value={value.name} onChange={e=>field('name',e.target.value)}/></FormField><p className="form-hint">Generated from the name. This identifier stays fixed after creation.</p><label className="check-field"><input type="checkbox" checked={value.mirrorCredentials!==false} onChange={e=>field('mirrorCredentials',e.target.checked)}/> Use the main profile’s provider credentials</label></>:<p className="form-hint">Profile: {bot.name}. Changes here are shared with Hermes Desktop. The chat’s model settings can override these defaults on its next message.</p>}
 </fieldset></details>
 </fieldset>
 {!bot&&<p className="form-hint">Creating the bot sends one introduction: “Hey, tell me about yourself!”</p>}
 {!action.online&&<StatusMessage tone="notice">{action.connection} You can keep editing this draft.</StatusMessage>}
 {bot&&<div><Button variant="quiet" disabled={!action.online||locked} onClick={()=>setReplace(true)}>Reload saved values</Button>{replace&&<StatusMessage tone="warning">Replace your draft with the current Hermes settings?<div className="button-row"><Button onClick={()=>setReplace(false)}>Keep draft</Button><Button disabled={locked} onClick={()=>void reloadSaved()}>Replace draft</Button></div></StatusMessage>}</div>}
 <DraftTools draft={draft} disabled={locked}/>
 </FormDialog>;
}
