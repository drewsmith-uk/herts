import {useState} from 'react';
import {Volume2} from 'lucide-react';
import {SettingsSection,FormField,StatusMessage} from './ui';
import {readSpeechProvider,speechPreferenceKey,type SpeechProvider} from './speechPreference';

export function SpeechSettings(){
 const [provider,setProvider]=useState(readSpeechProvider),[error,setError]=useState('');
 return <SettingsSection title="Read aloud" icon={<Volume2 size={22}/>}>
  <FormField htmlFor="speech-provider" label="Voice on this device">
   <select id="speech-provider" value={provider} onChange={event=>{
    const value=event.target.value as SpeechProvider;
    try{localStorage.setItem(speechPreferenceKey,value);setProvider(value);setError('');}
    catch{setError('The voice setting could not be saved. Try again.');}
   }}><option value="device">Device voice (fast)</option><option value="hermes">Hermes voice</option></select>
  </FormField>
  <p>Device voice uses your browser’s speech service. Local voices are preferred when available.</p>
  <p>Hermes voice uses the conversation profile’s speech provider, such as Gemini. Audio preparation can take longer.</p>
  {error&&<StatusMessage>{error}</StatusMessage>}
 </SettingsSection>;
}
