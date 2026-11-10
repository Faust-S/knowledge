#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildC3ProjectProcessActivationBindingPlan} from '../../product/tools/c3-project-process-activation-binding-plan.mjs';

const [receiptArg,outputArg]=process.argv.slice(2);
if(!receiptArg||!outputArg){
  console.error('usage: node scripts/run-c3-project-process-activation-binding-plan.mjs <activation-receipt.json> <output.json>');
  process.exit(2);
}
const output=resolve(outputArg);
if(existsSync(output)){
  console.error('ACTIVATION_BINDING_PLAN_OUTPUT_ALREADY_EXISTS');
  process.exit(2);
}
try{
  const activationReceipt=JSON.parse(readFileSync(resolve(receiptArg),'utf8'));
  const plan=buildC3ProjectProcessActivationBindingPlan({activationReceipt});
  writeFileSync(output,`${JSON.stringify(plan,null,2)}\n`,'utf8');
  console.log(`C3 activation binding plan READY: receipt=${plan.activationReceiptSha256} gate=${plan.activationGateSha256}`);
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
