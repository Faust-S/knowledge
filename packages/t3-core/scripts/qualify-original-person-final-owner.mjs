#!/usr/bin/env node
// Focused source-level D7 PERSON acceptance at one exact private ORIGINAL
// issuer+holder commit. Public knowledge never retains, logs or publishes
// private source, identities, signed carriers, signer material or tracebacks.
// This reuses the existing original bounded private-source reader.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getExactFile,originalImportPaths,originalImportTarget}
  from './qualify-original-private-d3-owner.mjs';

export const T3_FINAL_PERSON_SOURCE_PIN='a48a41744b911b89cbac2a3e0c99320932ad9469';
const REPOSITORY='Faust-S/T3';
const TEST='tests/access-product-license-person.test.mjs';
const STATIC=['access-control/domain-registry.json'];
const MAX_TOTAL=6*1024*1024;
const MAX_FILE=512*1024;
const MAX_FILES=130;
const REQUIRED=Object.freeze([
  'PERSON owner host persists issue, status, export, reload and terminal revocation',
  'original PERSON Consumer restores exact durable operation receipts across two cold restarts',
  'signed renewal supersedes older ACTIVE rights and cannot resurrect them after revoke',
]);
export async function qualifyOriginalFinalPersonSource({
  token,
  fetchFile=(path,secret)=>getExactFile(path,secret,{
    repository:REPOSITORY,sourcePin:T3_FINAL_PERSON_SOURCE_PIN,
  }),
}={}){
  if(typeof token!=='string'||!token.trim())
    throw Error('T3_PERSON_SOURCE_READ_GRANT_REQUIRED');
  const root=mkdtempSync(join(tmpdir(),'iwxa-t3-native-person-source-'),{mode:0o700});
  const visited=new Set(),pending=[TEST,...STATIC];
  let used=0;
  try{
    while(pending.length){
      const paths=pending.splice(0,8).filter(p=>!visited.has(p));
      if(!paths.length)continue;
      if(paths.some(p=>!/^(?:tests|interop|reconciliation|access-control)\/[A-Za-z0-9_./-]+\.(?:mjs|js|json)$/.test(p)||
          p.includes('..')||p.startsWith('/')))
        throw Error('T3_PERSON_SOURCE_SCOPE_INVALID');
      for(const p of paths)visited.add(p);
      if(visited.size>MAX_FILES)throw Error('T3_PERSON_SOURCE_FILE_LIMIT');
      const batch=await Promise.all(paths.map(p=>fetchFile(p,token)));
      for(let i=0;i<paths.length;i++){
        const p=paths[i],bytes=batch[i];
        if(!Buffer.isBuffer(bytes)||bytes.length>MAX_FILE)
          throw Error('T3_PERSON_SOURCE_FILE_INVALID');
        used+=bytes.length;
        if(used>MAX_TOTAL)throw Error('T3_PERSON_SOURCE_TOTAL_LIMIT');
        const dest=join(root,...p.split('/'));
        mkdirSync(dirname(dest),{recursive:true,mode:0o700});
        writeFileSync(dest,bytes,{flag:'wx',mode:0o600});
        if(/\.(?:mjs|js)$/.test(p))
          for(const spec of originalImportPaths(bytes.toString('utf8'))){
            const child=originalImportTarget(p,spec);
            if(!visited.has(child)&&!pending.includes(child))pending.push(child);
          }
      }
    }
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap',TEST],{
      cwd:root,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,
      env:{PATH:process.env.PATH??'',HOME:process.env.HOME??'',
        TMPDIR:process.env.RUNNER_TEMP??tmpdir(),CI:'true'},
    });
    const output=result.stdout??'';
    const metric=k=>Number(output.match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]??NaN);
    const [tests,pass,fail,skipped]=['tests','pass','fail','skipped'].map(metric);
    const targets=REQUIRED.every(text=>output.includes(text));
    // Give the developer ONLY ordinal and a redacted failure class.
    // Never leak private test names, assertion actual/expected, source or
    // stack traces into public Actions logs.
    const failureOrdinals=[...output.matchAll(/^not ok (\d+) - [^\r\n]*$/gm)]
      .map(hit=>{
        const segment=output.slice(hit.index+hit[0].length);
        const end=segment.search(/^\s*(?:not ok|ok|# Subtest:) /m);
        const block=end>=0?segment.slice(0,end):segment;
        const message=block.match(/^\s*error: ['"]([^'"\n]+)['"]/m)?.[1]??'';
        const safeCode=/^[A-Z][A-Z0-9_]{3,96}$/.test(message)
          ?message:/ERR_ASSERTION|AssertionError|Expected values/.test(block)
            ?'ASSERTION_MISMATCH'
            :/ERR_MODULE_NOT_FOUND|Cannot find module/.test(block)
              ?'MISSING_IMPORT'
              :/ENOENT/.test(block)?'MISSING_FILE'
                :/TypeError/.test(block)?'TYPE_ERROR':'OTHER_FAILURE';
        return {ordinal:Number(hit[1]),code:safeCode};
      });
    if(failureOrdinals.length)
      console.log('T3_PERSON_PRIVATE_FAILED_ORDINALS_CLASSES',
        JSON.stringify(failureOrdinals));
    if(result.error||result.status!==0||!targets||
       !Number.isSafeInteger(tests)||tests<22||
       pass!==tests||fail!==0||
       (Number.isFinite(skipped)&&skipped!==0)){
      // Never log the PRIVATE Node TAP output or its failure stack.
      console.log('T3_PERSON_PRIVATE_SOURCE_SUITE_STATUS','NOT_ACCEPTED');
      console.log('T3_PERSON_PRIVATE_SOURCE_COUNTS',
        JSON.stringify({tests:Number.isFinite(tests)?tests:null,
          pass:Number.isFinite(pass)?pass:null,
          fail:Number.isFinite(fail)?fail:null}));
      console.log('T3_PERSON_PRIVATE_REQUIRED_SUBTESTS_EXECUTED',targets);
      throw Error('T3_PERSON_PRIVATE_SOURCE_NOT_ACCEPTED');
    }
    console.log('T3_PERSON_PRIVATE_ORIGINAL_PIN',T3_FINAL_PERSON_SOURCE_PIN);
    console.log('T3_PERSON_PRIVATE_ORIGINAL_TESTS',tests);
    console.log('T3_PERSON_NATIVE_ISSUER_HOLDER_RENEW_REVOKE_COLD_SOURCE_PASS');
    console.log('T3_PERSON_SOURCE_ONLY_NOT_INSTALLED');
    return Object.freeze({tests,pin:T3_FINAL_PERSON_SOURCE_PIN});
  }finally{
    rmSync(root,{recursive:true,force:true,maxRetries:2});
    console.log('T3_PERSON_PRIVATE_TEMPORARY_FILES_REMOVED');
  }
}
export async function qualifyFinalPersonWithAllowedTokens({tokens=[]}={}){
  let last='';
  for(const token of tokens.filter(t=>typeof t==='string'&&t.trim())){
    try{return await qualifyOriginalFinalPersonSource({token});}
    catch(error){
      if(['T3_PRIVATE_SOURCE_FETCH_403','T3_PRIVATE_SOURCE_FETCH_404']
        .includes(error?.message)){last=error.message;continue;}
      throw error;
    }
  }
  throw Error(last?'T3_PERSON_PRIVATE_SOURCE_NOT_AUTHORIZED':
    'T3_PERSON_SOURCE_READ_GRANT_REQUIRED');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  qualifyFinalPersonWithAllowedTokens({
    tokens:[process.env.T3_READ_TOKEN,process.env.DOMEN_PRIVATE_READ_TOKEN],
  }).catch(error=>{
    const code=/^T3_[A-Z0-9_]+$/.test(error?.message??'')
      ?error.message:'T3_PERSON_PRIVATE_SOURCE_QUALIFICATION_FAILED';
    console.error(code);process.exitCode=1;
  });
}
