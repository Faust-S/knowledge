import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// Enumerate the package, rather than maintaining a hand-written file list.
// Check syntax only: this is not a substitute for imports or runtime tests.
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
function collect(dir){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isSymbolicLink())throw Error('T4_CHECK_UNEXPECTED_SYMLINK: '+relative(root,path));
    if(entry.isDirectory())collect(path);
    else if(entry.isFile()&&/\.(mjs|cjs|js)$/.test(entry.name))files.push(path);
  }
}
for(const directory of ['src','scripts','tests'])collect(join(root,directory));
files.sort();
if(!files.length||!files.some(path=>relative(root,path).replaceAll('\\','/')==='src/index.mjs'))
  throw Error('T4_CHECK_SOURCE_EMPTY');
for(const path of files){
  const result=spawnSync(process.execPath,['--check',path],{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0){
    console.error('T4_CHECK_FAILED: '+relative(root,path));
    process.exit(result.status??1);
  }
}
console.log('T4_JS_SYNTAX_PASS',JSON.stringify({files:files.length,roots:['src','scripts','tests']}));
