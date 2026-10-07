import {useEffect,useRef,useState} from 'react';
import {cacheRead} from './data';
/** One playback per transcript; stale requests cannot start audio after navigation. */
export function useMessageSpeech(onError:(message:string)=>void){
 const [speaking,setSpeaking]=useState<string|null>(null),playback=useRef(0),audio=useRef<HTMLAudioElement|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;playback.current++;audio.current?.pause();};},[]);
 async function speak(id:string,conversationId:string,text:string,load:()=>Promise<any>){
  const generation=++playback.current;audio.current?.pause();if(speaking===id){setSpeaking(null);return;}setSpeaking(id);onError('');
  try{const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');const data=await cacheRead(`speech:${conversationId}:${hash}`,load);
   if(!mounted.current||generation!==playback.current)return;const a=new Audio(data.value.data_url);audio.current=a;a.onended=()=>setSpeaking(null);await a.play();
  }catch(e){if(mounted.current&&generation===playback.current){onError(e instanceof Error?e.message:'Audio could not be played.');setSpeaking(null);}}
 }
 return {speaking,speak};
}
