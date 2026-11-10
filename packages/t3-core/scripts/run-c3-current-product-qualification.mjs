#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildCurrentC3QualificationReceipt} from '../../product/tools/c3-current-product-qualification-receipt.mjs';

const [qualificationArg,r11Arg,outputArg]=process.argv.slice(2);
if(!qualificationArg||!r11Arg||!outputArg){
  console.error('usage: node scripts/run-c3-current-product-qualification.mjs <c3-qualification.json> <r11-closure.json> <output.json>');
  process.exit(2);
}
const output=resolve(outputArg);
if(existsSync(output)){
  console.error('CURRENT_C3_QUALIFICATION_OUTPUT_ALREADY_EXISTS');
  process.exit(2);
}
try{
  const qualificationDoc=JSON.parse(readFileSync(resolve(qualificationArg),'utf8'));
  const qualification=qualificationDoc?.result ?? qualificationDoc;
  const r11Closure=JSON.parse(readFileSync(resolve(r11Arg),'utf8'));
  const receipt=buildCurrentC3QualificationReceipt({qualification,r11Closure});
  writeFileSync(output,`${JSON.stringify(receipt,null,2)}\n`,'utf8');
  console.log(`Current C3 qualification PASS: receipt=${receipt.receiptSha256}`);
}catch(error){
  console.error(`${error?.code||'ERROR'}:${error?.message||String(error)}`);
  process.exit(1);
}
