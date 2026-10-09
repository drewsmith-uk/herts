import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkMarkdown, documentationFiles } from '../scripts/check-docs.mjs';

const long = Array(21).fill('word').join(' ');
test('rejects long prose, including wrapped paragraphs, lists, tables and link labels', () => {
  for (const source of [long, long.replaceAll(' ', '\n'), `- ${long}`, `| Heading |\n| --- |\n| ${long} |`, `[${long}](https://example.com)`]) {
    assert.match(checkMarkdown(source)[0].message, /21 words/);
  }
  assert.equal(checkMarkdown(Array(20).fill('word').join(' ')).length, 0);
});
test('checks prose around code, formatting and technical link targets', () => {
  assert.equal(checkMarkdown('Run `npm run check:docs`. Open [the guide](https://example.com/a-long-path).').length, 0);
  assert.equal(checkMarkdown(`\`\`\`sh\n${long}\n\`\`\`\n\n    ${long}`).length, 0);
  assert.equal(checkMarkdown(`[Guide][ref]\n\n[ref]: https://example.com/${long.replaceAll(' ', '-')}`).length, 0);
  assert.equal(checkMarkdown(`**${long}**`)[0].line, 1);
  assert.equal(checkMarkdown(`![${long}](image.png)`).length, 1);
  assert.equal(checkMarkdown(`Use \`config.set model --session\` ${Array(19).fill('word').join(' ')}.`).length, 1);
});
test('checks selected wording and contractions without rejecting possessives or literal code', () => {
  assert.equal(checkMarkdown("Don't utilize this option.").length, 2);
  assert.equal(checkMarkdown('It’s ready.').length, 1);
  assert.equal(checkMarkdown("The user's draft remains saved. Use `don't` as literal text.").length, 0);
  assert.equal(checkMarkdown('Use the option. Save the draft.').length, 0);
});
test('semicolons do not hide long sentences; list introductions have separate counts', () => {
  assert.equal(checkMarkdown(`${Array(10).fill('word').join(' ')}; ${Array(11).fill('word').join(' ')}.`).length, 1);
  assert.equal(checkMarkdown('Use these options:\n\n- Save the draft.\n- Close the dialog.').length, 0);
});
test('recognizes sentence endings before closing quotes and brackets', () => {
  const valid = `Word ${Array(19).fill('word').join(' ')}`;
  for (const [open, close] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['(', ')'], ['[', ']'], ['{', '}'], ['(“', '”)']]) {
    for (const ending of ['.', '!', '?']) {
      assert.deepEqual(checkMarkdown(`${open}${valid}${ending}${close} ${valid}.`), []);
      const issues = checkMarkdown(`${open}${long}${ending}${close} ${valid}.`);
      assert.equal(issues.length, 1);
      assert.match(issues[0].message, /21 words/);
    }
    assert.equal(checkMarkdown(`${open}${valid}${close} word.`).length, 1);
    assert.equal(checkMarkdown(`${open}${valid};${close} word.`).length, 1);
  }
});
test('keeps abbreviations with a lowercase continuation in the same sentence', () => {
  for (const [open, close] of [['', ''], ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['(', ')'], ['[', ']'], ['{', '}'], ['(“', '”)']]) {
    const company = `${open}Acme Inc.${close}`;
    const valid = `Before you approve the request from ${company} check that the supplier has provided all required documents for this installation.`;
    assert.deepEqual(checkMarkdown(valid), []);
    const source = valid.replace(/installation\.$/, 'installation and the subsequent maintenance work.');
    const issues = checkMarkdown(source);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /25 words/);
  }
});
test('allows an abbreviation at the end of a sentence', () => {
  const first = 'Send all required documents for this installation to the supplier whose registered company name appears here as “Acme Inc.”';
  const second = 'Check that the supplier has provided all required documents before you approve the request for installation and subsequent maintenance work.';
  assert.deepEqual(checkMarkdown(`${first} ${second}`), []);
  const issues = checkMarkdown(`${first} ${second.replace(/work\.$/, 'work tomorrow.')}`);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /21 words/);
});
test('discovers new documentation and excludes ignored private files and deleted files', () => {
  const root = mkdtempSync(join(tmpdir(), 'herts-docs-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, '.gitignore'), 'private/\n');
    writeFileSync(join(root, 'README.md'), 'Read this.');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    rmSync(join(root, 'README.md'));
    mkdirSync(join(root, 'new docs'));
    writeFileSync(join(root, 'new docs', 'Guide.MD'), 'Read this.');
    mkdirSync(join(root, 'private'));
    writeFileSync(join(root, 'private', 'secret.md'), long);
    assert.deepEqual(documentationFiles(root), ['new docs/Guide.MD']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI fails on a new document and passes after correction', () => {
  const root = mkdtempSync(join(tmpdir(), 'herts-docs-cli-'));
  const script = fileURLToPath(new URL('../scripts/check-docs.mjs', import.meta.url));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'new-guide.md'), `# Guide\n\n${long}.`);
    const failed = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(failed.error, undefined);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /new-guide.md:3: 21 words/);
    writeFileSync(join(root, 'new-guide.md'), '# Guide\n\nSave the draft.');
    const passed = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(passed.error, undefined);
    assert.equal(passed.status, 0);
    assert.match(passed.stdout, /passed \(1 files\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
