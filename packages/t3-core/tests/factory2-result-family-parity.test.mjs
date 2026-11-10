import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResultFamilyParity as check,resultKindsForProductParity} from '../src/factory2/products/domain-completion/result-family-parity.mjs';
const families=Array.from({length:19},(_,i)=>`d06.family.${i+1}`);
const kinds=['acquisition-decision','configured-solution','offer-decision','delivery-item-acceptance','lifecycle-exit-decision'];
const bindings=families.map((family,i)=>({family,resultKind:kinds[i%5]}));
test('D06 19 persisted object families map to 5 accepted result groups',()=>{assert.deepEqual(check(families,bindings,kinds),{familiesCovered:19,resultKindsCovered:5});});
test('missing family fails closed',()=>{assert.throws(()=>check(families,bindings.slice(0,-1),kinds),/RESULT_FAMILY_COVERAGE_MISSING/);});
test('duplicate family fails closed',()=>{assert.throws(()=>check(families,[...bindings,bindings[0]],kinds),/RESULT_FAMILY_BINDING_INVALID/);});
test('unknown family fails closed',()=>{assert.throws(()=>check(families,[...bindings,{family:'other',resultKind:kinds[0]}],kinds),/RESULT_FAMILY_BINDING_INVALID/);});
test('unqualified kind fails closed',()=>{assert.throws(()=>check(families,bindings.map((b,i)=>i===0?{...b,resultKind:'made-up'}:b),kinds),/RESULT_FAMILY_BINDING_INVALID/);});
test('all accepted result groups are covered',()=>{assert.throws(()=>check(families,bindings.map(b=>({...b,resultKind:kinds[0]})),kinds),/RESULT_ACCEPTANCE_PARITY_MISSING/);});
test('read-only domain has empty persistent and Result sets',()=>{assert.deepEqual(check([],[],[]),{familiesCovered:0,resultKindsCovered:0});});
test('read-only domain cannot hide accepted Results',()=>{assert.throws(()=>check([],[],kinds),/RESULT_ACCEPTANCE_PARITY_MISSING/);});
test('wrong types do not pass',()=>{assert.throws(()=>check([42],[],[]),/RESULT_FAMILY_INPUT_INVALID/);});

test('site-only D11 six preliminary Result families qualify without human acceptance',()=>{
 const names=['process','data-role-matrix','automation-readiness','functional-requirements','terms-of-reference','project-brief'];
 const families=names.map(n=>'ru.iwxa.advice-logistics.'+n+'.proposal');
 const entries=names.map(n=>({resultKind:n,status:'PERSISTED_UNACCEPTED',acceptanceStatus:'NOT_REQUESTED'}));
 const bindings=names.map((n,i)=>({family:families[i],resultKind:n}));
 assert.deepEqual(check(families,bindings,resultKindsForProductParity(entries,{sourceOrigin:'CANONICAL_GIT_HEAD_TREE'})),{familiesCovered:6,resultKindsCovered:6});
 assert.deepEqual(resultKindsForProductParity(entries,{sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME'}),[]);
 assert.throws(()=>check(families,bindings,resultKindsForProductParity(entries,{sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME'})),/RESULT_FAMILY_BINDING_INVALID/);
 assert.deepEqual(resultKindsForProductParity([{resultKind:'old',status:'BOUND'}],{sourceOrigin:'OWNER_SUPPLIED_AT_TEST_TIME'}),['old']);
 assert.deepEqual(resultKindsForProductParity([{resultKind:'forged',status:'PERSISTED_UNACCEPTED',acceptanceStatus:'APPROVED'}],{sourceOrigin:'CANONICAL_GIT_HEAD_TREE'}),[]);
});
