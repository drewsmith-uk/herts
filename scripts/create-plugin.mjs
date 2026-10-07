import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const id=process.argv[2];
if(!id||!/^[a-z][a-z0-9-]{0,63}$/.test(id)||['tasks','reading','conversations'].includes(id)||id.startsWith('invalid-')){
  throw new Error('Usage: npm run plugin:new -- my-plugin (a unique lowercase ID)');
}
const root=resolve('plugins',id),name=id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join(' ');
await mkdir(root); // Refuse to overwrite an existing plugin.
await mkdir(`${root}/src`);
const manifest=JSON.parse(await readFile('examples/notes/plugin.json','utf8'));
await writeFile(`${root}/plugin.json`,JSON.stringify({...manifest,id,name,description:`${name}: built with the public Herts plugin API.`},null,2)+'\n');
for(const file of ['client.tsx','server.ts']){
  const source=(await readFile(`examples/notes/src/${file}`,'utf8')).replaceAll("'notes'",JSON.stringify(id)).replaceAll('/plugins/notes',`/plugins/${id}`).replaceAll("'Notes'",JSON.stringify(name));
  await writeFile(`${root}/src/${file}`,source);
}
console.log(`Created plugins/${id}. Run npm run build:plugin -- plugins/${id}, then Rescan in Settings → Plugins. New plugins start disabled. Before release, follow AGENTS.md UI completion criteria, add browser coverage, and run npm run check:release.`);
