import type { VoiceLiveSession } from '@herts/plugin-api/types';
import type { LiveEvent, Transport } from './controller';

export class BrowserTransport implements Transport {
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private microphone?: MediaStream;
  private readonly audio = new Audio();
  private disposed = false;
  private stopped = false;
  private muted = false;
  private iceTimer?: ReturnType<typeof setTimeout>;
  private finishIce?: () => void;

  constructor(private event: (event: LiveEvent) => void, private lost: () => void) {
    this.audio.autoplay = true;
  }

  async start(create: (sdp: string) => Promise<VoiceLiveSession>) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (this.disposed || this.stopped) { microphone.getTracks().forEach(track => track.stop()); return; }
    this.microphone = microphone;
    for (const track of microphone.getAudioTracks()) track.addEventListener('ended', () => {
      if (!this.stopped && !this.disposed) this.lost();
    });
    const peer = new RTCPeerConnection(); this.peer = peer;
    peer.addEventListener('track', event => {
      if (this.disposed || this.stopped) { event.track.stop(); return; }
      this.audio.srcObject = new MediaStream([event.track]);
      void this.audio.play().catch(() => { if (!this.stopped && !this.disposed) this.lost(); });
    });
    peer.addEventListener('connectionstatechange', () => {
      if (!this.disposed && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) this.lost();
    });
    for (const track of microphone.getAudioTracks()) peer.addTrack(track, microphone);
    const channel = peer.createDataChannel('oai-events'); this.channel = channel;
    channel.addEventListener('message', event => {
      if (this.disposed || typeof event.data !== 'string' || event.data.length > 256000) return;
      let parsed: LiveEvent;
      try { parsed = JSON.parse(event.data); } catch { return; }
      if (parsed && typeof parsed.type === 'string') this.event(parsed);
    });
    channel.addEventListener('close', () => { if (!this.disposed) this.lost(); });
    channel.addEventListener('error', () => { if (!this.disposed) this.lost(); });
    await peer.setLocalDescription(await peer.createOffer());
    if (peer.iceGatheringState !== 'complete' && !this.disposed) await new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(this.iceTimer); peer.removeEventListener('icegatheringstatechange', changed);
        this.finishIce = undefined; resolve();
      };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      this.finishIce = finish;
      peer.addEventListener('icegatheringstatechange', changed);
      this.iceTimer = setTimeout(finish, 10_000);
      changed();
    });
    if (this.disposed || this.stopped) return;
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error('SDP unavailable');
    const result = await create(sdp);
    if (this.disposed) return;
    await peer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
  }

  send(event: Record<string, unknown>) {
    if (this.disposed || this.channel?.readyState !== 'open') return false;
    try { this.channel.send(JSON.stringify(event)); return true; }
    catch { this.lost(); return false; }
  }
  mute(value: boolean) {
    if (this.stopped || this.disposed) return;
    this.muted = value;
    this.microphone?.getAudioTracks().forEach(track => { track.enabled = !this.muted; });
    this.send({ type: value ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
  }
  stopMedia() {
    this.stopped = true;
    this.microphone?.getTracks().forEach(track => track.stop());
    this.audio.pause();
    const stream = this.audio.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    this.audio.srcObject = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stopMedia(); this.finishIce?.();
    this.channel?.close(); this.peer?.close();
  }
}

export async function acquireCallLock(): Promise<() => void> {
  if (!navigator.locks) throw new Error('This browser cannot coordinate calls. Use current Chrome.');
  return new Promise((resolve, reject) => {
    void navigator.locks.request('herts:calls', { ifAvailable: true }, lock => {
      if (!lock) { reject(new Error('A call is open in another Herts window. End that call first.')); return; }
      return new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
