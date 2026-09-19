import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { checkBoundaries } from './check-plugin-boundaries.mjs';
import * as React from 'react';
const sdkExports=await readFile('sdk/client-exports.json','utf8');
const roots=process.argv.slice(2).length?process.argv.slice(2):['plugins/tasks','plugins/reading'];
for(const root of roots){
  await checkBoundaries(root);
  const manifest=JSON.parse(await readFile(`${root}/plugin.json`,'utf8'));
  if(manifest.server)await build({entryPoints:[`${root}/src/server.ts`],outfile:`${root}/${manifest.server}`,bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import { createRequire as __hertsRequire } from 'node:module'; const require = __hertsRequire(import.meta.url);"},logLevel:'warning'});
  // Prepared browser bundles use the host's React and public SDK, never a second React.
  if(manifest.client)await build({entryPoints:[`${root}/src/client.tsx`],outfile:`${root}/${manifest.client}`,bundle:true,platform:'browser',target:'es2022',format:'esm',jsx:'automatic',plugins:[{
    name:'herts-runtime',setup(b){
      b.onResolve({filter:/^(react-dom|react(?:\/jsx(?:-dev)?-runtime)?|@herts\/plugin-api\/client)$/},args=>({path:args.path,namespace:'herts-runtime'}));
      b.onLoad({filter:/.*/,namespace:'herts-runtime'},args=>{
        const base='globalThis.__HERTS_PLUGIN_RUNTIME__';
        if(args.path==='react-dom')return{contents:`const runtime=${base}.ReactDOM;export default runtime;export const {createPortal,flushSync,unstable_batchedUpdates}=runtime;`};
        if(args.path==='react')return{contents:`const runtime=${base}.React; export default runtime;\n${Object.keys(React).filter(k=>k!=='default'&&/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)).map(k=>`export const ${k}=runtime.${k};`).join('\n')}`};
        if(args.path.startsWith('react/'))return{contents:`export const {jsx,jsxs,jsxDEV,Fragment}=${base}.jsx;`};
        return{contents:`const runtime=${base}.sdk;\n${JSON.parse(requireText()).map(k=>`export const ${k}=runtime.${k};`).join('\n')}`};
      });
    },
  }],logLevel:'warning'});
}
function requireText(){return sdkExports;}
