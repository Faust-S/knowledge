// One current G4 verdict. Historical narrative evidence never upgrades a
// different Agent/One Core SHA, and a source PASS never proves installed G4.
// This pure public test requires no private product checkout or GitHub token.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const evidence=JSON.parse(read('packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json'));
const current=evidence.current_release;
const hex40=/^[a-f0-9]{40}$/;
const levels=new Set(['PASS','PARTIAL','HOLD']);
const names=['B0','D1','D2','D3','D4','D5','D6','D7'];

function pinnedCheckout(workflow,repo){
  const escaped=repo.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g,'\\$&');
  const match=workflow.match(new RegExp('repository: '+escaped+
    '\\s*\\r?\\n\\s*ref: ([a-f0-9]{40})\\b'));
  assert.ok(match,'exact pinned checkout required: '+repo);
  return match[1];
}

test('typed current ledger requires independent installed B0 and D1-D7',()=>{
  assert.equal(current.schema,'IWXA_T3_G4_CURRENT_GATE_MATRIX/1');
  assert.equal(current.release_scope,'PRODUCT_NEUTRAL_NO_MANDATORY_ATLAS');
  assert.deepEqual(Object.keys(current.required_gates),names);
  for(const [gate,state] of Object.entries(current.required_gates)){
    assert.ok(levels.has(state.source),gate+' source level');
    assert.ok(levels.has(state.installed),gate+' installed level');
    assert.equal(typeof state.remaining,'string',gate+' remaining acceptance');
    assert.ok(state.remaining.length>12,gate+' acceptance must be actionable');
  }
  const allInstalledGatesPass=names.every(
    key=>current.required_gates[key].installed==='PASS');
  const finallyAccepted=current.verdict.g4==='ACCEPTED';
  assert.ok(['ACCEPTED','NOT_ACCEPTED'].includes(current.verdict.g4));
  // All installed gates are NECESSARY, not sufficient. An independent final
  // release acceptance is a distinct owner decision; never auto-promote G4.
  assert.equal(current.verdict.t3_ready,finallyAccepted);
  assert.equal(evidence.release_candidate.t3_ready,finallyAccepted);
  assert.ok(!evidence.release_candidate.production_ready||finallyAccepted);
  assert.ok(!finallyAccepted||allInstalledGatesPass,
    'no G4 acceptance before every installed gate');
  if(finallyAccepted){
    assert.ok(current.final_independent_acceptance?.source_sha);
    assert.match(current.final_independent_acceptance.source_sha,hex40);
    assert.equal(current.final_independent_acceptance.accepted,true);
  }else{
    assert.equal(current.final_independent_acceptance,null);
  }
  assert.equal(evidence.accepted_gates.cross_product_G4,current.verdict.g4);
  assert.equal(evidence.policy.source_ci_never_equals_installed_product,true);
  assert.equal(evidence.policy.allow_private_actions,false);
});

test('current original Agent, One Core, Setup and signed Owner pins are exact',()=>{
  const installed=read('.github/workflows/t3-g4-installed-current-agent06.yml');
  const signed=read('.github/workflows/t3-installed-original-admin-center.yml');
  const source=read('packages/t3-core/scripts/qualify-original-agent-d3-port.mjs');
  for(const [name,pin] of Object.entries(current.pins))
    assert.match(pin,hex40,'bad '+name+' current SHA');
  assert.equal(current.pins.installed_agent,
    pinnedCheckout(installed,'Faust-S/iwxa-personal-agent'));
  assert.equal(current.pins.one_core,pinnedCheckout(installed,'Faust-S/knowledge'));
  assert.equal(current.pins.original_setup_core,pinnedCheckout(installed,'Faust-S/Center'));
  assert.equal(current.pins.original_t3_signed_owner,pinnedCheckout(signed,'Faust-S/T3'));
  const originalAgent=source.match(/export const AGENT_ORIGINAL_PIN='([a-f0-9]{40})'/);
  assert.ok(originalAgent,'signed D3 original Agent pin required');
  assert.equal(originalAgent[1],current.pins.installed_agent);
});

test('current source and installed runs cannot borrow historical signed D3 success',()=>{
  const q=current.qualifications;
  assert.equal(q.last_original_d3_source_pass.evidence_level,
    'SOURCE_NATIVE_PROCESS_PASS_HISTORICAL');
  assert.notEqual(q.last_original_d3_source_pass.agent_sha,current.pins.installed_agent);
  assert.equal(q.current_original_d3_source.agent_sha,current.pins.installed_agent);
  assert.equal(q.current_installed_agent.agent_sha,current.pins.installed_agent);
  assert.equal(q.source_generic_d6.one_core_sha,current.pins.one_core);
  for(const key of ['current_original_d3_source','current_installed_agent']){
    assert.ok(Number.isSafeInteger(q[key].run_id)&&q[key].run_id>0);
    assert.ok(['IN_PROGRESS','SUCCESS','FAIL','CANCELLED','QUEUED'].includes(q[key].conclusion));
    assert.ok(['NOT_YET_ACCEPTED','SOURCE_NATIVE_PROCESS_PASS',
      'INSTALLED_PRODUCT_PASS'].includes(q[key].evidence_level));
    if(q[key].conclusion!=='SUCCESS')assert.equal(q[key].evidence_level,'NOT_YET_ACCEPTED');
  }
});
