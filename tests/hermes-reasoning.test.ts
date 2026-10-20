import { describe, expect, it } from 'vitest';
import { inheritedEffort } from '../server/hermesReasoning';

describe('Hermes inherited effort compatibility', () => {
  it.each([false, 'none', 'false', 'disabled', { enabled: false }])('preserves disabled reasoning: %j', value => {
    expect(inheritedEffort({ agent: { reasoning_effort: value } }, 'model')).toBe('none');
  });
  it.each(['high', { enabled: true, effort: 'high' }])('reads supported profile forms: %j', value => {
    expect(inheritedEffort({ agent: { reasoning_effort: value } }, 'model')).toBe('high');
  });
  it.each([true, null, '', 'hgih', { enabled: true }, []])('does not invent effort from %j', value => {
    expect(inheritedEffort({ agent: { reasoning_effort: value } }, 'model')).toBeUndefined();
  });
  it.each([
    ['openrouter/anthropic/claude-4.5', 'claude-4-5'],
    ['claude-4.5', 'anthropic/claude-4-5'],
    ['qwen3.6:27b', 'ollama-local/qwen3.6:27b'],
  ])('matches model spelling %s to %s', (model, key) => {
    expect(inheritedEffort({ agent: { reasoning_effort: 'medium', reasoning_overrides: { [key]: 'xhigh' } } }, model)).toBe('xhigh');
  });
  it('prefers the exact model and ignores unrelated overrides', () => {
    const agent = { reasoning_effort: 'medium', reasoning_overrides: { model: 'low', 'custom/model': 'high', other: 'ultra' } };
    expect(inheritedEffort({ agent }, 'custom/model')).toBe('high');
    expect(inheritedEffort({ agent }, 'different')).toBe('medium');
  });
  it('uses the configured model when no session model is stored', () => {
    expect(inheritedEffort({ model: 'configured', agent: { reasoning_effort: 'medium', reasoning_overrides: { configured: false } } })).toBe('none');
  });
});
