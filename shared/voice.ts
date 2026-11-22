import type { ActionEffects } from './bots.js';

export const voiceLiveGreeting = "Hi, I’m ready. How can I help?";
export const voiceLiveGreetingInstructions = `At the start of this call, briefly greet the user: "${voiceLiveGreeting}" Then listen. Do not delegate the greeting or treat it as a user request.`;

export interface VoiceLiveStatus {
  available: boolean;
  mode: string;
  model: string;
  voice: string;
}
export interface VoiceLiveSession {
  session: { id: string };
  transport: { type: 'webrtc'; sdp: string };
}
export interface VoiceSend {
  callId: string;
  delegationId: string;
  context: string;
}
export interface VoiceLiveServices {
  status(contextId?: string): Promise<VoiceLiveStatus>;
  create(input: { contextId: string; sdp: string }, effects: ActionEffects): Promise<VoiceLiveSession>;
}
