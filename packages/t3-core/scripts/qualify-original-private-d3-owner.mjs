// IWXA G4: original private owner SOURCE qualification, strictly inside public knowledge CI.
// Fetch only transitive .mjs/.js imports used by one original D3 test; no git clone.
// This file contains no private source. The token is used solely for authenticated GET.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const REPO='Faust-S/T3';
const PIN='75c8188e28cf3fc2df2f253b1705006fe172c138';
const TEST='tests/admin-original-host-port.test.mjs';
const EXPECT='native D3 compares every signed field independent of original JSON key order';
const ROOTS=new Set(['interop','reconciliation','access-control','tests']);
const MAX_FILES=130;
const MAX_BYTES=6*1024*1024;
const MAX_FILE_BYTES=512*1024;

export function originalImportPaths(source){
  if(typeof source!=='string')throw Error('T3_SOURCE_TEXT_REQUIRED');
  const paths=new Set();
  const re=/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g;
  for(const hit of source.matchAll(re))paths.add(hit[1]);
  return [...paths];
}
export function originalImportTarget(from,specifier){
  if(typeof from!=='string'||typeof specifier!=='string'||
     !/^\.\.?\//.test(specifier)||/[?#]/.test(specifier))
    throw Error('T3_PRIVATE_IMPORT_PATH_INVALID');
  const path=posix.normalize(posix.join(posix.dirname(from),specifier));
  if(!ROOTS.has(path.split('/')[0])||
     !/^[a-zA-Z0-9_./-]+\.(?:mjs|js|json)$/.test(path)||
     path.includes('..')||path.startsWith('/'))
    throw Error('T3_PRIVATE_IMPORT_OUTSIDE_BOUNDED_SOURCE');
  return path;
}

async function getExactFile(path,token){
  const url=`https://api.github.com/repos/${REPO}/contents/`+
    path.split('/').map(encodeURIComponent).join('/')+`?ref=${PIN}`;
  let response;
  try{
    response=await fetch(url,{headers:{
      Accept:'application/vnd.github+json',
      Authorization:`Bearer ${token}`,
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'iwxa-knowledge-bounded-private-original-d3-qualification',
    },signal:AbortSignal.timeout(20000)});
  }catch{throw Error('T3_PRIVATE_SOURCE_API_UNAVAILABLE');}
  if(!response.ok)throw Error(`T3_PRIVATE_SOURCE_FETCH_${response.status}`);
  let item;
  try{item=await response.json();}catch{throw Error('T3_PRIVATE_SOURCE_RESPONSE_INVALID');}
  if(item?.type!=='file'||item.encoding!=='base64'||
     typeof item.content!=='string'||!Number.isInteger(item.size)||
     item.size<0||item.size>MAX_FILE_BYTES)
    throw Error('T3_PRIVATE_SOURCE_FILE_NOT_ALLOWED');
  const bytes=Buffer.from(item.content.replace(/\s/g,''),'base64');
  if(bytes.length!==item.size)throw Error('T3_PRIVATE_SOURCE_SIZE_MISMATCH');
  return bytes;
}

export async function runOriginalPrivateOwnerSourceCheck({token,fetchFile=getExactFile}={}){
  if(typeof token!=='string'||!token.trim())throw Error('T3_KNOWLEDGE_READ_TOKEN_NOT_AVAILABLE');
  const root=mkdtempSync(join(tmpdir(),'iwxa-t3-original-d3-'),{mode:0o700});
  const visited=new Set(),pending=[TEST];
  let count=0,totalBytes=0;
  try{
    while(pending.length){
      const batch=pending.splice(0,8).filter(path=>!visited.has(path));
      if(!batch.length)continue;
      // Never ask for anything outside the bounded existing original owner.
      for(const path of batch){
        if(!ROOTS.has(path.split('/')[0]))
          throw Error('T3_PRIVATE_SOURCE_PATH_UNAUTHORIZED');
        visited.add(path);
      }
      if(visited.size>MAX_FILES)throw Error('T3_PRIVATE_SOURCE_FILE_LIMIT');
      const results=await Promise.all(batch.map(path=>fetchFile(path,token)));
      for(let i=0;i<batch.length;i++){
        const path=batch[i],bytes=results[i];
        if(!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE_BYTES)
          throw Error('T3_PRIVATE_SOURCE_RESPONSE_INVALID');
        totalBytes+=bytes.length;
        if(totalBytes>MAX_BYTES)throw Error('T3_PRIVATE_SOURCE_TOTAL_LIMIT');
        const local=join(root,...path.split('/'));
        mkdirSync(dirname(local),{recursive:true,mode:0o700});
        writeFileSync(local,bytes,{mode:0o600,flag:'wx'});
        count++;
        if(/\.(?:mjs|js)$/.test(path)){
          for(const specifier of originalImportPaths(bytes.toString('utf8'))){
            const child=originalImportTarget(path,specifier);
            if(!visited.has(child)&&!pending.includes(child))pending.push(child);
          }
        }
      }
    }
    // Original test code receives no token or CI credential environment.
    const env={PATH:process.env.PATH??'',HOME:process.env.HOME??'',
      TMPDIR:process.env.RUNNER_TEMP??tmpdir(),LANG:'C.UTF-8',CI:'true'};
    const child=spawnSync(process.execPath,['--test',TEST],{
      cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,
    });
    // Original source, Task texts, fixture details and test output are PRIVATE.
    // Only declassified counts and exact target regression execution leave CI.
    const stdout=child.stdout??'';
    const metrics=['tests','pass','fail'].map(key=>{
      const found=stdout.match(new RegExp(`^# ${key} (\\d+)$`,'m'));
      return found?Number(found[1]):null;
    });
    const [tests,passed,failed]=metrics;
    const targeted=stdout.includes(EXPECT);
    console.log('T3_PRIVATE_D3_SOURCE_MODULES_READ',count);
    console.log('T3_PRIVATE_D3_ORIGINAL_SUITE',
      `tests=${tests??'unknown'} pass=${passed??'unknown'} fail=${failed??'unknown'}`);
    console.log('T3_PRIVATE_D3_SIGNED_CONTEXT_REGRESSION',targeted?'EXECUTED':'NOT_EXECUTED');
    if(child.status!==0||child.error||!targeted||!tests||passed!==tests||failed!==0)
      throw Error('T3_PRIVATE_D3_ORIGINAL_OWNER_SOURCE_NOT_ACCEPTED');
    console.log('T3_PRIVATE_D3_ORIGINAL_OWNER_SOURCE_PASS_NOT_INSTALLED');
    return {tests,passed,failed,count};
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('T3_PRIVATE_D3_EPHEMERAL_SOURCE_REMOVED');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runOriginalPrivateOwnerSourceCheck({token:process.env.T3_READ_TOKEN}).catch(error=>{
    const code=typeof error?.message==='string'&&/^T3_[A-Z0-9_]+$/.test(error.message)
      ?error.message:'T3_PRIVATE_D3_QUALIFICATION_FAILED';
    console.error(code);
    process.exitCode=1;
  });
}
