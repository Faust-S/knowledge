import test from 'node:test';
import assert from 'node:assert/strict';
import {JurisdictionSourceProfileRegistry, JurisdictionSourceProfileError} from '../src/modules/base/features/specialization/jurisdiction-source-profiles.mjs';

// Synthetic contracts exercise read-only ingress, never production or legal applicability.
const at='2026-09-21T00:00:00Z';
function registry(ledger={get(id){return {id};}}){
  const r=new JurisdictionSourceProfileRegistry({evidenceLedger:ledger});
  r.registerProfile({id:'p',jurisdictionId:'test-jurisdiction',countryCode:'ZZ',authorityRef:'test:source',identifierKinds:[{id:'id'}]});
  r.registerAdapter({id:'a',sourceKind:'GENERAL',sourceSchemaRef:'test:v1',profileId:'p',mappings:[{id:'value',sourcePath:'value',targetRole:'identifier',targetRef:'id',required:true}]});
  return r;
}
function preview(r,value){return r.readImportPreview({adapterId:'a',sourceRecordId:'test:record',sourcePayload:{value},effectiveAt:at,knownAt:at});}
function append(r,payload={v:1}){return r.appendRule({id:'rule',profileId:'p',ruleKind:'test',subjectRef:'test:s',payload,effective:{from:at},knowledge:{from:at},provenanceId:'e'});}
const typed=(e)=>e instanceof JurisdictionSourceProfileError;

test('C6 preserves canonical source values and explicit read-only boundary',()=>{
 const r=registry(); append(r); const input=[{v:1}];const result=preview(r,input);input[0].v=2;
 assert.equal(result.sourceEnvelope.payload.value[0].v,1);assert.equal(result.qualification.qualified,true);assert.equal(result.writeAuthorized,false);
});
for(const [label,make] of [
 ['sparse',()=>Array(2)],
 ['extra fields',()=>Object.assign([1],{hiddenSemanticValue:2})],
 ['symbol fields',()=>{const a=[1];a[Symbol('hidden')]=2;return a;}],
 ['subclass',()=>new (class extends Array{})(1,2)],
 ['array map override',()=>Object.assign([1],{map(){return [99];}})],
]){
 test('C6 rejects source arrays with '+label,()=>assert.throws(()=>preview(registry(),make()),typed));
 test('C6 rejects rule arrays with '+label,()=>assert.throws(()=>append(registry(),{value:make()}),typed));
}
test('C6 rejects array index getter without invoking it',()=>{
 let reads=0;const a=[1];Object.defineProperty(a,'0',{enumerable:true,get(){reads++;return 1;}});
 assert.throws(()=>preview(registry(),a),typed);assert.equal(reads,0);
});
for(const [label,get] of [['Map miss',()=>undefined],['null',()=>null],['wrong identity',()=>({id:'other'})],['async',()=>Promise.resolve({id:'e'})]]){
 test('C6 rejects '+label+' from supplied evidence ledger',()=>assert.throws(()=>append(registry({get})),typed));
}
