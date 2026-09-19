import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,sep,dirname} from 'node:path';
import ts from 'typescript';

// Built-ins and examples obey the same source boundary as an external package.
export async function checkBoundaries(root){
  const base=resolve(root);
  async function walk(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.name==='node_modules'||entry.name.startsWith('.'))continue;
      const file=resolve(directory,entry.name);
      if(entry.isDirectory())await walk(file);
      else if(/\.(tsx?|jsx?)$/.test(entry.name)){
        const source=ts.createSourceFile(file,await readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
        function visit(node){
          let value;
          if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))value=node.moduleSpecifier.text;
          if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))value=node.arguments[0].text;
          if(value){
            if(value.startsWith('.')&&!resolve(dirname(file),value).startsWith(base+sep))throw new Error(`${relative(base,file)} imports outside its plugin: ${value}`);
            if(value.startsWith('/')||value.startsWith('@herts/')&&!['@herts/plugin-api/client','@herts/plugin-api/server','@herts/plugin-api/types'].includes(value))throw new Error(`${relative(base,file)} uses a private import: ${value}`);
          }
          ts.forEachChild(node,visit);
        }
        visit(source);
      }
    }
  }
  await walk(resolve(base,'src'));
}
