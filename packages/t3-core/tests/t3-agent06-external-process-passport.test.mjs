import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  EXTERNAL_PROCESS_LINK_SCHEMA,EXTERNAL_PROCESS_LINK_PASSPORT,
  EXTERNAL_PROCESS_LINK_DECLARATION,
} from '../src/t3/external-process-link.mjs';
import {planOriginalT2ExternalProcessRegistration}
  from '../src/t3/external-process-passport-registration.node.mjs';

function original(){
  const base='_iwxa/services/iwxa.workspace.integration.json';
  return {
    domain:{
      modules:[{service_id:'iwxa.workspace.integration',base_path:'/workspace/'}],
      security:{allowed_object_classes:['iwxa.demo.note'],local_mode:true},
      runtime:{runtime_version:'0.3.6'},
    },
    catalog:{contract_version:'1.3.0',count:1,entries:[{
      service_id:'iwxa.workspace.integration',service_version:'1.0.0',
      base_path:'/workspace/',supported_levels:['T1','T2'],
      file:base,sha256:'a'.repeat(64),
    }]},
    controlPlane:{schema_version:'0.3.1',services:[{
      schema_version:'0.3.1',service_id:'iwxa.workspace.integration',
      capability_control:'NONE',capability_ceiling:[],
      activation_any_of:[],operation_guards:[],
    }]},
  };
}
test('external link declares a strictly schema-scoped ORIGINAL T2 service passport',()=>{
  const p=EXTERNAL_PROCESS_LINK_PASSPORT;
  assert.equal(p.service_id,'iwxa.agent06.external-process');
  assert.deepEqual(p.output_object_types,[EXTERNAL_PROCESS_LINK_SCHEMA]);
  assert.deepEqual(p.input_object_types,[]);
  assert.deepEqual(p.permissions.objects.read,[EXTERNAL_PROCESS_LINK_SCHEMA]);
  assert.deepEqual(p.permissions.objects.write,[EXTERNAL_PROCESS_LINK_SCHEMA]);
  assert.deepEqual(p.permissions.objects.delete,[]);
  assert.equal(p.permissions.workspace.create,false);
  assert.equal(p.permissions.workspace.purge,false);
  assert.equal(p.permissions.packages.export,false);
  assert.equal(p.permissions.packages.import,false);
  assert.equal(p.permissions.events.read_scope,'service');
  assert.deepEqual(p.schemas[EXTERNAL_PROCESS_LINK_SCHEMA],EXTERNAL_PROCESS_LINK_DECLARATION);
});
test('existing original T2 catalog is extended, not replaced; SHA and idempotency',()=>{
  const source=original(),snapshot=structuredClone(source);
  const plan=planOriginalT2ExternalProcessRegistration(source);
  assert.deepEqual(source,snapshot);
  assert.equal(plan.catalog.count,2);
  assert.equal(plan.domain.modules.length,2);
  assert.equal(plan.controlPlane.services.length,2);
  assert.deepEqual(plan.domain.security.allowed_object_classes,
    ['iwxa.demo.note',EXTERNAL_PROCESS_LINK_SCHEMA]);
  assert.equal(plan.catalog.entries[0].service_id,'iwxa.workspace.integration');
  assert.equal(plan.catalog.entries[1].service_id,'iwxa.agent06.external-process');
  assert.equal(plan.catalog.entries[1].file,plan.passport_file);
  assert.equal(plan.passport_sha256,createHash('sha256')
    .update(Buffer.from(plan.passport_bytes,'utf8')).digest('hex'));
  assert.deepEqual(JSON.parse(plan.passport_bytes),EXTERNAL_PROCESS_LINK_PASSPORT);
  assert.deepEqual(planOriginalT2ExternalProcessRegistration(plan),plan);
});
test('collision with another service owning the same pathname fails before writing',()=>{
  const x=original();x.domain.modules.push({
    service_id:'other.external-process',base_path:'/workspace/external-process/'});
  assert.throws(()=>planOriginalT2ExternalProcessRegistration(x),
    {code:'T3_EXT_PASSPORT_COLLISION'});
});
test('modified schema, service catalog digest or fake already-registered owner is rejected',()=>{
  const first=planOriginalT2ExternalProcessRegistration(original());
  const corrupt=structuredClone(first);
  corrupt.catalog.entries[1].sha256='0'.repeat(64);
  assert.throws(()=>planOriginalT2ExternalProcessRegistration(corrupt),
    {code:'T3_EXT_PASSPORT_COLLISION'});
  const foreign=original();
  foreign.catalog.entries.push({
    service_id:'foreign.service',file:first.passport_file,sha256:'b'.repeat(64)});
  foreign.catalog.count=2;
  assert.throws(()=>planOriginalT2ExternalProcessRegistration(foreign),
    {code:'T3_EXT_PASSPORT_COLLISION'});
});
test('a malformed original T2 build catalog cannot create a fake service',()=>{
  const x=original();
  x.controlPlane.schema_version='9.0.0';
  assert.throws(()=>planOriginalT2ExternalProcessRegistration(x),
    {code:'T3_EXT_ORIGINAL_T2_CATALOG_REQUIRED'});
  const y=original();
  y.catalog.entries[0].sha256='not-sha';
  assert.throws(()=>planOriginalT2ExternalProcessRegistration(y),
    {code:'T3_EXT_ORIGINAL_T2_CATALOG_INVALID'});
});
