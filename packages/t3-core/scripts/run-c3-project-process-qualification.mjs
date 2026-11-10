#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { qualifyProjectProcessSourceOwner } from '../src/modules/base/owners/project-process-qualification.mjs';

const [outputArg] = process.argv.slice(2);
if (!outputArg) {
  console.error('usage: node scripts/run-c3-project-process-qualification.mjs <output.json>');
  process.exit(2);
}

try {
  const result=await qualifyProjectProcessSourceOwner();
  if (result.status !== 'PASS') throw new Error(`C3_QUALIFICATION_STATUS_NOT_PASS:${result.status}`);
  if (result.productionWriteActivation !== false) throw new Error('C3_QUALIFICATION_ACTIVATED_PRODUCTION_WRITE');
  if (result.qualificationHarnessPersistent !== false) throw new Error('C3_QUALIFICATION_HARNESS_BECAME_PERSISTENT');
  if (result.d4ExactRelease !== 'PENDING') throw new Error(`C3_D4_BOUNDARY_INVALID:${result.d4ExactRelease}`);
  if (!Array.isArray(result.sourceFamiliesQualified) || result.sourceFamiliesQualified.length !== 8) {
    throw new Error(`C3_QUALIFIED_FAMILY_COUNT_INVALID:${result.sourceFamiliesQualified?.length ?? 'null'}`);
  }
  const receipt=Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_EXACT_HEAD_QUALIFICATION_RECEIPT_V1',
    status:'PASS',
    productionWriteActivation:false,
    d4ExactRelease:'PENDING',
    result,
  });
  writeFileSync(resolve(outputArg),`${JSON.stringify(receipt,null,2)}\n`,'utf8');
  console.log(`C3 Project/Process qualification PASS: families=${result.sourceFamiliesQualified.length} records=${result.recordCount}`);
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exit(1);
}
