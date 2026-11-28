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

test('typed ledger separates released T3 technology, original T2, and still optional installed G4',()=>{
  assert.equal(current.schema,'IWXA_T3_G4_CURRENT_GATE_MATRIX/1');
  assert.equal(current.release_scope,'PRODUCT_NEUTRAL_NO_MANDATORY_ATLAS');
  assert.deepEqual(Object.keys(current.required_gates),names);
  for(const [gate,state] of Object.entries(current.required_gates)){
    assert.ok(levels.has(state.source),gate+' source level');
    assert.ok(levels.has(state.installed),gate+' installed level');
    assert.equal(typeof state.remaining,'string',gate+' remaining acceptance');
    assert.ok(state.remaining.length>12,gate+' acceptance must be actionable');
  }
  // T3 executable release is independent of an optional full ecosystem G4.
  // Do not require a native Publisher, Activity, Atlas, or all installed domain
  // profiles merely to reuse the same qualified T2/T3 One Core in a product.
  const core=current.core_release;
  const platformReleased=current.final_t3_release.state==='RELEASED';
  assert.equal(core.schema,'IWXA_T3_ONE_CORE_RELEASE_SCOPE/1');
  assert.equal(core.normative_t2_sha,current.pins.normative_t2);
  assert.equal(core.kernel_version,'0.3.6');
  assert.equal(core.runtime_contract,'1.3.0');
  assert.equal(core.auto_publish_to_sites,false);
  if(platformReleased){
    assert.ok(['0.3.1','0.3.2','0.3.3'].includes(core.version));
    assert.equal(core.status,'RELEASED_T3_TECHNOLOGY_'+core.version.replaceAll('.','_'));
    assert.equal(current.final_t3_release.version,core.version);
    assert.equal(current.previous_core_release_0_3_0.version,'0.3.0');
    assert.equal(core.promotion.release_tag,'t3-platform-v'+core.version);
    assert.equal(core.portable_inputs.version,core.version);
    if(core.version==='0.3.3'){
      assert.equal(core.promotion.scoped_delta.identical,168);
      assert.equal(core.promotion.scoped_delta.files,174);
      assert.equal(core.promotion.scoped_delta.compiled_assets_unchanged,true);
      assert.equal(core.promotion.scoped_delta.kernel_unchanged,true);
      assert.equal(core.promotion.scoped_delta.bli_unchanged,true);
      assert.equal(core.promotion.assistant_source_tests,137);
      assert.equal(core.promotion.offline_source_tests,19);
      assert.equal(core.promotion.browser_route_tests,2);
      assert.deepEqual(core.promotion.browser_viewports,['1440x900','375x812','320x568']);
      assert.equal(core.promotion.prior_model_hardware_evidence.model_generation_retested,false);
      assert.equal(core.promotion.prior_model_hardware_evidence.run,46065502722);
      assert.equal(core.promotion.independent_codex,'NOT_RUN_ON_0_3_3');
      assert.equal(current.previous_core_release_0_3_2.version,'0.3.2');
      assert.equal(current.final_t3_release.previous_release_evidence_0_3_2.source_sha,current.previous_core_release_0_3_2.source_sha);
      assert.equal(current.final_t3_release.previous_release_evidence_0_3_2.exact_platform_ci_run,46065502722);
    }else{
      assert.equal(core.promotion.metadata_only_delta.identical,171);
      assert.equal(core.promotion.metadata_only_delta.files,174);
    }
    // Preserve the exact historical 0.3.1 evidence. An upgraded ledger
    // must reference its own publication and actual model profiles.
    const prior=core.version==='0.3.1'?core:current.previous_core_release_0_3_1;
    assert.equal(prior.version,'0.3.1');
    assert.equal(prior.promotion.rc6_user_routes_run,46050260479);
    assert.equal(prior.promotion.hardware_run_on_unchanged_bli,46014698884);
    assert.equal(prior.promotion.independent_codex,'PARTIAL_ON_RC5');
    if(core.version==='0.3.2'||core.version==='0.3.3'){
      const qualified032=core.version==='0.3.2'?core:current.previous_core_release_0_3_2;
      const promotion=qualified032.promotion;
      assert.equal(promotion.metadata_only_delta.identical,171);
      assert.equal(promotion.metadata_only_delta.files,174);
      assert.match(promotion.assistant_source,hex40);
      assert.ok(Number.isSafeInteger(promotion.assistant_source_tests)&&promotion.assistant_source_tests>=137);
      assert.equal(promotion.prior_browser_run,46060488224);
      assert.equal(promotion.prior_hardware_run,46062741580);
      assert.equal(promotion.independent_codex,'NOT_RUN_ON_0_3_2');
      assert.deepEqual(promotion.profiles.map(p=>p.profile),['light','balanced','extended']);
      for(const p of promotion.profiles){
        assert.equal(p.exactSource,7);
        assert.equal(p.expectedChoices,7);
        assert.equal(p.coldOffline,true);
      }
      assert.equal(current.final_t3_release.previous_release_evidence_0_3_1.source_sha,prior.source_sha);
      assert.equal(current.final_t3_release.previous_release_evidence_0_3_1.exact_platform_ci_run,46053342716);
    }
    assert.equal(core.source_sha,current.final_t3_release.release_evidence.source_sha);
    assert.equal(core.executable_tree_sha,
      current.final_t3_release.release_evidence.source_tree_sha);
    assert.equal(core.portable_inputs.manifest_sha256,
      current.final_t3_release.release_evidence.portable_platform_manifest_sha256);
    assert.equal(current.final_t3_release.release_evidence.conclusion,'SUCCESS');
    assert.equal(current.final_t3_release.release_evidence.exact_platform_ci_run,core.promotion.publication_run);
    assert.ok(Number.isSafeInteger(core.promotion.publication_run)&&core.promotion.publication_run>0);
    assert.equal(current.final_t3_release.previous_release_evidence_0_3_0.exact_platform_ci_run,44913691238);
    assert.equal(core.migration_eligible,true);
  }else{
    assert.equal(core.status,'QUALIFIED_ENGINEERING_BASELINE_NOT_FINAL_T3');
    assert.equal(core.release_subject,
      'FROZEN_T2_T3_RUNTIME_QUALIFIED_FOR_FINAL_ENGINEERING_NOT_A_PRODUCT_RELEASE');
    assert.equal(core.source_sha,current.pins.one_core);
    assert.equal(core.executable_tree_sha,
      current.qualifications.current_one_core_full_qualification.exact_executable_src_tree_sha);
    assert.equal(core.migration_eligible,false);
  }
  assert.equal(current.required_gates.B0.installed,'PASS');
  assert.equal(current.qualifications.current_installed_agent.conclusion,'SUCCESS');
  assert.equal(current.qualifications.current_installed_admin.conclusion,'SUCCESS');
  assert.equal(current.qualifications.current_one_core_full_qualification.corrected_run_conclusion,'SUCCESS');
  assert.equal(core.verified_actions.original_t3_core_source,44772659989);
  assert.equal(core.verified_actions.installed_agent,
    current.qualifications.current_installed_agent.run_id);
  assert.equal(core.verified_actions.installed_center,
    current.qualifications.current_installed_admin.run_id);
  assert.equal(core.verified_actions.native_qwen_age_metal_jobs,
    current.qualifications.current_one_core_full_qualification.observed_full_run_id);
  assert.equal(current.verdict.t3_ready,platformReleased,
    'T3 platform readiness depends on exact technology evidence, not optional installed G4');
  assert.equal(current.final_t3_release.domain_migration_allowed,platformReleased);
  assert.equal(current.final_t3_release.transfer_contract,
    'EXISTING_MANUAL_OR_OWNER_SELECTED_IWXA_NO_MANDATORY_LIVE_INTERAPP_IPC');
  assert.equal(evidence.release_candidate.t3_ready,false,
    'Historical November 18 source candidate must not be rewritten as an accepted product');

  const allInstalledGatesPass=names.every(
    key=>current.required_gates[key].installed==='PASS');
  const finallyAccepted=current.verdict.g4==='ACCEPTED';
  assert.ok(['ACCEPTED','NOT_ACCEPTED'].includes(current.verdict.g4));
  assert.equal(current.final_acceptance_policy,'INDEPENDENT_TECHNOLOGY_D1_D7_ORIGINAL_T2_ONE_DIST');
  assert.equal(current.verdict.g4_scope,'HISTORICAL_OPTIONAL_ECOSYSTEM_INTEGRATION_NOT_T3_RELEASE_GATE');
  assert.equal(current.verdict.t3_ready,platformReleased);
  assert.ok(!evidence.release_candidate.production_ready||platformReleased,
    'platform production readiness requires its own final T3 technology release, not optional installed G4');
  assert.ok(!finallyAccepted||allInstalledGatesPass,
    'no optional aggregate G4 acceptance before every installed gate');
  if(finallyAccepted){
    const qualification=current.final_automated_acceptance;
    assert.match(qualification.source_sha,hex40);
    assert.ok(Number.isSafeInteger(qualification.run_id)&&qualification.run_id>0);
    assert.equal(qualification.conclusion,'SUCCESS');
    assert.deepEqual(qualification.pins,current.pins);
  }else{
    assert.equal(current.final_automated_acceptance,null);
  }
  assert.equal(evidence.accepted_gates.cross_product_G4,current.verdict.g4);
  assert.equal(evidence.policy.source_ci_never_equals_installed_product,true);
  assert.equal(evidence.policy.allow_private_actions,false);
});

test('frozen original installed receipts remain historical and new product candidate pins are exact',()=>{
  const installed=read('.github/workflows/t3-g4-installed-current-agent06.yml');
  const signed=read('.github/workflows/t3-installed-original-admin-center.yml');
  const source=read('packages/t3-core/scripts/qualify-original-agent-d3-port.mjs');
  const candidate=current.final_t3_release.installed_qualification_candidate;
  assert.equal(candidate.state,'PINNED_NEW_CANDIDATE_NOT_YET_ACCEPTED');
  assert.equal(candidate.approved,false,
    'editing Windows checkout pins cannot manufacture an installed product PASS');
  // Historical B0 installation remains frozen under its own SHA. Do not
  // rewrite previous successful source/installation receipts for new code.
  for(const [name,pin] of Object.entries(current.pins))
    assert.match(pin,hex40,'bad historical '+name+' SHA');
  assert.equal(current.qualifications.current_installed_agent.agent_sha,
    current.pins.installed_agent);
  assert.equal(current.qualifications.current_installed_admin.owner_sha,
    current.pins.original_t3_signed_owner);
  assert.notEqual(candidate.agent_sha,current.pins.installed_agent);
  assert.notEqual(candidate.original_t3_owner_sha,current.pins.original_t3_signed_owner);
  assert.notEqual(candidate.public_one_core_sha,current.pins.one_core);
  for(const key of ['agent_sha','original_t3_owner_sha','public_one_core_sha'])
    assert.match(candidate[key],hex40);
  assert.equal(pinnedCheckout(installed,'Faust-S/iwxa-personal-agent'),
    candidate.agent_sha);
  assert.equal(pinnedCheckout(installed,'Faust-S/knowledge'),
    candidate.public_one_core_sha);
  assert.equal(pinnedCheckout(installed,'Faust-S/Center'),
    current.pins.original_setup_core);
  assert.equal(pinnedCheckout(signed,'Faust-S/T3'),
    candidate.original_t3_owner_sha);
  // Both Center jobs must pin the very same NEW One Core as the Agent.
  const centerSourcePins=[...signed.matchAll(
    /- uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*ref: ([a-f0-9]{40})\b/g)];
  assert.equal(centerSourcePins.length,2);
  assert.ok(centerSourcePins.every(m=>m[1]===candidate.public_one_core_sha));
  const originalAgent=source.match(/export const AGENT_ORIGINAL_PIN='([a-f0-9]{40})'/);
  assert.ok(originalAgent);
  assert.equal(originalAgent[1],candidate.agent_sha);
  assert.equal(current.final_t3_release.company_workspace.agent_development_sha,
    candidate.agent_sha);
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
    assert.equal(q.current_installed_agent.overall_run_conclusion,'SUCCESS',
      'exact installed full Agent must not borrow a prior run that failed another gate');
    assert.equal(q.previous_failed_guest_installed_agent.code,'GUEST_SETUP_FAILED');
    assert.equal(q.previous_failed_guest_installed_agent.scope,'SETUP_CORE_PROGRAM_ROOT_UNDER_RESERVED_COMMON_APPLICATION_DATA');
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
  assert.equal(q.prior_agent28_guest_second_sid_result.conclusion,'FAIL');
  assert.equal(q.prior_agent28_guest_second_sid_result.original_native_gui_cold_and_independent_uia,true);
  assert.equal(q.prior_agent28_k03_model_failure.finite_reason,
    'K03_TASK_MODEL_EXECUTION_STOPPED');
  // Native second SID Setup/UIA/cold/uninstall passed on the previous Agent
  // even though the SAME workflow failed a distinct K03 model Task. Preserve
  // its narrower SUCCESS, never treat it as installed G4 or as current Agent.
  assert.equal(q.prior_agent10_second_sid_installed_pass.evidence_level,
    'INSTALLED_SECOND_WINDOWS_SID_GUI_PASS_HISTORICAL');
  assert.equal(q.prior_agent10_second_sid_installed_pass.conclusion,
    'SUCCESS_SECOND_SID_JOB');
  assert.equal(q.prior_agent10_second_sid_installed_pass.overall_run_conclusion,
    'FAIL_K03_MODEL_OUTPUT');
  assert.notEqual(q.prior_agent10_second_sid_installed_pass.agent_sha,
    current.pins.installed_agent);
  assert.ok(q.prior_agent10_second_sid_installed_pass.final_markers.includes(
    'G4_AGENT_INSTALLED_GUEST_NATIVE_GUI_COLD_UIA_PASS'));
  assert.equal(q.prior_agent10_k03_failed.background_state,'PAUSED');
  assert.equal(q.prior_agent10_k03_failed.background_error_class,
    'BASIC_RUNTIME_OUTPUT_INVALID');
  assert.equal(q.prior_agent10_k03_failed.runtime_model_inference_complete,false);
  assert.equal(q.prior_agent10_signed_d3_pass.conclusion,'SUCCESS');
  assert.equal(q.prior_agent10_signed_d3_pass.evidence_level,
    'SOURCE_NATIVE_PROCESS_PASS_HISTORICAL');
  assert.notEqual(q.prior_agent10_signed_d3_pass.agent_sha,
    current.pins.installed_agent);

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
    // A newly pinned owner has no run ID until GitHub schedules its exact
    // workflow. Do not assign a historical run to the new SHA.
    assert.ok(q[key].run_id===null ||
      (Number.isSafeInteger(q[key].run_id)&&q[key].run_id>0));
    if(q[key].conclusion==='SUCCESS')assert.ok(q[key].run_id>0);
    assert.ok(['IN_PROGRESS','SUCCESS','FAIL','CANCELLED','QUEUED'].includes(q[key].conclusion));
    assert.ok(['NOT_YET_ACCEPTED','SOURCE_NATIVE_PROCESS_PASS',
      'INSTALLED_PRODUCT_PASS'].includes(q[key].evidence_level));
    if(q[key].conclusion!=='SUCCESS')assert.equal(q[key].evidence_level,'NOT_YET_ACCEPTED');
  }
});
