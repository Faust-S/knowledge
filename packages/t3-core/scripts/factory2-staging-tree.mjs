#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export class Factory2StagingError extends Error {
  constructor(message,code='FACTORY2_STAGING_ERROR'){super(message);this.name='Factory2StagingError';this.code=code;}
}
const posix=(value)=>value.split(sep).join('/');
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');

function walk(root,path=root){
  const stat=lstatSync(path);
  if(stat.isSymbolicLink()) throw new Factory2StagingError(`symlink forbidden: ${posix(relative(root,path))}`,'FACTORY2_STAGING_SYMLINK_FORBIDDEN');
  if(stat.isFile()) return [path];
  if(!stat.isDirectory()) throw new Factory2StagingError(`unsupported entry: ${posix(relative(root,path))}`,'FACTORY2_STAGING_ENTRY_UNSUPPORTED');
  return readdirSync(path,{withFileTypes:true}).flatMap((entry)=>walk(root,resolve(path,entry.name)));
}
function safePath(path){
  if(path.startsWith('/')||path.startsWith('\\')||path.split('/').includes('..')||path.includes('\\')){
    throw new Factory2StagingError(`unsafe path: ${path}`,'FACTORY2_STAGING_UNSAFE_PATH');
  }
}
export function inventoryFactory2Staging(rootValue){
  const root=resolve(rootValue);
  if(!existsSync(root)) throw new Factory2StagingError('staging root missing','FACTORY2_STAGING_ROOT_MISSING');
  const files=walk(root).map((absolute)=>{
    const path=posix(relative(root,absolute));
    safePath(path);
    return {path,sha256:sha256(readFileSync(absolute))};
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const folded=new Map();
  for(const file of files){
    const key=file.path.toLocaleLowerCase('en-US');
    if(folded.has(key)&&folded.get(key)!==file.path){
      throw new Factory2StagingError(`casefold collision: ${folded.get(key)} / ${file.path}`,'FACTORY2_STAGING_CASEFOLD_COLLISION');
    }
    folded.set(key,file.path);
  }
  return Object.freeze(files.map(Object.freeze));
}
export function buildFactory2Sha256Sums(rootValue){
  const files=inventoryFactory2Staging(rootValue).filter((f)=>f.path!=='SHA256SUMS');
  return files.map((f)=>`${f.sha256}  ${f.path}`).join('\n')+'\n';
}
export function verifyFactory2Sha256Sums(rootValue,declaredValue){
  const expected=buildFactory2Sha256Sums(rootValue);
  if(declaredValue!==expected) throw new Factory2StagingError('SHA256SUMS mismatch','FACTORY2_SHA256SUMS_MISMATCH');
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_SHA256SUMS_VERIFICATION_V1',
    status:'PASS',
    fileCount:inventoryFactory2Staging(rootValue).filter((f)=>f.path!=='SHA256SUMS').length,
    sha256sumsSha256:sha256(Buffer.from(expected)),
  });
}
function main(){
  const [mode,root]=process.argv.slice(2);
  if(!mode||!root){
    console.error('usage: node scripts/factory2-staging-tree.mjs <generate|verify> <staging-root>');
    process.exitCode=2; return;
  }
  if(mode==='generate'){
    const out=buildFactory2Sha256Sums(root);
    writeFileSync(resolve(root,'SHA256SUMS'),out,'utf8');
    console.log(out.trimEnd());
    return;
  }
  if(mode==='verify'){
    const path=resolve(root,'SHA256SUMS');
    if(!existsSync(path)) throw new Factory2StagingError('SHA256SUMS missing','FACTORY2_SHA256SUMS_MISSING');
    console.log(JSON.stringify(verifyFactory2Sha256Sums(root,readFileSync(path,'utf8')),null,2));
    return;
  }
  throw new Factory2StagingError(`unknown mode ${mode}`,'FACTORY2_STAGING_MODE_INVALID');
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) main();
