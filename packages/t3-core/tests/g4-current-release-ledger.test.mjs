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
  // Center's independent public and native Windows jobs must compile the
  // identical One Core that qualified the installed Agent, not branch HEAD.
  const originalCenterSourcePins=[...signed.matchAll(
    /- uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref: ([a-f0-9]{40})\b/g)];
  assert.equal(originalCenterSourcePins.length,2,
    'public and installed Center must both pin One Core');
  assert.ok(originalCenterSourcePins.every(m=>m[1]===current.pins.one_core),
    'Center/Agent One Core SHA mismatch');
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
  if(q.current_original_d3_source.conclusion==='SUCCESS'){
    assert.equal(q.current_original_d3_source.evidence_level,'SOURCE_NATIVE_PROCESS_PASS');
    assert.equal(q.current_original_d3_source.marker_count,26);
    assert.equal(current.required_gates.D3.source,'PASS');
  }
  assert.equal(q.current_installed_agent.agent_sha,current.pins.installed_agent);
  // Prior separate installed Qwen success remains historical at its OWN SHA.
  // A later failed run is not proof of broken production and cannot count as
  // success for a new Agent diagnostic-only commit.
  assert.notEqual(q.previous_exact_agent_installed_pass.agent_sha,
    current.pins.installed_agent);
  assert.equal(q.previous_exact_agent_installed_pass.conclusion,'SUCCESS');
  assert.equal(q.previous_exact_agent_installed_pass.evidence_level,
    'INSTALLED_PRODUCT_PASS_HISTORICAL');
  assert.equal(q.previous_exact_agent_source_d3_pass.conclusion,'SUCCESS');
  assert.equal(q.previous_exact_agent_source_d3_pass.evidence_level,
    'SOURCE_NATIVE_PROCESS_PASS_HISTORICAL');
  assert.equal(q.previous_failed_agent_install_attempt.conclusion,'FAIL');
  assert.equal(q.previous_failed_agent_install_attempt.finite_phase,'K03_TASK_EXECUTE');
  assert.equal(q.previous_failed_agent_install_attempt.last_checkpoint,
    'AGENT_K03_TASK_ACCEPTED');
  const wf=read('.github/workflows/t3-g4-installed-current-agent06.yml');
  assert.match(wf,/test_agent06_k03_finite_failure_sidecar[.]py/);
  assert.match(wf,/G4_AGENT06_K03_PRIVATE_DIAG_ON_CURRENT_AGENT_PREFLIGHT_PASS/);
  if(q.current_installed_agent.conclusion==='SUCCESS'){
    assert.equal(q.current_installed_agent.evidence_level,'INSTALLED_PRODUCT_PASS');
    assert.equal(q.current_installed_agent.overall_run_conclusion,'FAIL_GUEST_SECOND_SID_SETUP');
    assert.equal(q.previous_failed_guest_installed_agent.code,'GUEST_SETUP_FAILED');
    assert.equal(q.previous_failed_guest_installed_agent.scope,'SETUP_CORE_PROGRAM_ROOT_UNDER_RESERVED_COMMON_APPLICATION_DATA');
    assert.equal(current.required_gates.D3.installed,'PARTIAL');
    assert.equal(q.current_installed_agent.scope,
      'STANDALONE_NATIVE_GUI_QWEN_REVIEW_K03_COLD_SETUP_REPAIR_ROLLBACK_NOT_CROSS_PRODUCT');
    assert.ok(Array.isArray(q.current_installed_agent.final_markers));
    assert.equal(q.current_installed_agent.final_markers.length,4);
  }
  assert.equal(q.current_one_core_full_qualification.exact_executable_one_core_sha,
    current.pins.one_core);
  assert.equal(q.current_one_core_full_qualification.corrected_run_conclusion,'SUCCESS');
  assert.equal(q.current_one_core_full_qualification.acceptance_scope,
    'SOURCE_AND_HARDWARE_ONLY_NOT_INSTALLED_TWO_INDEPENDENT_PRODUCTS');
  assert.equal(q.current_pwa_source_installability.one_core_sha,current.pins.one_core);
  assert.equal(q.current_pwa_source_installability.native_os_install_result,
    'SKIPPED_UNSUPPORTED_DEVTOOLS_PWA_INSTALL');
  assert.equal(current.required_gates.D5.installed,'HOLD');
  assert.equal(q.prior_agent28_guest_second_sid_result.conclusion,'FAIL');
  assert.equal(q.prior_agent28_guest_second_sid_result.original_native_gui_cold_and_independent_uia,true);
  assert.equal(q.prior_agent28_k03_model_failure.finite_reason,
    'K03_TASK_MODEL_EXECUTION_STOPPED');
  assert.equal(q.source_generic_d6.one_core_sha,current.pins.one_core);
  assert.equal(q.current_installed_admin.center_sha,current.pins.installed_center);
  assert.equal(q.current_installed_admin.one_core_sha,current.pins.one_core);
  assert.equal(q.current_installed_admin.owner_sha,current.pins.original_t3_signed_owner);
  assert.equal(q.current_installed_admin.conclusion,'SUCCESS');
  assert.equal(q.current_installed_admin.evidence_level,'INSTALLED_PRODUCT_PASS');
  assert.equal(q.current_installed_admin.scope,
    'CENTER_ORIGINAL_SIGNED_OWNER_NATIVE_ENROLL_DPAPI_COLD_NOT_CROSS_PRODUCT');
  assert.ok(Array.isArray(q.current_installed_admin.final_markers));
  assert.equal(q.current_installed_admin.final_markers.length,5);
  assert.equal(q.current_second_sid_gui_os_preflight.conclusion,'SUCCESS');
  assert.equal(q.current_second_sid_gui_os_preflight.evidence_level,
    'OS_PRECONDITION_ONLY_NOT_INSTALLED_PRODUCT');
  assert.equal(q.current_installed_agent_second_sid.agent_sha,current.pins.installed_agent);
  assert.ok(['IN_PROGRESS','QUEUED','SUCCESS','FAIL','CANCELLED'].includes(
    q.current_installed_agent_second_sid.conclusion));
  if(q.current_installed_agent_second_sid.conclusion!=='SUCCESS'){
    assert.equal(q.current_installed_agent_second_sid.evidence_level,
      'NOT_YET_ACCEPTED');
  }else{
    assert.equal(q.current_installed_agent_second_sid.evidence_level,
      'INSTALLED_SECOND_WINDOWS_SID_GUI_PASS_NOT_CORPORATE_D3');
  }
  for(const key of ['current_original_d3_source','current_installed_agent']){
    assert.ok(Number.isSafeInteger(q[key].run_id)&&q[key].run_id>0);
    assert.ok(['IN_PROGRESS','SUCCESS','FAIL','CANCELLED','QUEUED'].includes(q[key].conclusion));
    assert.ok(['NOT_YET_ACCEPTED','SOURCE_NATIVE_PROCESS_PASS',
      'INSTALLED_PRODUCT_PASS'].includes(q[key].evidence_level));
    if(q[key].conclusion!=='SUCCESS')assert.equal(q[key].evidence_level,'NOT_YET_ACCEPTED');
  }
});
