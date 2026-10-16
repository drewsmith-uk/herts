import { unified } from 'unified';
import remarkParse from 'remark-parse';

const parser = unified().use(remarkParse);
type Node = { type: string; value?: string; alt?: string; children?: Node[] };
export function messagePreview(text: string, attachments = 0): string {
  let files = attachments;
  const clean = text.replace(/(?:@(?:file|image):|\bMEDIA:)[ \t]*(?:"[^"]+"|'[^']+'|`[^`]+`|[^\s<>]+)/g, () => { files++; return ''; });
  function content(node: Node): string {
    if (node.type === 'image') { files++; return node.alt || ''; }
    if (node.type === 'html') return '';
    if (node.value !== undefined) return node.value;
    const separator = ['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link'].includes(node.type) ? '' : ' ';
    return (node.children || []).map(content).join(separator);
  }
  const preview = content(parser.parse(clean) as Node).replace(/\s+/g, ' ').trim();
  return preview || (files ? `${files} attachment${files === 1 ? '' : 's'}` : '');
}
export function compactDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' as const }) }).format(at);
}
export function readingTitle(title: string, url: string): string {
  if (title.trim() && title.trim() !== url) return title;
  try { const parsed = new URL(url); return parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname); } catch { return title || url; }
}
