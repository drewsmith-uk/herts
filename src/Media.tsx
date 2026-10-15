import { useEffect, useRef, useState } from 'react';
import { Paperclip, Download } from 'lucide-react';
import { mediaRefs, type MediaRef } from '../shared/media';
import type { ChatMessage, HistoryOrder } from '../shared/core';
import { api, cacheRead, db } from './data';
import { Button, StatusMessage } from './ui';

export function MessageMedia({ message, conversationId, offset, index, order = 'oldest' }: { message: ChatMessage; conversationId: string; offset: number; index: number; order?: HistoryOrder }) {
  return <div className="message-files">{mediaRefs(message).map(ref => <Media key={`${conversationId}:${offset}:${index}:${order}:${ref.path}`} media={ref} conversationId={conversationId} offset={offset} index={index} order={order}/>)}</div>;
}
function Media({ media, conversationId, offset, index, order = 'oldest' }: { media: MediaRef; conversationId: string; offset: number; index: number; order?: HistoryOrder }) {
  const key = `media:${conversationId}:${media.path}`;
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const active = useRef(false), pending = useRef(false);
  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = url || (await db.kv.get(key))?.value?.dataUrl;
      const dataUrl = saved || (await cacheRead(key, () => api('/media', { conversationId, offset, index, order, path: media.path }))).value.dataUrl;
      if (!active.current) return;
      setUrl(dataUrl);
      if (!media.image) {
        const link = document.createElement('a');
        link.href = dataUrl; link.download = media.name;
        document.body.append(link); link.click(); link.remove();
      }
    } catch(e) { if (active.current) setError((e as Error).message); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true;
    let alive = true;
    void db.kv.get(key).then(row => { if (alive && row) setUrl(row.value.dataUrl); }).catch(() => {});
    return () => { alive = false; active.current = false; };
  }, [key]);
  return <div className="message-file">{url && media.image && /^data:image\/(png|jpeg|webp|gif|bmp);base64,/.test(url) && <img src={url} alt={media.name} loading="lazy"/>}<div><Paperclip size={15}/><span>{media.name}</span>{media.image && url ? <a href={url} download={media.name}><Download size={16}/> Download image</a> : <Button disabled={busy} onClick={() => void load()}>{busy ? 'Fetching file…' : media.image ? 'View image' : 'Download file'}</Button>}</div>{error && <StatusMessage>{error}</StatusMessage>}</div>;
}
