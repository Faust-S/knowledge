import test from 'node:test';
import assert from 'node:assert/strict';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {groupPersonalRoutineEvidence,preparePersonalTechnologyProduct,preparePersonalRecipientActivation,
 prepareD05TechnologyProduct,prepareD05RecipientInputs,validateTechnologyProduct,PERSONAL_TARGET,D05_TARGET}
 from '../modules/activity-base-anonymizer/technology-product.mjs';

import {personalRows,personalProposal,personalBinding,d05Candidate,d05Binding} from './activity_technology_product_fixture.mjs';
test('personal repeated experience is grouped without combining old cadence or different prompt',async()=>{
 const rows=personalRows(),different={...rows[2],objective:'Another activity',interval_seconds:86400};
 const r=await groupPersonalRoutineEvidence([rows[0],rows[1],different]);
 assert.equal(r.variants.length,2);assert.equal(r.variants[0].accepted_occurrence_count,2);
 assert.equal(r.variants[1].repeatability,'ONE_ACCEPTED_TASK_DECLARED');
 assert.equal(r.export_allowed,false);
 await assert.rejects(()=>groupPersonalRoutineEvidence([rows[0],{...rows[1],task_ref:rows[0].task_ref}]),{code:'TECHNOLOGY_PERSONAL_SOURCE_DUPLICATE'});
 await assert.rejects(()=>groupPersonalRoutineEvidence([rows[0],{...rows[1],occurrence_ref:rows[0].occurrence_ref}]),{code:'TECHNOLOGY_PERSONAL_SOURCE_DUPLICATE'});
});
test('personal product contains actual reviewed instructions, never source case or authority',async()=>{
 const rows=personalRows(),before=JSON.stringify(rows);
 const p=await preparePersonalTechnologyProduct(rows,'routine_001',personalProposal());
 assert.equal(p.object_data.target,PERSONAL_TARGET);assert.equal(p.export_allowed,false);
 const raw=JSON.stringify(p.object_data);
 for(const s of ['PRIVATE_SOURCE','OCC-private','TASK-private','accepted_digest','context_flags','use_memory'])assert.ok(!raw.includes(s));
 assert.equal(JSON.stringify(rows),before);
 const activation=preparePersonalRecipientActivation(p.object_data,personalBinding());
 assert.equal(activation.job_kind,'task_prompt');assert.equal(activation.activated,false);
 assert.equal(activation.options.expected_workspace_id,'recipient-personal');
 assert.equal(activation.payload.use_memory,false);
 assert.ok(activation.payload.message.includes('Do not report an action as completed'));
});
test('personal singleton, changed retained interval and injected permissions rejected',async()=>{
 await assert.rejects(()=>preparePersonalTechnologyProduct(personalRows().slice(0,1),'routine_001',personalProposal()),{code:'TECHNOLOGY_PERSONAL_REPEAT_OR_PROPOSAL_REQUIRED'});
 const form=personalProposal();form.cadence={mode:'RETAIN_INTERVAL',interval_seconds:60,guidance:null};
 await assert.rejects(()=>preparePersonalTechnologyProduct(personalRows(),'routine_001',form),{code:'TECHNOLOGY_PERSONAL_CADENCE_CHANGED'});
 form.cadence.interval_seconds=604800;
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',form);
 assert.throws(()=>preparePersonalRecipientActivation(p.object_data,{...personalBinding(),interval_seconds:60}),{code:'TECHNOLOGY_PERSONAL_CADENCE_CHANGED'});
 assert.throws(()=>preparePersonalRecipientActivation(p.object_data,{...personalBinding(),authority:'SOURCE'}),{code:'TECHNOLOGY_PERSONAL_RECIPIENT_BINDING'});
 assert.throws(()=>validateTechnologyProduct({...p.object_data,grant:'source'}),{code:'TECHNOLOGY_PRODUCT_PROFILE'});
});
test('D05 product resolves unspecified recipient settings without changing original technical checks',async()=>{
 const c=d05Candidate(),before=JSON.stringify(c);
 const p=await prepareD05TechnologyProduct(c,'Sheet part route');
 assert.equal(p.object_data.target,D05_TARGET);assert.equal(p.export_allowed,false);
 assert.deepEqual(p.object_data.technology.quality_checks,c.technology.quality_checks);
 const b=d05Binding(p.object_data),inputs=prepareD05RecipientInputs(p.object_data,b);
 assert.equal(inputs.route_inputs.quantity,'20');assert.equal(inputs.route_inputs.orderName,'Recipient batch');
 assert.equal(inputs.route_inputs.operations.length,3);
 assert.ok(inputs.route_inputs.operations.every(o=>o.performer==='Recipient operator'&&o.materialReady===false));
 assert.equal(inputs.quality_plan_inputs.checks.length,1);
 assert.equal(inputs.quality_plan_inputs.checks[0].lower_limit,'99.8');
 assert.equal(inputs.quality_plan_inputs.checks[0].upper_limit,'100.2');
 assert.equal(inputs.quality_plan_inputs.checks[0].blocking,true);
 assert.equal(inputs.quality_plan_inputs.checks[0].action_on_failure,'stop-release');
 assert.equal(inputs.quality_plan_inputs.common.linkedOperationRouteId,'');
 assert.deepEqual(inputs.quality_plan_inputs.defects,[]);
 assert.equal(inputs.activated,false);assert.equal(JSON.stringify(c),before);
});
test('D05 missing quality, incomplete decision, cyclic dependency and changed fixed values rejected',async()=>{
 const c=d05Candidate();
 await assert.rejects(()=>prepareD05TechnologyProduct({...c,source_quality_status:'NO_LINKED_PLAN'},'Part'),{code:'TECHNOLOGY_D05_SOURCE_INCOMPLETE'});
 await assert.rejects(()=>prepareD05TechnologyProduct({...c,pending_parameter_decisions:[{key:'route.quantity'}]},'Part'),{code:'TECHNOLOGY_D05_SOURCE_INCOMPLETE'});
 const p=await prepareD05TechnologyProduct(c,'Part'),b=d05Binding(p.object_data);
 b.route.hoursPerDay='12';assert.throws(()=>prepareD05RecipientInputs(p.object_data,b),{code:'TECHNOLOGY_D05_RECIPIENT_PARAMETER_COVERAGE'});
 const cycle=structuredClone(p.object_data);cycle.technology.operations[0].predecessors=[cycle.technology.operations[0].operation_id];
 assert.throws(()=>validateTechnologyProduct(cycle),{code:'TECHNOLOGY_DEPENDENCY_INVALID'});
 const changed=structuredClone(p.object_data);
 changed.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value='90';
 assert.throws(()=>validateTechnologyProduct(changed),{code:'TECHNOLOGY_QUALITY_NUMERIC_LIMIT'});
});

import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('fixed local Agent product CLI matches the same product and recipient inputs',async()=>{
 const cli=fileURLToPath(new URL('../tools/activity-technology-product.mjs',import.meta.url));
 const invoke=(mode,v)=>spawnSync(process.execPath,[cli,mode],{input:JSON.stringify(v),encoding:'utf8',maxBuffer:4*1024*1024});
 const records=personalRows(),proposal=personalProposal();
 const result=invoke('--personal-product',{records,variant_id:'routine_001',proposal});
 assert.equal(result.status,0,result.stderr);const p=JSON.parse(result.stdout);
 assert.deepEqual(p,await preparePersonalTechnologyProduct(records,'routine_001',proposal));
 const binding=personalBinding(),activation=invoke('--personal-recipient',{product:p.object_data,binding});
 assert.equal(activation.status,0);assert.deepEqual(JSON.parse(activation.stdout),preparePersonalRecipientActivation(p.object_data,binding));
 const refused=invoke('--personal-product',{records:records.slice(0,1),variant_id:'routine_001',proposal});
 assert.equal(refused.status,2);assert.equal(JSON.parse(refused.stdout).status,'HOLD');
});
