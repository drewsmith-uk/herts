import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
const replacements = new Map([
  ['utilize', 'use'], ['utilise', 'use'], ['leverage', 'use'],
  ['facilitate', 'help'], ['aforementioned', 'name the item'],
  ['whilst', 'while'], ['in order to', 'to'], ['prior to', 'before'],
]);
const contractions = /\b(?:\w+n['’]t|(?:i|you|we|they|he|she|it|that|there|what)['’](?:re|ve|ll|d|m|s))\b/gi;

// Keep code and URLs out of vocabulary checks. Count each as one technical term.
function prose(node) {
  if (node.type === 'inlineCode') return 'TECHNICALTERM';
  if (node.type === 'html') return ' ';
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.type === 'text') return node.value.replace(/https?:\/\/\S+/g, 'TECHNICALTERM');
  return (node.children || []).map(prose).join('');
}

export function checkMarkdown(source, file = '<text>') {
  const issues = [];
  const report = (node, message) => issues.push({ file, line: node.position.start.line, message });
  function visit(node) {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) {
      const text = prose(node).replace(/\s+/g, ' ').trim();
      // A colon ends a list introduction. Semicolons do not reset the limit.
      const sentences = text.split(/(?<=[.!?]["'”’\)\]}]*)\s+|:\s+(?=\S)|:\s*$/u);
      for (const sentence of sentences) {
        const words = sentence.match(/[\p{L}\p{N}]+(?:[-/'’.][\p{L}\p{N}]+)*/gu) || [];
        if (words.length > 20) report(node, `${words.length} words; maximum 20: ${sentence}`);
      }
      for (const match of text.matchAll(contractions)) {
        report(node, `Write the full form of "${match[0]}".`);
      }
      for (const [term, replacement] of replacements) {
        if (new RegExp(`\\b${term}\\b`, 'i').test(text)) {
          report(node, `Replace "${term}" with "${replacement}".`);
        }
      }
      return;
    }
    // Fenced code, indented code, link targets and HTML are not prose.
    for (const child of node.children || []) visit(child);
  }
  visit(parser.parse(source));
  return issues;
}

export function documentationFiles(root) {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8',
  }).split('\0');
  return [...new Set(paths)].filter(file => /\.(?:md|markdown)$/i.test(file) && existsSync(resolve(root, file))).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = documentationFiles(root);
  const issues = files.flatMap(file => checkMarkdown(readFileSync(resolve(root, file), 'utf8'), file));
  for (const issue of issues) console.error(`${issue.file}:${issue.line}: ${issue.message}`);
  if (issues.length) {
    console.error(`Documentation check failed: ${issues.length} issue(s). See docs/documentation-style.md.`);
    process.exitCode = 1;
  } else {
    console.log(`Documentation checks passed (${files.length} files). Full STE review is still required.`);
  }
}
