import test from 'node:test';
import assert from 'node:assert/strict';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as id,
  createT4OriginalNetworkTechnicalSchemaDeclaration,
  prepareT4OriginalNetworkTechnicalSchemaRegistration as prepare,
  assertT4OriginalNetworkTechnicalSchemaRegistered as registered,
  requireT4OriginalNetworkTechnicalSchemaId as requireId}
  from '../src/network/original-network-technical-schema.mjs';
const fixture=()=>({
  domain:{domain_id:'original.domain',modules:[{service_id:'original.service',base_path:'/workspace/'}],
    security:{allowed_object_classes:['original.subject'],allow_secrets:false}},
  passport:{service_id:'original.service',base_path:'/workspace/',supported_levels:['T1','T2'],
    schemas:{'original.subject':{schema_version:'1.0.0',json_schema:{type:'object'}}},
    input_object_types:['original.subject'],output_object_types:['original.subject'],
    permissions:{workspace:{read:true},objects:{read:['original.subject'],write:['original.subject'],delete:[]},
      operations:['t1.commitObjectGraph'],packages:{import:false,export:false}}},
});
test('K8 dedicated native technical Object schema uses original passport and preserves original authority',()=>{
  const original=fixture(),before=structuredClone(original);
  assert.throws(()=>registered(original),{code:'ORIGINAL_NETWORK_TECHNICAL_SCHEMA_NOT_REGISTERED'});
  const ready=prepare(original);
  assert.deepEqual(original,before);
  assert.equal(registered(ready),id);
  assert.deepEqual(ready.passport.permissions.operations,before.passport.permissions.operations);
  assert.deepEqual(ready.passport.permissions.objects.delete,[]);
  assert.deepEqual(ready.passport.permissions.packages,before.passport.permissions.packages);
  assert.equal(ready.originalOwnerAuthorityRequired,true);
  assert.equal(ready.createsStore,false);
  assert.deepEqual(ready.passport.schemas[id],createT4OriginalNetworkTechnicalSchemaDeclaration());
  assert.deepEqual(prepare(ready).passport,ready.passport);
  assert.deepEqual(prepare(ready).domain,ready.domain);
});
test('K8 original service declaration mismatch cannot create an alternate ledger or overwrite original schema',()=>{
  const original=fixture();
  original.passport.schemas[id]={schema_version:'2.0.0'};
  assert.throws(()=>prepare(original),{code:'ORIGINAL_NETWORK_TECHNICAL_SCHEMA_DECLARATION_CONFLICT'});
  const foreign=fixture();foreign.passport.service_id='foreign.service';
  assert.throws(()=>prepare(foreign),{code:'ORIGINAL_NETWORK_TECHNICAL_SCHEMA_PASSPORT_REQUIRED'});
  assert.throws(()=>requireId('arbitrary.schema'),{code:'ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID_DENIED'});
  assert.equal(requireId(id),id);
});
