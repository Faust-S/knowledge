#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildK035CurrentSubjectAcceptanceLock} from '../../product/tools/k035-current-subject-acceptance-lock.mjs';

const [evidenceArg,ownerApprovalArg,outputArg]=process.argv.slice(2);
if(!evidenceArg||!ownerApprovalArg||!outputArg){
  console.error('usage: node scripts/run-k035-current-subject-acceptance-lock.mjs <acceptance-evidence.json> <owner-approval.json> <output.json>');
  process.exit(2);
}
const output=resolve(outputArg);
if(existsSync(output)){
  console.error('CURRENT_ACCEPTANCE_LOCK_OUTPUT_ALREADY_EXISTS');
  process.exit(2);
}
try{
  const acceptanceEvidence=JSON.parse(readFileSync(resolve(evidenceArg),'utf8'));
  const ownerApproval=JSON.parse(readFileSync(resolve(ownerApprovalArg),'utf8'));
  const lock=buildK035CurrentSubjectAcceptanceLock({acceptanceEvidence,ownerApproval});
  writeFileSync(output,`${JSON.stringify(lock,null,2)}\n`,'utf8');
  console.log(`Current-subject acceptance lock APPROVED: ${lock.lockSha256}`);
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
