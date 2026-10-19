import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { generate, parseDesign, checkOutput } from '../scripts/design.mjs';
const source = await readFile('DESIGN.md', 'utf8');
describe('design authority', () => {
  it('matches committed application tokens', async () => { await checkOutput(generate(source)); });
  it('rejects missing references', () => { expect(() => parseDesign(source.replace('{colors.primary}', '{colors.missing}'))).toThrow('Unknown reference'); });
  it('rejects invalid spacing dimensions', () => { expect(() => parseDesign(source.replace('tight: "4px"', 'tight: "4px 8px"'))).toThrow('Invalid dimension'); });
  it('rejects unreadable palette changes', () => { expect(() => parseDesign(source.replace('ink: "#161511"', 'ink: "#FFFFFF"'))).toThrow('Contrast failed'); });
  it('rejects stale generated output without rewriting it', async () => { await expect(checkOutput({ 'themes/builtin/press.json': 'stale' })).rejects.toThrow('Stale generated'); });
});
