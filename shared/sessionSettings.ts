export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = typeof efforts[number];
export interface ModelChoice { provider: string; id: string }
export interface SessionValues { model?: ModelChoice; effort?: Effort; fast?: boolean; cwd?: string }
export type SettingKey = keyof SessionValues;
export const settingKeys: SettingKey[] = ['model', 'effort', 'fast', 'cwd'];
export interface SettingsRecord { revision: number; values: SessionValues; baseline?: SessionValues }
export interface SettingsState { defaults: SettingsRecord; conversations: Record<string, SettingsRecord> }
export const emptySettings = (): SettingsState => ({ defaults: { revision: 0, values: {} }, conversations: {} });
export interface ModelOption { provider: string; providerName: string; id: string; reasoning?: boolean; fast?: boolean; canDisableReasoning?: boolean; available: boolean }
export interface SettingsView {
  defaults: SettingsRecord; pending: SettingsRecord; current: SessionValues; profile: SessionValues;
  source: 'live' | 'saved' | 'profile' | 'unknown'; wireEffort?: string;
  models: ModelOption[]; available: boolean; error?: string; uncertain: boolean;
}
export interface SendSettings {
  revision: number; values: SessionValues; baseline?: SessionValues; applied: SettingKey[];
  inFlight?: SettingKey; confirmation?: string; confirmedModel?: boolean;
}
export function sameSetting(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.entries(a).filter(([, v]) => v !== undefined), right = Object.entries(b).filter(([, v]) => v !== undefined);
  return left.length === right.length && left.every(([k, v]) => Object.hasOwn(b, k) && sameSetting(v, (b as Record<string, unknown>)[k]));
}
export function hasSettings(values?: SessionValues) { return !!values && settingKeys.some(k => values[k] !== undefined); }
export function effectiveSettings(view: Pick<SettingsView, 'current' | 'profile' | 'defaults' | 'pending'>, isNew: boolean): SessionValues {
  return { ...(isNew ? { ...view.profile, ...view.defaults.values } : view.current), ...view.pending.values };
}
