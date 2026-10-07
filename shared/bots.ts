import type { ConversationContext } from './conversations.js';
export interface Bot {
  name: string; title: string; description: string; model: string; provider: string;
  hidden: boolean; hasAvatar: boolean; contextId?: string; preview: string; updatedAt: number; active: boolean;
}
export interface BotDetails extends Bot { soul: string; revision: number; }
export interface BotSettings {
  name: string; title: string; description: string; soul?: string; model?: string; provider?: string;
  cloneFrom?: string; mirrorCredentials?: boolean; revision?: number; hidden?: boolean;
}
export interface Routine {
  id: string; profile: string; name: string; prompt: string; schedule: string; deliver: string;
  enabled: boolean; revision?: string; nextRun?: string; lastRun?: string; status?: string; error?: string;
}
export interface RoutineInput { profile: string; id?: string; name?: string; prompt?: string; schedule?: string; deliver?: 'bot-chat' | 'local'; expectedRevision?: string; }
export interface RoutineRun { id: string; title: string; status: string; at?: string; preview: string; conversationId?: string; }
export interface RemoteAction {
  id: string; pluginId: string; command: string; state: 'pending' | 'finished' | 'failed' | 'unknown';
  result?: unknown; error?: string; createdAt: number; reviewedAt?:number;
  subject?: { profile: string; routineId?: string; operation?: string; title?: string };
}
/** Every remote effect is durably recorded before dispatch; completed steps are reusable. */
export interface ActionEffects { id: string; check(): void; effect<T>(name: string, run: () => Promise<T>): Promise<T>; }
export interface HermesServices {
  onChange?(listener: () => void): () => void;
  bots(): Promise<Bot[]>;
  describeBot(name: string): Promise<BotDetails>;
  botAvatar(name: string): Promise<string | undefined>;
  models(name?: string): Promise<{ id: string; provider: string; providerName?: string; available: boolean }[]>;
  routineSpeech(profile:string,id:string,run:string,offset:number,index:number):Promise<unknown>;
  openBot(name: string, effects: ActionEffects): Promise<ConversationContext>;
  createBot(input: BotSettings, effects: ActionEffects): Promise<ConversationContext>;
  configureBot(input: BotSettings, effects: ActionEffects): Promise<void>;
  routines(profile: string): Promise<{ jobs: Routine[]; timezone: string }>;
  routineResult(profile: string, id: string, run: string, offset?: number): Promise<{ text: string; hasMore: boolean; nextOffset: number; conversationId?:string; messages?:{role:string;text:string;timestamp?:number;index:number}[] }>;
  routineRuns(profile: string, id: string): Promise<RoutineRun[]>;
  changeRoutine(action: 'create' | 'update' | 'pause' | 'resume' | 'remove' | 'run', input: RoutineInput, effects: ActionEffects): Promise<void>;
}
