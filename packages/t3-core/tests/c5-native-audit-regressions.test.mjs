import test from 'node:test';
import assert from 'node:assert/strict';
import {OrganizationNativeCapabilityRegistry,OrganizationNativeCapabilityError} from '../src/modules/base/features/organization/organization-native-capabilities.mjs';
function registry(ledger={get(id){if(id!=='proof')throw new Error('missing');return {id};}}){
  const r=new OrganizationNativeCapabilityRegistry({evidenceLedger:ledger});
  r.registerFunctionalPack({id:'F00',title:'Identity'});
  r.registerCompanyArchetype({id:'a',title:'Service',materialClass:'service',requiredPackIds:['F00']});
  r.registerOperatingModel({id:'m',organizationId:'o',rootUnitId:'root',archetypeId:'a',packIds:['F00']});
  r.registerProductLine({id:'p',title:'Orders',operatingModelId:'m'});
  r.registerOperationBinding({id:'op',productLineId:'p',family:'orders',ownerId:'domain.orders',commandId:'orders.accept',inputSchema:'orders.input.v1'});
  r.registerContributionRequirement({id:'c',title:'Accept orders',requiredPackIds:['F00']});
  r.bindContribution({contributionId:'c',operationId:'op'});
  return r;
}
test('C5 valid execution evidence and normal immutable command inputs still work',()=>{
  const r=registry();assert.equal(r.contributionStatus('c').state,'BOUND_PENDING_EXECUTION_EVIDENCE');
  assert.equal(r.recordExecutionEvidence({operationId:'op',evidenceRefs:['proof']}).executionProven,true);
  assert.equal(r.contributionStatus('c').state,'ADOPTED_BY_EVIDENCE');
  const input={lines:[{id:'a'}]};const d=r.workspaceCommandDescriptor('op',{workspaceId:'w',input});input.lines[0].id='changed';
  assert.equal(d.input.lines[0].id,'a');assert.equal(d.execute,false);
});
for(const [name,ledger] of [
  ['no ledger',null],['Map miss',new Map()],['null record',{get(){return null;}}],
  ['wrong id',{get(){return {id:'wrong'};}}],['asynchronous record',{get(){return Promise.resolve({id:'proof'});}}],
]){
  test(`C5 cannot claim execution from ${name}`,()=>{
    const r=registry(ledger);assert.throws(()=>r.recordExecutionEvidence({operationId:'op',evidenceRefs:['proof']}),OrganizationNativeCapabilityError);
    assert.equal(r.contributionStatus('c').state,'BOUND_PENDING_EXECUTION_EVIDENCE');
  });
}
for(const [name,make] of [
  ['sparse array',()=>Array(1)],['extra properties',()=>Object.assign([],{hiddenFact:1})],
  ['symbols',()=>Object.assign([],{[Symbol('hidden')]:1})],['array subclass',()=>new (class extends Array {})(1)],
]){
  test(`C5 canonical command input rejects ${name}`,()=>assert.throws(()=>registry().workspaceCommandDescriptor('op',{workspaceId:'w',input:make()}),OrganizationNativeCapabilityError));
}
test('C5 snapshots do not execute array index getters',()=>{
  const a=[];let calls=0;Object.defineProperty(a,'0',{enumerable:true,get(){calls++;return 1;}});
  assert.throws(()=>registry().workspaceCommandDescriptor('op',{workspaceId:'w',input:a}),OrganizationNativeCapabilityError);assert.equal(calls,0);
});
test('C5 snapshots do not invoke a caller-provided array map method',()=>{
  const a=[1];let calls=0;a.map=()=>{calls++;return ['forged'];};
  assert.throws(()=>registry().workspaceCommandDescriptor('op',{workspaceId:'w',input:a}),OrganizationNativeCapabilityError);assert.equal(calls,0);
});
test('C5 generic putObject cannot be disguised as an exact domain operation',()=>{
  assert.throws(()=>registry().registerOperationBinding({id:'bad',productLineId:'p',family:'orders',ownerId:'domain.orders',commandId:'putObject',inputSchema:'any'}),OrganizationNativeCapabilityError);
});
