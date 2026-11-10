#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  buildK035CurrentStageDSubject,
  normalizeK035CurrentStageDEvidence,
  preflightCurrentC3D4Activation,
  buildCurrentC3ProjectProcessActivationReceipt,
} from '../../product/tools/k035-current-subject-d4.mjs';

function readJson(path){return JSON.parse(readFileSync(resolve(path),'utf8'))}
function writeNew(path,value){
  const out=resolve(path);
  if(existsSync(out)) throw new Error('CURRENT_D4_OUTPUT_ALREADY_EXISTS');
  writeFileSync(out,`${JSON.stringify(value,null,2)}\n`,'utf8');
}
function sha256Bytes(path){return createHash('sha256').update(readFileSync(resolve(path))).digest('hex')}

const [mode,...args]=process.argv.slice(2);
try{
  if(mode==='subject'){
    if(args.length!==2) throw new Error('usage: ... subject <acceptance-lock.json> <output.json>');
    const subject=buildK035CurrentStageDSubject({acceptanceLock:readJson(args[0])});
    writeNew(args[1],subject);
    console.log(`Current Stage-D subject READY: ${subject.subjectSha256}`);
  }else if(mode==='normalize'){
    if(args.length!==3) throw new Error('usage: ... normalize <acceptance-lock.json> <stage-d-result.json> <output.json>');
    const evidence=normalizeK035CurrentStageDEvidence({
      acceptanceLock:readJson(args[0]),
      stageDResult:readJson(args[1]),
      stageDResultSha256:sha256Bytes(args[1]),
    });
    writeNew(args[2],evidence);
    console.log(`Current D4 evidence PASS: ${evidence.evidenceSha256}`);
  }else if(mode==='preflight'){
    if(args.length!==3) throw new Error('usage: ... preflight <acceptance-lock.json> <d4-evidence.json> <output.json>');
    const preflight=preflightCurrentC3D4Activation({
      acceptanceLock:readJson(args[0]),
      d4Evidence:readJson(args[1]),
    });
    writeNew(args[2],preflight);
    console.log(`Current D4 activation preflight READY: ${preflight.preflightSha256}`);
  }else if(mode==='activation-receipt'){
    if(args.length!==3) throw new Error('usage: ... activation-receipt <owner-adoption-approval.json> <d4-preflight.json> <output.json>');
    const approvalBytes=readFileSync(resolve(args[0]));
    const receipt=buildCurrentC3ProjectProcessActivationReceipt({
      ownerAdoptionApproval:JSON.parse(approvalBytes.toString('utf8')),
      ownerAdoptionApprovalSha256:createHash('sha256').update(approvalBytes).digest('hex'),
      d4Preflight:readJson(args[1]),
    });
    writeNew(args[2],receipt);
    console.log(`Current activation receipt READY: ${receipt.receiptSha256}`);
  }else{
    throw new Error('usage: node scripts/run-k035-current-subject-d4.mjs <subject|normalize|preflight|activation-receipt> ...');
  }
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
