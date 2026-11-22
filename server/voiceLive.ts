import { z } from 'zod';
import type { ActionEffects } from '../shared/bots.js';
import type { VoiceLiveServices, VoiceLiveSession, VoiceLiveStatus } from '../shared/voice.js';
import { voiceLiveGreetingInstructions } from '../shared/voice.js';
import { messageText } from '../shared/core.js';
import { Gateway, GatewayError } from './gateway.js';
import type { Store } from './store.js';

const contextIdSchema = z.string().uuid();
const createSchema = z.object({ contextId: contextIdSchema, sdp: z.string().min(1).max(65536) }).strict();

export class VoiceLive implements VoiceLiveServices {
  constructor(private store: Store, private gateway: Gateway) {}

  private context(id: string) {
    const context = this.store.context(contextIdSchema.parse(id));
    if (!context?.link) throw new GatewayError('Open a linked conversation before starting a call.');
    return context;
  }

  async status(contextId?: string): Promise<VoiceLiveStatus> {
    const profile = contextId === undefined ? this.gateway.profile : this.context(contextId).profile || this.gateway.profile;
    try {
      const value = await this.gateway.http(`/api/audio/voice-live/status?profile=${encodeURIComponent(profile)}`);
      return z.object({ available: z.boolean(), mode: z.string().max(80), model: z.string().max(200), voice: z.string().max(80) }).parse(value);
    } catch {
      throw new GatewayError('Hermes voice status is unavailable. Check the connection and Hermes voice support.');
    }
  }

  async create(raw: { contextId: string; sdp: string }, effects: ActionEffects): Promise<VoiceLiveSession> {
    const input = createSchema.parse(raw);
    if (!input.sdp.trim()) throw new GatewayError('An SDP offer is required.');
    const context = this.context(input.contextId);
    const profile = context.profile || this.gateway.profile;
    const status = await this.status(context.id);
    if (!status.available || status.mode !== 'gpt-live')
      throw new GatewayError('Configure GPT-Live for this Hermes profile, then retry.');
    const history = await this.gateway.withProfile(profile, () => this.gateway.history(context.link!.storedId, 0, 'latest'));
    let budget = 6000;
    const seed: { type: 'message'; role: 'assistant' | 'user' | 'developer'; content: { type: string; text: string }[] }[] = [];
    for (const message of [...history.messages].reverse()) {
      if (message.role !== 'assistant' && message.role !== 'user') continue;
      const text = messageText(message).trim().slice(0, Math.min(1200, budget));
      if (!text || !budget || seed.length >= 24) continue;
      budget -= text.length;
      seed.unshift({ type: 'message', role: message.role, content: [{ type: message.role === 'user' ? 'input_text' : 'output_text', text }] });
    }
    seed.unshift({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: voiceLiveGreetingInstructions }] });
    return effects.effect('create voice session', async () => {
      let value: unknown;
      try {
        value = await this.gateway.http(`/api/audio/voice-live/session?profile=${encodeURIComponent(profile)}`, { sdp: input.sdp, history: seed });
      } catch (error) {
        const uncertain = !(error instanceof GatewayError) || error.uncertain;
        throw new GatewayError(uncertain
          ? 'Call setup was not confirmed. Check its status before starting another call.'
          : 'Hermes could not start the call. Check its GPT-Live configuration, then retry.', uncertain);
      }
      const parsed = z.object({
        session: z.object({ id: z.string().min(1).max(200) }),
        transport: z.object({ type: z.literal('webrtc'), sdp: z.string().min(1).max(65536) }),
      }).safeParse(value);
      if (!parsed.success) throw new GatewayError('Call setup returned an invalid response. Check its status before starting another call.', true);
      return parsed.data;
    });
  }
}
