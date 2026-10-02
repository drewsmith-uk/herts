import { messageText, type ChatMessage } from './core';

export interface MediaRef { path: string; name: string; image: boolean }
export function localMediaPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) return;
  if (value.startsWith('/api/media?') || value.startsWith('/api/fs/download?') || value.startsWith('/api/files/download?')) return new URL(value, 'http://localhost').searchParams.get('path') || undefined;
  if (/^(?:https?:|data:|blob:|javascript:|\/\/)/i.test(value)) return;
  if (value.startsWith('file://')) {
    try { const path = decodeURIComponent(value.slice(7)); return /[\u0000-\u001f\u007f]/.test(path) ? undefined : path || undefined; }
    catch { return; }
  }
  if (/^(?:\/|~\/|\.\.?\/|attachments\/)/.test(value)) return value;
}
export function mediaRefs(message: ChatMessage): MediaRef[] {
  const values: string[] = [], text = messageText(message);
  for (const match of text.matchAll(/@(?:file|image):(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s<>]+))/g)) values.push(match[1] || match[2] || match[3] || match[4]);
  for (const match of text.matchAll(/!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) values.push(match[1] || match[2]);
  if (Array.isArray(message.content)) for (const part of message.content as any[]) { const url = typeof part?.image_url === 'string' ? part.image_url : part?.image_url?.url; if (typeof url === 'string') values.push(url); }
  return [...new Set(values.map(localMediaPath).filter((s): s is string => !!s))].map(path => ({ path, name: path.split('/').pop() || 'Attachment', image: /\.(png|jpe?g|webp|gif|bmp)$/i.test(path) }));
}
