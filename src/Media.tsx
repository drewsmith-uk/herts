import { useEffect, useState } from 'react';
import { Paperclip, Download } from 'lucide-react';
import { mediaRefs, type MediaRef } from '../shared/media';
import type { ChatMessage, HistoryOrder } from '../shared/core';
import { api, cacheRead, db } from './data';

export function MessageMedia({ message, conversationId, offset, index, order = 'oldest' }: { message: ChatMessage; conversationId: string; offset: number; index: number; order?: HistoryOrder }) {
  return <div className="message-files">{mediaRefs(message).map(ref => <Media key={ref.path} media={ref} conversationId={conversationId} offset={offset} index={index} order={order}/>)}</div>;
}
function Media({ media, conversationId, offset, index, order = 'oldest' }: { media: MediaRef; conversationId: string; offset: number; index: number; order?: HistoryOrder }) {
  const key = `media:${conversationId}:${media.path}`;
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError('');
    try { const result = await cacheRead(key, () => api('/media', { conversationId, offset, index, order, path: media.path })); setUrl(result.value.dataUrl); }
    catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { let alive = true; void db.kv.get(key).then(row => { if (alive && row) setUrl(row.value.dataUrl); }); return () => { alive = false; }; }, [key]);
  // Files are fetched deliberately. Once opened, the bytes remain available offline.
  return <div className="message-file">{url && media.image && /^data:image\/(png|jpeg|webp|gif|bmp);base64,/.test(url) && <img src={url} alt={media.name} loading="lazy"/>}<div><Paperclip size={15}/><span>{media.name}</span>{url ? <a href={url} download={media.name}><Download size={16}/> Download saved file</a> : <button disabled={busy} onClick={() => void load()}>{busy ? 'Opening…' : media.image ? 'View image' : 'Open file'}</button>}</div>{error && <p className="inline-error">{error}</p>}</div>;
}
