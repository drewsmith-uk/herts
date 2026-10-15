import {useEffect,useRef,useState} from 'react';
import {db} from './data';
import {readSpeechProvider} from './speechPreference';

const silentAudio = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
function speechResponse(value: unknown): {data_url: string} {
 if (!value || typeof value !== 'object' || !('data_url' in value) || typeof value.data_url !== 'string' || !/^data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.data_url)) {
  throw new Error('Hermes returned no playable audio. Try reading the response again.');
 }
 return {data_url:value.data_url};
}

/** Stop audio after navigation. Ignore responses from cancelled requests. */
export function useMessageSpeech(onError:(message:string)=>void=()=>{}){
 const [speaking,setSpeaking]=useState<string|null>(null),[preparing,setPreparing]=useState<string|null>(null);
 const [error,setError]=useState<{id:string;message:string}|null>(null);
 const playback=useRef(0),audio=useRef<HTMLAudioElement|null>(null),mounted=useRef(true),active=useRef<string|null>(null);
 const utterance=useRef<SpeechSynthesisUtterance|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function stop(){
  clearTimeout(timer.current);
  if(utterance.current){utterance.current=null;window.speechSynthesis.cancel();}
  if(audio.current){audio.current.onended=null;audio.current.onerror=null;audio.current.pause();}
  active.current=null;
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;playback.current++;stop();};},[]);
 async function speak(id:string,conversationId:string,text:string,load:()=>Promise<any>){
  const same=active.current===id,generation=++playback.current;
  stop();
  if(same){setSpeaking(null);setPreparing(null);return;}
  active.current=id;setSpeaking(id);setPreparing(id);setError(null);onError('');
  const current=()=>mounted.current&&generation===playback.current;
  const fail=(error:unknown)=>{
   if(!current())return;
   stop();setSpeaking(null);setPreparing(null);
   const message=error instanceof Error?error.message:'Audio could not be played. Try reading the response again.';
   setError({id,message});onError(message);
  };
  try{
   if(readSpeechProvider()==='device'){
    if(!window.speechSynthesis || !window.SpeechSynthesisUtterance)throw new Error('Device speech is unavailable. Select Hermes voice in Settings → Read aloud.');
    const synth=window.speechSynthesis;
    const chunks=text.match(/[\s\S]{1,200}(?:\s|$)|[\s\S]{1,200}/gu)||[];
    if(!chunks.length)throw new Error('This message has no text to read.');
    const language=document.documentElement.lang||navigator.language||'en';
    const voices=synth.getVoices(),matching=voices.filter(voice=>voice.lang.split('-')[0]===language.split('-')[0]);
    const voice=matching.find(voice=>voice.localService)||matching.find(voice=>voice.default)||matching[0];
    let index=0;
    const next=()=>{
     if(!current())return;
     clearTimeout(timer.current);
     if(index===chunks.length){stop();setSpeaking(null);setPreparing(null);return;}
     const u=new SpeechSynthesisUtterance(chunks[index++]);utterance.current=u;
     u.lang=language;if(voice)u.voice=voice;
     const valid=()=>current()&&utterance.current===u;
     const timeout=()=>{if(valid())fail(new Error('Device speech did not respond. Try again or select Hermes voice in Settings → Read aloud.'));};
     timer.current=setTimeout(timeout,15000);
     u.onstart=()=>{if(valid()){clearTimeout(timer.current);setPreparing(null);timer.current=setTimeout(timeout,60000);}};
     u.onend=()=>{if(valid())next();};
     u.onerror=()=>{if(valid())fail(new Error('Device speech could not play. Try again or select Hermes voice in Settings → Read aloud.'));};
     try{synth.speak(u);}catch(error){fail(error);}
    };
    next();return;
   }
   const a=audio.current ||= new Audio();
   // Start this audio element during the button click to permit delayed playback.
   a.src=silentAudio;
   void a.play().catch(()=>{});
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(!current())return;
   const key=`speech:${conversationId}:${hash}`;
   let data:{data_url:string}|undefined;
   try{const saved=await db.kv.get(key);if(saved)data=speechResponse(saved.value);}catch{}
   if(!current())return;
   if(!data){
    data=speechResponse(await load());
    await db.kv.put({key,value:data}).catch(()=>{});
   }
   if(!current())return;
   a.onended=()=>{if(current()){stop();setSpeaking(null);setPreparing(null);}};
   a.onerror=()=>{if(!current())return;void db.kv.delete(key).catch(()=>{});fail(new Error('Audio could not be played. Try reading the response again.'));};
   a.src=data.data_url;
   await a.play();
   if(current())setPreparing(null);
  }catch(e){fail(e);}
 }
 return {speaking,preparing,error,speak};
}
