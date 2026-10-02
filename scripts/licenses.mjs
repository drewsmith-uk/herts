import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Collect actual bundled packages, including separate installed versions. */
export async function thirdPartyNotices(inputs) {
  const packages = new Map();
  for (const input of inputs) {
    if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
    let directory = dirname(resolve(input.replace(/^\0/, '').split('?')[0]));
    while (directory.includes('node_modules')) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name && pkg.version) { packages.set(directory, pkg); break; }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      directory = dirname(directory);
    }
  }
  const sections = [];
  for (const [directory, pkg] of [...packages].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`))) {
    const files = (await readdir(directory, { withFileTypes: true })).filter(f => f.isFile() && /^(licen[sc]e|copying|notice)(?:[.-]|$)/i.test(f.name)).map(f => f.name).sort();
    if (!files.some(name => /^(licen[sc]e|copying)/i.test(name))) throw new Error(`Missing licence text for bundled package ${pkg.name}@${pkg.version}`);
    sections.push(`${pkg.name}@${pkg.version}\nLicence: ${typeof pkg.license === 'string' ? pkg.license : 'See notices below'}\n\n${(await Promise.all(files.map(async file => `${file}\n${await readFile(join(directory, file), 'utf8')}`))).join('\n\n')}`);
  }
  return `Third-party notices for this Herts build\n\nHerts is MIT licensed. Bundled dependencies retain their own licences.\n\n${sections.join('\n\n' + '='.repeat(72) + '\n\n')}\n`;
}
