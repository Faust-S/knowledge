#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PROJECT_PROCESS_SOURCE_ACTIVATION} from '../src/modules/base/owners/project-process-source-owner.mjs';
import {qualifyProjectProcessPostBinding} from '../src/modules/base/owners/project-process-qualification.mjs';

const [receiptArg,outputArg]=process.argv.slice(2);
if(!receiptArg||!outputArg){
  console.error('usage: node scripts/run-c3-project-process-post-binding-qualification.mjs <activation-receipt.json> <output.json>');
  process.exit(2);
}
const output=resolve(outputArg);
if(existsSync(output)){
  console.error('POST_BINDING_QUALIFICATION_OUTPUT_ALREADY_EXISTS');
  process.exit(2);
}
try{
  const activationReceipt=JSON.parse(readFileSync(resolve(receiptArg),'utf8'));
  const result=await qualifyProjectProcessPostBinding({
    activationReceipt,
    config:PROJECT_PROCESS_SOURCE_ACTIVATION,
  });
  if(result.status!=='PASS') throw new Error('POST_BINDING_QUALIFICATION_NOT_PASS');
  writeFileSync(output,`${JSON.stringify(result,null,2)}\n`,'utf8');
  console.log(`C3 post-binding qualification PASS: gate=${result.activationGateSha256}`);
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
