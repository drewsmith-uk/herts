// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {useMessageSpeech} from '../src/useMessageSpeech';
const mocks=vi.hoisted(()=>({get:vi.fn(),put:vi.fn(),delete:vi.fn()}));
vi.mock('../src/data',()=>({db:{kv:mocks}}));
const response={data_url:'data:audio/wav;base64,YXVkaW8='};
let root:Root,result:ReturnType<typeof useMessageSpeech>,instances:FakeAudio[];
const onError=vi.fn();
class FakeAudio {
 src='';onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 play=vi.fn(async()=>{});pause=vi.fn();
 constructor(){instances.push(this);}
}
function Harness(){result=useMessageSpeech(onError);return null;}
beforeEach(async()=>{
 vi.resetAllMocks();instances=[];
 const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key)||null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)});localStorage.setItem('herts:speech-provider','hermes');
 vi.stubGlobal('Audio',FakeAudio);vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 mocks.get.mockResolvedValue(undefined);mocks.put.mockResolvedValue(undefined);mocks.delete.mockResolvedValue(undefined);
 root=createRoot(document.createElement('div'));await act(async()=>root.render(createElement(Harness)));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
const speak=(id='one',load=async()=>response)=>result.speak(id,'conversation','Saved response',load);
it('starts the audio element during the click and reuses it after the request',async()=>{
 let pending!:Promise<void>;
 await act(async()=>{pending=speak();expect(instances[0].play).toHaveBeenCalledOnce();await pending;});
 expect(instances).toHaveLength(1);expect(instances[0].src).toBe(response.data_url);
 expect(result.speaking).toBe('one');await act(async()=>instances[0].onended?.());expect(result.speaking).toBeNull();
});
it('reports missing audio and permits an explicit retry',async()=>{
 await act(async()=>speak('one',async()=>({} as typeof response)));
 expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('no playable audio'));
 expect(result.speaking).toBeNull();
 await act(async()=>speak());expect(result.speaking).toBe('one');
});
it('reports decoder failures after playback starts',async()=>{
 await act(async()=>speak());await act(async()=>instances[0].onerror?.());
 expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('could not be played'));
 expect(result.speaking).toBeNull();
});
it('stops pending requests without playing their late responses',async()=>{
 let resolve!:(value:typeof response)=>void;
 const load=vi.fn(()=>new Promise<typeof response>(yes=>{resolve=yes;}));let pending!:Promise<void>;
 await act(async()=>{pending=speak('one',load);});
 await vi.waitFor(()=>expect(load).toHaveBeenCalledOnce());
 await act(async()=>speak());await act(async()=>{resolve(response);await pending;});
 expect(instances[0].play).toHaveBeenCalledOnce();expect(result.speaking).toBeNull();
});
it('ignores old completion events after selecting another response',async()=>{
 await act(async()=>speak());const ended=instances[0].onended;
 await act(async()=>speak('two'));await act(async()=>ended?.());
 expect(result.speaking).toBe('two');
});
it('ignores pending responses after navigation',async()=>{
 let resolve!:(value:typeof response)=>void,pending!:Promise<void>;
 const load=vi.fn(()=>new Promise<typeof response>(yes=>{resolve=yes;}));
 await act(async()=>{pending=speak('one',load);});await vi.waitFor(()=>expect(load).toHaveBeenCalledOnce());
 await act(async()=>root.unmount());await act(async()=>{resolve(response);await pending;});
 expect(instances[0].play).toHaveBeenCalledOnce();
 root=createRoot(document.createElement('div'));
});
it('reports blocked playback without repeating the remote request',async()=>{
 const load=vi.fn(async()=>{
  instances[0].play.mockRejectedValueOnce(new DOMException('Playback was blocked.','NotAllowedError'));
  return response;
 });
 await act(async()=>speak('one',load));
 expect(load).toHaveBeenCalledOnce();expect(result.speaking).toBeNull();
 expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('could not be played'));
 await act(async()=>speak());expect(result.speaking).toBe('one');
});
it('ignores an obsolete request failure after a new response starts playing',async()=>{
 let reject!:(error:Error)=>void,pending!:Promise<void>;
 const load=vi.fn(()=>new Promise<typeof response>((_resolve,no)=>{reject=no;}));
 await act(async()=>{pending=speak('one',load);});await vi.waitFor(()=>expect(load).toHaveBeenCalledOnce());
 await act(async()=>speak('two'));
 await act(async()=>{reject(new Error('Old failure'));await pending;});
 expect(result.speaking).toBe('two');expect(onError).toHaveBeenLastCalledWith('');
});
it('distinguishes preparation from playback and retains a failure across rerenders',async()=>{
 let reject!:(error:Error)=>void,pending!:Promise<void>;
 const load=vi.fn(()=>new Promise<typeof response>((_resolve,no)=>{reject=no;}));
 await act(async()=>{pending=speak('one',load);});await vi.waitFor(()=>expect(load).toHaveBeenCalledOnce());
 expect(result.preparing).toBe('one');expect(result.error).toBeNull();
 await act(async()=>{reject(new Error('Speech provider unavailable.'));await pending;});
 expect(result.preparing).toBeNull();expect(result.speaking).toBeNull();
 await act(async()=>root.render(createElement(Harness)));
 expect(result.error).toEqual({id:'one',message:'Speech provider unavailable.'});
 await act(async()=>speak());expect(result.error).toBeNull();expect(result.preparing).toBeNull();expect(result.speaking).toBe('one');
});

it('plays a saved response without calling the speech provider again',async()=>{
 mocks.get.mockResolvedValue({value:response});const load=vi.fn();
 await act(async()=>speak('one',load));
 expect(load).not.toHaveBeenCalled();expect(instances[0].src).toBe(response.data_url);
});
it('plays new audio even when device storage is full',async()=>{
 mocks.put.mockRejectedValue(new Error('Storage is full.'));
 await act(async()=>speak());expect(result.speaking).toBe('one');expect(result.error).toBeNull();
});
it('replaces invalid saved data and removes audio that fails decoding',async()=>{
 mocks.get.mockResolvedValue({value:{}});const load=vi.fn(async()=>response);
 await act(async()=>speak('one',load));expect(load).toHaveBeenCalledOnce();
 await act(async()=>instances[0].onerror?.());expect(mocks.delete).toHaveBeenCalledOnce();
});

function deviceSpeech(){
 localStorage.removeItem('herts:speech-provider');
 class Utterance {text:string;lang='';voice:unknown;onstart?:()=>void;onend?:()=>void;onerror?:()=>void;constructor(text:string){this.text=text;}}
 const synthesis={speak:vi.fn(),cancel:vi.fn(),getVoices:vi.fn(()=>[
  {lang:'en-US',localService:false,default:true},
  {lang:'en-GB',localService:true,default:false},
 ])};
 vi.stubGlobal('SpeechSynthesisUtterance',Utterance);vi.stubGlobal('speechSynthesis',synthesis);
 return synthesis;
}
it('uses local device speech immediately without a Hermes request or audio cache',async()=>{
 const synth=deviceSpeech(),load=vi.fn();
 await act(async()=>speak('one',load));
 expect(synth.speak).toHaveBeenCalledOnce();expect(load).not.toHaveBeenCalled();expect(mocks.get).not.toHaveBeenCalled();
 const u=synth.speak.mock.calls[0][0];expect(u.voice.localService).toBe(true);expect(result.preparing).toBe('one');
 await act(async()=>u.onstart());expect(result.preparing).toBeNull();
 await act(async()=>u.onend());expect(result.speaking).toBeNull();
});
it('reads every long-message chunk and ignores events after cancellation',async()=>{
 const synth=deviceSpeech(),text='A long response. '.repeat(100);
 await act(async()=>result.speak('one','conversation',text,vi.fn()));
 let read='';
 while(result.speaking){const u=synth.speak.mock.calls.at(-1)![0];read+=u.text;await act(async()=>{u.onstart();u.onend();});}
 expect(read).toBe(text);expect(synth.speak.mock.calls.length).toBeGreaterThan(1);
 await act(async()=>speak());const old=synth.speak.mock.calls.at(-1)![0];
 await act(async()=>speak());const count=synth.speak.mock.calls.length;
 await act(async()=>{old.onend();old.onerror();});expect(synth.speak).toHaveBeenCalledTimes(count);expect(result.error).toBeNull();
});
it('reports device failure without sending text to Hermes and allows retry',async()=>{
 const synth=deviceSpeech(),load=vi.fn();await act(async()=>speak('one',load));
 await act(async()=>synth.speak.mock.calls[0][0].onerror());
 expect(result.error?.message).toContain('Device speech could not play');expect(load).not.toHaveBeenCalled();
 await act(async()=>speak('one',load));expect(result.error).toBeNull();expect(synth.speak).toHaveBeenCalledTimes(2);
});
it('reports missing browser speech instead of silently switching providers',async()=>{
 localStorage.removeItem('herts:speech-provider');vi.stubGlobal('speechSynthesis',undefined);const load=vi.fn();
 await act(async()=>speak('one',load));expect(result.error?.message).toContain('Device speech is unavailable');expect(load).not.toHaveBeenCalled();
});
it('stops stalled device speech and ignores its late start',async()=>{
 vi.useFakeTimers();
 try{
  const synth=deviceSpeech();await act(async()=>speak());const u=synth.speak.mock.calls[0][0];
  await act(async()=>vi.advanceTimersByTime(15000));expect(result.error?.message).toContain('did not respond');
  await act(async()=>u.onstart());expect(result.speaking).toBeNull();expect(result.preparing).toBeNull();
 }finally{vi.useRealTimers();}
});
it('cancels device speech on navigation',async()=>{
 const synth=deviceSpeech();await act(async()=>speak());const u=synth.speak.mock.calls[0][0];
 await act(async()=>root.unmount());expect(synth.cancel).toHaveBeenCalled();
 await act(async()=>u.onend());expect(synth.speak).toHaveBeenCalledOnce();root=createRoot(document.createElement('div'));
});

it('keeps supplementary Unicode characters intact in every speech chunk',async()=>{
 const synth=deviceSpeech(),text=('a'.repeat(199)+'😀𐐀'+'b'.repeat(199)+'🚀 ').repeat(3);
 await act(async()=>result.speak('one','conversation',text,vi.fn()));
 const chunks:string[]=[];
 while(result.speaking){
  const u=synth.speak.mock.calls.at(-1)![0];chunks.push(u.text);
  expect(u.text).not.toMatch(/[\uD800-\uDFFF]/u);
  await act(async()=>{u.onstart();u.onend();});
 }
 expect(chunks.length).toBeGreaterThan(1);expect(chunks.join('')).toBe(text);
});
