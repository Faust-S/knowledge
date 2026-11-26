import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareT4OriginalInstalledProductPassport as prepare,assertT4OriginalInstalledProductPassport as verify} from '../src/network/original-installed-product-passport.mjs';
import {T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as TECH,createT4OriginalNetworkTechnicalSchemaDeclaration} from '../src/network/original-network-technical-schema.mjs';
const BUSINESS=['iwxa.t3.company-work-record','iwxa.agent.accepted-result'],REG='iwxa.t3.access.signed-registry',APPLIED='iwxa.admin.applied-results';
function fixture(role='RECIPIENT'){
  const product=role==='SOURCE'?'iwxa.personal-agent':'iwxa.admin-center',service=product+'.workspace';
  const schemas=[...BUSINESS,REG,...(role==='RECIPIENT'?[APPLIED]:[])];
  const domain={domain_id:product,status:'development',modules:[{service_id:service,base_path:'/workspace/'}],security:{allowed_object_classes:[...schemas]}};
  const passport={service_id:service,service_version:'0.3.0',base_path:'/workspace/',supported_levels:['T0','T1','T2'],input_object_types:[...schemas],output_object_types:[...schemas],
    schemas:Object.fromEntries(schemas.map(s=>[s,{schema_version:'1.0.0',preserve_unknown:true,json_schema:{type:'object'},embedded:{}}])),
    permissions:{workspace:{list:true,read:true,create:role==='RECIPIENT',soft_delete:false,restore:false,purge:false},
      objects:{read:[...schemas],write:[...schemas],delete:[]},events:{read_scope:'workspace'},
      packages:{export:true,import:true,export_scope:'readable_objects',import_scope:'writable_objects'},operations:['t1.commitObjectGraph']}};
  return {domain,passport,role};
}
for(const role of ['SOURCE','RECIPIENT'])test('exact '+role+' installed passport adds only technical schema and business deletion ceiling',()=>{
  const original=fixture(role),before=structuredClone(original);
  assert.throws(()=>verify(original),{code:'T4_INSTALLED_PILOT_PASSPORT_NOT_REGISTERED'});
  const result=prepare(original);assert.deepEqual(original,before);
  assert.equal(result.role,role);assert.equal(result.networkActivated,false);assert.equal(result.releaseAccepted,false);
  assert.deepEqual(result.passport.schemas[TECH],createT4OriginalNetworkTechnicalSchemaDeclaration());
  assert.deepEqual(result.passport.permissions.objects.delete,BUSINESS);
  assert.ok(!result.passport.permissions.objects.delete.includes(REG));assert.ok(!result.passport.permissions.objects.delete.includes(TECH));
  assert.ok(!result.passport.permissions.objects.delete.includes(APPLIED));
  assert.deepEqual(result.passport.permissions.operations,original.passport.permissions.operations);
  assert.deepEqual(result.passport.permissions.workspace,original.passport.permissions.workspace);
  assert.deepEqual(result.passport.permissions.packages,original.passport.permissions.packages);
  assert.deepEqual(result.domain.modules,original.domain.modules);
  assert.equal(verify(result),role);assert.deepEqual(prepare(result),result);
});
test('wrong role, production domain and unrelated product cannot use the explicit pilot passport',()=>{
  for(const x of [{...fixture(),role:'SOURCE'},{...fixture(),role:'OTHER'},(()=>{const v=fixture();v.domain.status='production';return v;})()])
    assert.throws(()=>prepare(x),{code:'T4_INSTALLED_PILOT_PRODUCT_REQUIRED'});
});
test('pilot registration cannot introduce wildcard, foreign or management deletion authority',()=>{
  const changes=[p=>p.permissions.objects.delete.push(REG),p=>p.permissions.objects.delete.push(TECH),p=>p.permissions.objects.read.push('*'),
    p=>p.permissions.objects.write.push('foreign.schema'),p=>p.schemas['foreign.schema']={schema_version:'1.0.0'},p=>p.output_object_types.push('foreign.schema')];
  for(const mutate of changes){const x=fixture();mutate(x.passport);assert.throws(()=>prepare(x),{code:'T4_INSTALLED_PILOT_SCHEMA_CEILING_REQUIRED'});}
  const final=prepare(fixture());final.passport.permissions.objects.delete.push(APPLIED);
  assert.throws(()=>verify(final),{code:'T4_INSTALLED_PILOT_SCHEMA_CEILING_REQUIRED'});
});
test('no widening of original Kernel operation, lifecycle or full Workspace Exchange',()=>{
  for(const change of [p=>p.permissions.operations.push('t1.deleteObject'),p=>p.permissions.workspace.purge=true,p=>p.permissions.workspace.restore=true,p=>p.permissions.packages.export_scope='workspace']){
    const x=fixture();change(x.passport);assert.throws(()=>prepare(x),{code:'T4_INSTALLED_PILOT_ORIGINAL_PASSPORT_REQUIRED'});
  }
});
test('existing conflicting technical schema or incomplete registered passport never passes readback',()=>{
  const p=prepare(fixture());p.passport.schemas[TECH].json_schema.required=[];
  assert.throws(()=>verify(p),{code:'ORIGINAL_NETWORK_TECHNICAL_SCHEMA_DECLARATION_CONFLICT'});
  const missing=prepare(fixture());missing.passport.permissions.objects.delete=[];
  assert.throws(()=>verify(missing),{code:'T4_INSTALLED_PILOT_PASSPORT_NOT_REGISTERED'});
});
