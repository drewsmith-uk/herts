import { LoaderCircle, Square, Volume2 } from "lucide-react";
const messageTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function MessageTime({ timestamp }: { timestamp?: number }) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return <time className="message-time" dateTime={date.toISOString()} title={date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{messageTimeFormat.format(date)}</time>;
}
export function MessageAuthor({name,timestamp,mark,speaking,preparing,speechError,onSpeak}:{name:string;timestamp?:number;mark?:string;speaking?:boolean;preparing?:boolean;speechError?:string;onSpeak?:()=>void}) {
 return <><div className="message-author">{mark&&<span className="hermes-mark">{mark}</span>}{name}<MessageTime timestamp={timestamp}/>{onSpeak&&<button className="read-aloud icon-button" aria-label={preparing?'Cancel audio preparation':speaking?'Stop reading aloud':'Read response aloud'} title={preparing?'Cancel audio preparation':speaking?'Stop reading aloud':'Read response aloud'} onClick={onSpeak}>{preparing?<LoaderCircle size={16} className="spin"/>:speaking?<Square size={15}/>:<Volume2 size={16}/>}</button>}</div>{preparing&&<p className="subtle-note" role="status">Preparing audio…</p>}{speechError&&<p className="inline-error" role="alert">Read aloud failed: {speechError}</p>}</>;
}
