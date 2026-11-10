import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyDomainRuntimeBinding} from '../scripts/verify-domain-runtime-binding.mjs';
const valid=()=>({
 domain:{domain_id:'ru.iwxa.example',local_store_name:'iwxa-local',runtime:{kernel_release:'0.3.6',runtime_version:'0.3.6'}},
 workspaceConfig:{domain_id:'ru.iwxa.example',host:{required_contract_version:'1.3.0',required_runtime_version:'0.3.6',local_store_name:'iwxa-local',direct_indexeddb:false},modules:[{module_id:'iwxa.domain.example',state:'active'}]},
 moduleManifest:{module_manifest_version:'1.0.0',module_id:'iwxa.domain.example',compatibility:{runtime_contract:'1.3.0'},security:{direct_indexeddb:false,remote_code:false,iwxa_executable_payload:false}}
});
test('accepts the canonical qualified 0.3.6 / 1.3.0 pair without issuing rights',()=>{
 const result=verifyDomainRuntimeBinding(valid());
 assert.deepEqual(result,{status:'VERIFIED_METADATA_ONLY',moduleId:'iwxa.domain.example',kernel:'0.3.6',contract:'1.3.0',productionActivation:false,grantsCreated:false});
});
test('fails closed when a Club-style module still declares 1.2.0',()=>{
 const x=valid();x.moduleManifest.compatibility.runtime_contract='1.2.0';
 assert.throws(()=>verifyDomainRuntimeBinding(x),/RUNTIME_CONTRACT_MISMATCH/);
});
test('fails closed when Host config still declares 1.2.0',()=>{
 const x=valid();x.workspaceConfig.host.required_contract_version='1.2.0';
 assert.throws(()=>verifyDomainRuntimeBinding(x),/RUNTIME_CONTRACT_MISMATCH/);
});
test('refuses a mixed qualified Kernel and Runtime contract',()=>{
 const x=valid();x.domain.runtime.kernel_release='0.3.5';x.domain.runtime.runtime_version='0.3.5';x.workspaceConfig.host.required_runtime_version='0.3.5';
 assert.throws(()=>verifyDomainRuntimeBinding(x),/QUALIFIED_KERNEL_CONTRACT_PAIR_REQUIRED/);
});
test('refuses an inactive or absent module',()=>{
 for(const state of ['disabled','missing']){
  const x=valid();x.workspaceConfig.modules=state==='missing'?[]:[{module_id:'iwxa.domain.example',state}];
  assert.throws(()=>verifyDomainRuntimeBinding(x),/MODULE_NOT_ACTIVE/);
 }
});
test('refuses an unsafe Host or module security declaration',()=>{
 for(const field of ['direct_indexeddb','remote_code','iwxa_executable_payload']){
  const x=valid();x.moduleManifest.security[field]=true;
  assert.throws(()=>verifyDomainRuntimeBinding(x),/HOST_SECURITY_OR_DOMAIN_MISMATCH/);
 }
 for(const field of ['domain_id','local_store_name']){
  const x=valid();if(field==='domain_id')x.workspaceConfig.domain_id='inconsistent';
  else x.workspaceConfig.host.local_store_name='inconsistent';
  assert.throws(()=>verifyDomainRuntimeBinding(x),/HOST_SECURITY_OR_DOMAIN_MISMATCH/);
 }
});
test('refuses missing and malformed inputs',()=>{
 for(const value of [null,{},[],{domain:null,workspaceConfig:{},moduleManifest:{}}])
  assert.throws(()=>verifyDomainRuntimeBinding(value??{}));
});
