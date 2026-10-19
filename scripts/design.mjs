import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';
import { lint } from '@google/design.md/linter';

export const contrastPairs = [
  ['ink', ['canvas', 'surface', 'sheet', 'selected'], 7],
  ['secondary', ['canvas', 'surface', 'subtle'], 4.5],
  ['muted', ['canvas', 'surface', 'input', 'sheet'], 4.5],
  ['surface', ['primary'], 4.5], ['primary', ['canvas', 'surface', 'input'], 4.5],
  ['danger', ['surface'], 4.5], ['grip', ['input', 'canvas', 'surface', 'sheet'], 3],
];
export function contrast(a, b) {
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const values = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}
export function parseDesign(source) {
  const blocks = [source.match(/^---\n([\s\S]*?)\n---/)?.[1], ...[...source.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1])].filter(Boolean);
  const tokens = {};
  for (const block of blocks) {
    const document = parseDocument(block, { uniqueKeys: true });
    if (document.errors.length) throw new Error(document.errors[0].message);
    for (const [key, value] of Object.entries(document.toJSON())) {
      if (key in tokens) throw new Error(`Duplicate token group: ${key}`);
      tokens[key] = value;
    }
  }
  const resolve = (value, stack = []) => {
    if (typeof value !== 'string') return value;
    return value.replace(/\{([^}]+)\}/g, (_, path) => {
      if (stack.includes(path)) throw new Error(`Cyclic reference: ${path}`);
      const target = path.split('.').reduce((v, key) => v?.[key], tokens);
      if (target === undefined) throw new Error(`Unknown reference: ${path}`);
      return typeof target === 'object' ? JSON.stringify(target) : resolve(target, [...stack, path]);
    });
  };
  for (const [group, entries] of Object.entries(tokens)) {
    if (entries && typeof entries === 'object') for (const value of Object.values(entries)) {
      if (typeof value === 'object') Object.values(value).forEach(v => resolve(v)); else resolve(value);
    }
    if (['spacing', 'rounded'].includes(group)) for (const value of Object.values(entries)) {
      if (typeof value !== 'number' && !/^\d+(?:\.\d+)?(?:px|em|rem)$/.test(value)) throw new Error(`Invalid dimension: ${value}`);
    }
  }
  for (const value of Object.values(tokens.colors)) if (!/^#[\da-f]{6}$/i.test(value)) throw new Error(`Invalid colour: ${value}`);
  for (const [a, backgrounds, minimum] of contrastPairs) for (const b of backgrounds) {
    if (contrast(tokens.colors[a], tokens.colors[b]) < minimum) throw new Error(`Contrast failed: ${a} on ${b}`);
  }
  return tokens;
}
export function generate(source) {
  const t = parseDesign(source), c = t.colors;
  const roles = { background:'canvas', surface:'surface', surfaceMuted:'input', surfaceHover:'subtle', text:'ink', textSecondary:'secondary', border:'ink', controlBorder:'grip', link:'primary', primaryAction:'primary', primaryActionHover:'primary', primaryActionText:'surface', selected:'selected', selectedText:'ink', focus:'primary', sidebar:'canvas', sidebarText:'ink', sidebarMuted:'secondary', sidebarSelected:'selected', sidebarSelectedText:'ink', sidebarBorder:'ink', userMessage:'subtle', code:'input', success:'ink', successSurface:'subtle', warning:'ink', warningSurface:'selected', warningBorder:'ink', danger:'danger', dangerSurface:'surface', dangerBorder:'danger', shadow:'ink' };
  const theme = { schemaVersion:1, id:'press', name:'Press', description:t.description, mode:'light', colors:{ ...Object.fromEntries(Object.entries(roles).map(([role, token]) => [role, c[token]])), backdrop:`${c.ink}8c` }, typography:{bodyFont:t.typography.body.fontFamily, headingFont:t.typography.heading.fontFamily, monoFont:t.typography.code.fontFamily, headingWeight:t.typography.heading.fontWeight}, radii:{control:parseFloat(t.rounded.none),panel:parseFloat(t.rounded.none),small:parseFloat(t.rounded.none)}, elevation:'flat', treatment:{borderWidth:parseFloat(t.components['structural-border'].width),actionShadow:parseFloat(t.components['action-offset'].size),labels:'body',navigation:'filled'},fonts:[] };
  const css = `/* Generated from DESIGN.md. Run npm run design:generate. */\n:root {\n${Object.entries(c).map(([k,v])=>`  --design-${k}: ${v};`).join('\n')}\n${Object.entries(t.spacing).map(([k,v])=>`  --design-space-${k}: ${v};`).join('\n')}\n  --text-body: ${t.typography.body.fontSize};\n  --text-secondary: ${t.typography.control.fontSize};\n  --text-meta: ${t.typography.metadata.fontSize};\n  --design-card-weight: ${t.typography['card-title'].fontWeight};\n  --design-heading-size: ${t.typography.heading.fontSize};\n  --design-control-weight: ${t.typography.control.fontWeight};\n  --design-primary-control-weight: ${t.typography['primary-control'].fontWeight};\n  --design-button-padding: ${t.components['primary-button'].padding};\n  --design-input-padding: ${t.components['short-field'].padding};\n}\n`;
  return { 'themes/builtin/press.json': JSON.stringify(theme,null,2)+'\n', 'src/design.generated.css':css };
}
export async function checkOutput(outputs, write = false) {
  for (const [file, content] of Object.entries(outputs)) {
    if (write) await writeFile(file, content);
    else if (await readFile(file,'utf8').catch(()=> '') !== content) throw new Error(`Stale generated file: ${file}. Run npm run design:generate.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = await readFile('DESIGN.md','utf8');
  const report = await lint(source);
  for (const finding of report.findings) if (finding.severity !== 'info') console.log(`${finding.severity}: ${finding.path || ''} ${finding.message}`);
  if (report.summary.errors) throw new Error('Design schema validation failed.');
  await checkOutput(generate(source), process.argv.includes('--write'));
  console.log('Design schema, references, contrast, and generated tokens checked.');
}
