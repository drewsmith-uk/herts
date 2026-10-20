import { efforts, type Effort } from '../shared/sessionSettings.js';

function effort(value: unknown): Effort | undefined {
  if (value === false) return 'none';
  if (value && typeof value === 'object') {
    const config = value as Record<string, unknown>;
    return config.enabled === false ? 'none' : effort(config.effort);
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (['none', 'false', 'disabled'].includes(text)) return 'none';
  return efforts.includes(text as Effort) ? text as Effort : undefined;
}
function variants(model: string): string[] {
  const result = new Set<string>();
  const add = (value: string) => { if (value) result.add(value); };
  const forms = (value: string) => {
    const dashed = value.replaceAll('.', '-'), dotted = value.replaceAll('-', '.');
    [value, dashed, dotted, value.replace(/(\d)-(\d)/g, '$1.$2'), value.replace(/(\d)\.(\d)/g, '$1-$2'),
      dashed.replace(/(\d)-(\d)/g, '$1.$2'), dotted.replace(/(\d)\.(\d)/g, '$1-$2')].forEach(add);
  };
  forms(model);
  const parts = model.split('/');
  if (parts.length >= 2) forms(parts.at(-1)!);
  if (parts.length >= 3) forms(parts.slice(1).join('/'));
  for (const value of [...result].filter(v => !v.includes('/'))) {
    for (const provider of ['anthropic', 'openai', 'google', 'openrouter', 'groq', 'mistral', 'xai', 'cohere', 'perplexity', 'together', 'fireworks', 'deepseek']) add(`${provider}/${value}`);
  }
  for (const value of [...result].filter(v => v.split('/').length === 2)) {
    for (const provider of ['openrouter', 'opencode', 'fireworks', 'groq', 'together']) add(`${provider}/${value}`);
  }
  return [...result];
}
export function inheritedEffort(config: any, model?: string): Effort | undefined {
  const selected = model || (typeof config.model === 'string' ? config.model : config.model?.default) || '';
  const agent = config.agent || {}, overrides = agent.reasoning_overrides;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides) && selected) {
    const names = variants(selected);
    for (const name of names) { const value = effort(overrides[name]); if (value) return value; }
    for (const [name, raw] of Object.entries(overrides)) {
      const parts = name.split('/');
      if (parts.length < 2) continue;
      const forms = [...variants(parts.at(-1)!), ...(parts.length >= 3 ? variants(parts.slice(1).join('/')) : [])];
      const value = effort(raw);
      if (value && forms.some(form => names.includes(form))) return value;
    }
  }
  return effort(agent.reasoning_effort);
}
