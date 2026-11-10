#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildK035CurrentSubjectAcceptanceEvidence} from '../../product/tools/k035-current-subject-acceptance-evidence.mjs';

const [qualificationArg,r11Arg,currentC3Arg,outputArg]=process.argv.slice(2);
if(!qualificationArg||!r11Arg||!currentC3Arg||!outputArg){
  console.error('usage: node scripts/run-k035-current-subject-acceptance-evidence.mjs <qualification.json> <r11-closure.json> <current-c3-qualification.json> <output.json>');
  process.exit(2);
}
const output=resolve(outputArg);
if(existsSync(output)){
  console.error('CURRENT_ACCEPTANCE_EVIDENCE_OUTPUT_ALREADY_EXISTS');
  process.exit(2);
}
try{
  const qualificationPath=resolve(qualificationArg);
  const qualificationBytes=readFileSync(qualificationPath);
  const preAcceptanceQualification=JSON.parse(qualificationBytes.toString('utf8'));
  const r11Closure=JSON.parse(readFileSync(resolve(r11Arg),'utf8'));
  const currentC3Qualification=JSON.parse(readFileSync(resolve(currentC3Arg),'utf8'));
  const evidence=buildK035CurrentSubjectAcceptanceEvidence({
    preAcceptanceQualification,
    preAcceptanceQualificationSha256:createHash('sha256').update(qualificationBytes).digest('hex'),
    r11Closure,
    currentC3Qualification,
  });
  writeFileSync(output,`${JSON.stringify(evidence,null,2)}\n`,'utf8');
  console.log(`Current-subject acceptance evidence READY_FOR_OWNER_REVIEW: ${evidence.evidenceSha256}`);
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
