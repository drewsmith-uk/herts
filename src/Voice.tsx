import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, X } from 'lucide-react';
import { db, addFile, uploadFile, api, ApiError } from './data';
import { deleteRecording, queueTranscriptionDiscard, flushTranscriptionDiscards } from './fileRetention';
import { useUpdatePreparation } from './updateSafety';
const consumedRequests = new Set<string>();
export type VoiceMode = 'idle' | 'starting' | 'recording' | 'transcribing';
export function Voice({ owner, onTranscript, startRequest, disabled = false, onModeChange, onRecording }: { owner: string; onTranscript: (text: string, fresh: boolean) => void | Promise<void>; startRequest?: string; disabled?: boolean; onModeChange?: (mode: VoiceMode) => void; onRecording?: () => Promise<unknown> }) {
  const [mode, setMode] = useState<VoiceMode>('idle'); const [error, setError] = useState(''); const [saved, setSaved] = useState<string[]>([]);
  const generation = useRef(0); const recorder = useRef<MediaRecorder | null>(null); const chain = useRef(Promise.resolve()); const cancelled = useRef(false); const mounted = useRef(true);
  const currentMode = useRef<VoiceMode>('idle'), handledRequest = useRef<string | undefined>(undefined);
  useUpdatePreparation({ blocked: () => currentMode.current !== 'idle' ? 'Finish or cancel dictation before updating.' : undefined });
  const transcriptHandler = useRef(onTranscript); transcriptHandler.current = onTranscript;
  const callbacks = useRef({ onModeChange, onRecording }); callbacks.current = { onModeChange, onRecording };
  function changeMode(next: VoiceMode) { currentMode.current = next; setMode(next); callbacks.current.onModeChange?.(next); }
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
    if (!startRequest || disabled || consumedRequests.has(startRequest) || startRequest === handledRequest.current) return;
    handledRequest.current = startRequest; consumedRequests.add(startRequest);
    if (consumedRequests.size > 100) consumedRequests.delete(consumedRequests.values().next().value!);
    if (document.hidden) { setError('Tap Dictate when you are ready to record.'); return; }
    void start();
  }, [startRequest, disabled]);
  async function transcribe(id: string, fresh = false) {
    const attempt = ++generation.current; setError(''); changeMode('transcribing');
    try {
      const r = await db.recordings.get(id); if (!r?.chunks.length) throw new Error('No recoverable audio was recorded.');
      const blob = new Blob(r.chunks, { type: r.type });
      const request = r.transcription || { id: crypto.randomUUID(), uploadId: await addFile(blob, `dictation.${r.type.includes('mp4') ? 'm4a' : 'webm'}`,owner.startsWith('plugin:')?owner.split(':').slice(1,3).join(':'):undefined) };
      if (!await db.recordings.update(id, { transcription: request })) throw new Error('This recording was deleted.');
      await uploadFile(request.uploadId);
      let result: { transcript: string };
      try { result = await api('/audio/transcribe', { ...request, ...(owner.startsWith('chat:') ? { contextId: owner.slice(5) } : {}) }); }
      catch (error) {
        if (error instanceof ApiError && [409, 410].includes(error.status)) {
          // A new request requires another deliberate tap; never resend here.
          await queueTranscriptionDiscard({ transcription: request });
          await db.recordings.update(id, { transcription: undefined });
          void flushTranscriptionDiscards();
        }
        throw error;
      }
      if (!result.transcript) {
        await queueTranscriptionDiscard({ transcription: request });
        await db.recordings.update(id, { transcription: undefined });
        void flushTranscriptionDiscards();
        throw new Error('No speech detected. The recording is saved.');
      }
      if (mounted.current && attempt === generation.current && !cancelled.current) { await transcriptHandler.current(result.transcript, fresh && !document.hidden && navigator.onLine); await deleteRecording(id); }
    } catch (e) { if (mounted.current && attempt === generation.current) setError((e as Error).message); }
    finally { if (mounted.current && attempt === generation.current) { changeMode('idle'); reload(); } }
  }
  async function start() {
    if (disabled || currentMode.current !== 'idle' || document.hidden) return;
    const attempt = ++generation.current; setError(''); cancelled.current = false; changeMode('starting'); let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || attempt !== generation.current || cancelled.current || document.hidden) { stream.getTracks().forEach(t => t.stop()); if (mounted.current && attempt === generation.current) changeMode('idle'); return; }
      const type = ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const id = crypto.randomUUID(); recorder.current = r;
      await callbacks.current.onRecording?.();
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
    <button type="button" className={`icon-button ${mode === 'recording' ? 'recording' : ''}`} aria-label={mode === 'recording' ? 'Stop recording and transcribe' : 'Dictate'} title={mode === 'recording' ? 'Stop and transcribe' : 'Dictate'} disabled={disabled || mode === 'starting' || mode === 'transcribing'} onClick={() => mode === 'recording' ? recorder.current?.stop() : void start()}>{mode === 'recording' ? <Square size={18}/> : <Mic size={19}/>}</button>
    {mode !== 'idle' && <span className="voice-state"><span role="status">{mode === 'recording' ? 'Recording…' : mode === 'starting' ? 'Starting microphone…' : 'Transcribing…'}</span> <button type="button" className="icon-button" aria-label="Cancel dictation" onClick={cancel}><X size={15}/></button></span>}
    {(error || saved.length > 0 && mode === 'idle') && <div className="voice-feedback">
      {error && <span className="inline-error" role="alert">{error}</span>}
      {saved.length > 0 && mode === 'idle' && <span className="saved-recordings">{saved.map(id => <span key={id}><button type="button" className="text-button" onClick={() => { cancelled.current = false; void transcribe(id); }}><RotateCcw size={13}/> Transcribe saved recording</button><button type="button" className="icon-button" aria-label="Delete saved recording" onClick={() => { void deleteRecording(id).then(() => { setError(''); reload(); }).catch(e => setError(e.message)); }}><X size={13}/></button></span>)}</span>}
    </div>}
  </div>;
}
