import { FormField, SearchField } from './ui';
export interface PickerModel { id: string; provider: string; providerName?: string; available: boolean }
export const modelChoiceKey = (choice?: {id:string;provider:string}) => choice ? JSON.stringify({id:choice.id,provider:choice.provider}) : '';
export function ModelPicker({models, value, onChange, search, setSearch, disabled, inheritedLabel, label='Model and provider', ariaLabel}: {
  models: PickerModel[];value?:{id:string;provider:string};onChange(value?:{id:string;provider:string}):void;
  search:string;setSearch(value:string):void;disabled?:boolean;inheritedLabel:string;label?:string;ariaLabel?:string;
}) {
  const matches=models.filter(m=>`${m.providerName || m.provider} ${m.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  const current=models.find(m=>m.id===value?.id&&m.provider===value.provider);
  const providers=[...new Set(matches.map(m=>m.provider))];
  return <><SearchField label="Find a model" value={search} onChange={setSearch} placeholder="Model or provider" disabled={disabled}/>
    <FormField label={label}><select aria-label={ariaLabel} disabled={disabled || !models.length} value={modelChoiceKey(value)} onChange={e=>onChange(e.target.value?JSON.parse(e.target.value):undefined)}>
      <option value="">{inheritedLabel}</option>
      {value&&!matches.some(m=>m.id===value.id&&m.provider===value.provider)&&<option value={modelChoiceKey(value)}>{value.id} ({current?'current selection':'saved choice'})</option>}
      {providers.map(provider=><optgroup key={provider} label={matches.find(m=>m.provider===provider)!.providerName || provider}>{matches.filter(m=>m.provider===provider).map(m=><option key={m.id} value={modelChoiceKey(m)} disabled={!m.available}>{m.id}{m.available?'':' (unavailable)'}</option>)}</optgroup>)}
    </select></FormField>
    {search.trim()&&!matches.length&&<p role="status">No models match “{search}”. Your current selection is unchanged.</p>}
  </>;
}
