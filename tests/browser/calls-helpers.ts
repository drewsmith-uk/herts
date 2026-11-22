import { expect, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';

export async function callsPlugin(request: APIRequestContext, action: 'enable' | 'disable') {
  const { catalogue } = await (await request.get('/api/v1/plugins')).json();
  expect((await request.post('/api/v1/plugins/calls/manage', { headers: { 'x-herts-request': '1' }, data: { action, revision: catalogue.revision } })).ok()).toBe(true);
}

export async function syntheticCall(context: BrowserContext) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    const fixture = { events: [] as any[], tracks: [] as MediaStreamTrack[], peers: 0, closed: 0, autoClose: true, denyMicrophone: false, holdSession: false, blockSound: false, ready: false,
      tones: [] as AudioContext[], pulses: 0,
      event: (_event: unknown) => {}, hidden: () => {} };
    (window as any).callFixture = fixture;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      resume() {
        fixture.tones.push(this);
        return fixture.blockSound ? Promise.reject(new Error('Synthetic audio refusal')) : super.resume();
      }
      createOscillator() { fixture.pulses++; return super.createOscillator(); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      if (fixture.denyMicrophone) throw new DOMException('Synthetic denial', 'NotAllowedError');
      const audio = new AudioContext(), stream = audio.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); void audio.close().catch(() => {}); };
      }
      fixture.tracks.push(...stream.getTracks()); return stream;
    };
    class Channel extends EventTarget {
      readyState = 'open';
      send(raw: string) {
        const event = JSON.parse(raw); fixture.events.push(event);
        if (event.type === 'session.close' && fixture.autoClose) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'session.closed', usage: { seconds: 3 } }) })));
      }
      close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
    }
    class Peer extends EventTarget {
      iceGatheringState = 'complete'; connectionState = 'connected'; localDescription?: { sdp: string }; channel = new Channel();
      constructor() { super(); fixture.peers++; fixture.event = event => this.channel.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
      addTrack() {}
      createDataChannel() { return this.channel; }
      async createOffer() { return { type: 'offer', sdp: 'synthetic-offer\r\n' }; }
      async setLocalDescription(offer: { sdp: string }) { this.localDescription = offer; }
      async setRemoteDescription() { fixture.ready = true; if (!fixture.holdSession) queueMicrotask(() => fixture.event({ type: 'session.started', session: { id: 'live_fixture' } })); }
      close() { fixture.closed++; this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
    }
    (window as any).RTCPeerConnection = Peer;
    fixture.hidden = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
}

export async function openCalls(page: Page, request: APIRequestContext) {
  const result = await request.post('/api/v1/conversations/calls-fixture/context', { headers: { 'x-herts-request': '1' }, data: {} });
  expect(result.ok()).toBe(true);
  const { context } = await result.json();
  await page.goto(`/#/plugins/calls/${context.id}`);
  await expect(page.getByRole('button', { name: 'Start call', exact: true })).toBeEnabled();
  return context;
}
