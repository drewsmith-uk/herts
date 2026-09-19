import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, X } from 'lucide-react';
import { db, addFile, uploadFile, api } from './data';
import { useUpdatePreparation } from './updateSafety';
type Mode = 'idle' | 'starting' | 'recording' | 'transcribing';
export function Voice({ owner, onTranscript, startRequest }: { owner: string; onTranscript: (text: string, fresh: boolean) => void | Promise<void>; startRequest?: string }) {
  const [mode, setMode] = useState<Mode>('idle'); const [error, setError] = useState(''); const [saved, setSaved] = useState<string[]>([]);
  const generation = useRef(0); const recorder = useRef<MediaRecorder | null>(null); const chain = useRef(Promise.resolve()); const cancelled = useRef(false); const mounted = useRef(true);
  const currentMode = useRef<Mode>('idle'), handledRequest = useRef<string | undefined>(undefined);
  useUpdatePreparation({ blocked: () => currentMode.current !== 'idle' ? 'Finish or cancel dictation before updating.' : undefined });
  const transcriptHandler = useRef(onTranscript); transcriptHandler.current = onTranscript;
  function changeMode(next: Mode) { currentMode.current = next; setMode(next); }
  function cancel() { cancelled.current = true; if (recorder.current?.state === 'recording') recorder.current.stop(); else changeMode('idle'); }
  const reload = () => { void db.recordings.where('owner').equals(owner).toArray().then(rows => { if (mounted.current) setSaved(rows.map(r => r.id)); }); };
  useEffect(() => {
    mounted.current = true; reload();
    const hidden = () => { if (document.hidden) cancel(); };
    const offline = () => { cancelled.current = true; };
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; generation.current++; cancelled.current = true; document.removeEventListener('visibilitychange', hidden); window.removeEventListener('offline', offline); if (recorder.current?.state === 'recording') recorder.current.stop(); recorder.current?.stream.getTracks().forEach(t => t.stop()); };
  }, [owner]);
  useEffect(() => {
    if (!startRequest || startRequest === handledRequest.current) return;
    handledRequest.current = startRequest;
    if (document.hidden) { setError('Tap Dictate when you are ready to record.'); return; }
    void start();
  }, [startRequest]);
  async function transcribe(id: string, fresh = false) {
    const attempt = ++generation.current; setError(''); changeMode('transcribing');
    try {
      const r = await db.recordings.get(id); if (!r?.chunks.length) throw new Error('No recoverable audio was recorded.');
      const blob = new Blob(r.chunks, { type: r.type });
      const fileId = await addFile(blob, `dictation.${r.type.includes('mp4') ? 'm4a' : 'webm'}`,owner.startsWith('plugin:')?owner.split(':').slice(1,3).join(':'):undefined); await uploadFile(fileId);
      const result = await api('/audio/transcribe', { id: crypto.randomUUID(), uploadId: fileId });
      if (!result.transcript) throw new Error('No speech detected. The recording is saved.');
      if (mounted.current && attempt === generation.current && !cancelled.current) { await transcriptHandler.current(result.transcript, fresh && !document.hidden && navigator.onLine); await db.recordings.delete(id); }
    } catch (e) { if (mounted.current && attempt === generation.current) setError((e as Error).message); }
    finally { if (mounted.current && attempt === generation.current) { changeMode('idle'); reload(); } }
  }
  async function start() {
    if (currentMode.current !== 'idle' || document.hidden) return;
    const attempt = ++generation.current; setError(''); cancelled.current = false; changeMode('starting'); let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || attempt !== generation.current || cancelled.current || document.hidden) { stream.getTracks().forEach(t => t.stop()); if (mounted.current && attempt === generation.current) changeMode('idle'); return; }
      const type = ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const id = crypto.randomUUID(); recorder.current = r;
      await db.recordings.add({ id, owner, chunks: [], type: r.mimeType || 'audio/webm', at: Date.now(), complete: false });
      if (!mounted.current || attempt !== generation.current || cancelled.current || document.hidden) { stream.getTracks().forEach(t => t.stop()); await db.recordings.delete(id); if (mounted.current && attempt === generation.current) changeMode('idle'); return; }
      let bytes = 0;
      r.ondataavailable = e => { if (e.data.size) { bytes += e.data.size; if (bytes > 24 * 1024 * 1024 && r.state === 'recording') r.stop(); } if (e.data.size) chain.current = chain.current.then(() => db.transaction('rw', db.recordings, async () => { const row = await db.recordings.get(id); if (row) { row.chunks.push(e.data); await db.recordings.put(row); } })).catch(() => { cancelled.current = true; if (mounted.current) setError('Recording stopped because device storage is full. Saved audio is retained.'); if (r.state === 'recording') r.stop(); }); };
      r.onstop = () => { stream?.getTracks().forEach(t => t.stop()); void chain.current.then(async () => { await db.recordings.update(id, { complete: true }); if (mounted.current && attempt === generation.current) { if (!cancelled.current && !document.hidden) await transcribe(id, true); else { changeMode('idle'); reload(); } } }); };
      r.start(1000); changeMode('recording');
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      if (mounted.current && attempt === generation.current) {
        if (!cancelled.current) setError((e as Error).name === 'NotAllowedError' ? 'Microphone permission is needed. Allow access in browser settings, then tap Dictate to try again.' : (e as Error).message || 'Microphone access is unavailable. Tap Dictate to try again.');
        changeMode('idle');
      }
    }
  }
  return <div className="voice-control">
    <button type="button" className={`icon-button ${mode === 'recording' ? 'recording' : ''}`} aria-label={mode === 'recording' ? 'Stop recording and transcribe' : 'Dictate'} title={mode === 'recording' ? 'Stop and transcribe' : 'Dictate'} disabled={mode === 'starting' || mode === 'transcribing'} onClick={() => mode === 'recording' ? recorder.current?.stop() : void start()}>{mode === 'recording' ? <Square size={18}/> : <Mic size={19}/>}</button>
    {mode !== 'idle' && <span className="voice-state"><span role="status">{mode === 'recording' ? 'Recording…' : mode === 'starting' ? 'Starting microphone…' : 'Transcribing…'}</span> <button type="button" className="icon-button" aria-label="Cancel dictation" onClick={cancel}><X size={15}/></button></span>}
    {error && <span className="inline-error" role="alert">{error}</span>}
    {saved.length > 0 && mode === 'idle' && <span className="saved-recordings">{saved.map(id => <span key={id}><button type="button" className="text-button" onClick={() => { cancelled.current = false; void transcribe(id); }}><RotateCcw size={13}/> Transcribe saved recording</button><button type="button" className="icon-button" aria-label="Delete saved recording" onClick={() => { void db.recordings.delete(id).then(reload); }}><X size={13}/></button></span>)}</span>}
  </div>;
}
