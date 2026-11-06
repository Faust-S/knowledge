// Optional K02 host-neutral interface choice for one existing tool requirement.
// U01 operates the program; U03 qualifies observed capabilities; U04 presents
// the native window/surface. P01 owns grants, invocation and Result.
import {
  CONTRACT_VERSION, InteropError, digest, resolveRequirements,
  buildInvocationPlan, verifyInvocationReadiness,
} from './index.mjs';

export const PROGRAM_INTERFACE_VERSION = 'IWXA.K02.PROGRAM_INTERFACE_CHOICE/0.1.0';
const PATHS = ['API', 'BROWSER_USE', 'COMPUTER_USE'];
const U03_STATUS = 'IWXA_CAPABILITY_STATUS/1.0.0';
const U04_BRIDGE = 'IWXA_PRESENTATION_BRIDGE/1.0.0';
const HEX = /^[a-f0-9]{64}$/;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const token = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(v);
function fail(reason) { throw new InteropError('INVALID_INTERFACE_CHOICE', reason); }
function fields(o, keys, label) {
  if (!object(o) || Object.keys(o).some(k => !keys.includes(k))) fail(label);
}
function requirementFor(solution, requirementId) {
  if (!object(solution) || !Array.isArray(solution.requirements) || !token(requirementId)) fail('requirement');
  const matches = solution.requirements.filter(r => r.requirementId === requirementId);
  if (matches.length !== 1 || matches[0].kind !== 'tool') fail('single_tool_requirement');
  return matches[0];
}
function checkShape(o) {
  fields(o, ['providerId','path','programRef','operationId','u01','u03','host','result','observedAtMs','maxAgeMs',
    'browser','computer','u04'], 'interface_fields');
  for (const k of ['providerId','programRef','operationId']) if (!token(o[k])) fail(k);
  if (!PATHS.includes(o.path)) fail('interface_path');
  fields(o.u01,['connected','operationVerified','operationId','connectionEpoch','observationRef'],'u01');
  if (!token(o.u01.connectionEpoch) || !token(o.u01.observationRef) ||
      !token(o.u01.operationId) ||
      typeof o.u01.connected !== 'boolean' || typeof o.u01.operationVerified !== 'boolean') fail('u01_observation');
  fields(o.u03,['status','capabilityStatusId','compatible','reasons'],'u03');
  fields(o.u03.status,['schema','id','version','available','observationRef','reason'],'u03_status');
  if (o.u03.status.schema !== U03_STATUS || !token(o.u03.status.id) ||
      !token(o.u03.capabilityStatusId) ||
      !token(o.u03.status.version) || !token(o.u03.status.observationRef) ||
      typeof o.u03.status.available !== 'boolean' ||
      typeof o.u03.compatible !== 'boolean' ||
      !Array.isArray(o.u03.reasons)) fail('u03_provenance');
  fields(o.host,['permissionObserved','permissionRef'],'host');
  if (typeof o.host.permissionObserved !== 'boolean' || !token(o.host.permissionRef)) fail('host_permission');
  fields(o.result,['observable','method','observationRef'],'result');
  if (typeof o.result.observable !== 'boolean' ||
      !['READBACK','DOM_OBSERVATION','SCREEN_OBSERVATION'].includes(o.result.method) ||
      !token(o.result.observationRef)) fail('result_observability');
  if (!Number.isSafeInteger(o.observedAtMs) || o.observedAtMs < 0 ||
      !Number.isSafeInteger(o.maxAgeMs) || o.maxAgeMs < 1 || o.maxAgeMs > 120000) fail('observation_age');
  if (o.path === 'API') {
    if (o.browser !== undefined || o.computer !== undefined || o.u04 !== undefined ||
        o.result.method !== 'READBACK') fail('api_shape');
  } else if (o.path === 'BROWSER_USE') {
    if (o.computer !== undefined || o.u04 !== undefined ||
        o.result.method !== 'DOM_OBSERVATION') fail('browser_shape');
    fields(o.browser,['tabRef','tabEpoch','active','commandId','commandSupported','observationRef'],'browser');
    for (const k of ['tabRef','tabEpoch','commandId','observationRef'])
      if (!token(o.browser[k])) fail('browser_'+k);
    if (typeof o.browser.active !== 'boolean' ||
        typeof o.browser.commandSupported !== 'boolean') fail('browser_state');
  } else {
    if (o.browser !== undefined || o.result.method !== 'SCREEN_OBSERVATION') fail('computer_shape');
    fields(o.computer,['operatingSystem','windowRef','processStamp','windowPresent','focused','screenRef',
      'screenEpoch','screenReadable','requiredInputs','availableInputs','observationRef'],'computer');
    for (const k of ['operatingSystem','windowRef','processStamp','screenRef','screenEpoch','observationRef'])
      if (!token(o.computer[k])) fail('computer_'+k);
    if (typeof o.computer.windowPresent !== 'boolean' || typeof o.computer.focused !== 'boolean' ||
        typeof o.computer.screenReadable !== 'boolean' ||
        !Array.isArray(o.computer.requiredInputs) ||
        !Array.isArray(o.computer.availableInputs) ||
        o.computer.requiredInputs.length === 0 ||
        o.computer.requiredInputs.some(x => !['keyboard','pointer'].includes(x)) ||
        o.computer.availableInputs.some(x => !['keyboard','pointer'].includes(x))) fail('computer_inputs');
    fields(o.u04,['schema','status','binding'],'u04');
    fields(o.u04.binding,['appRef','bindingRef','windowRef','processStamp'],'u04_binding');
    if (o.u04.schema !== U04_BRIDGE ||
        !token(o.u04.binding.appRef) || !token(o.u04.binding.bindingRef) ||
        !token(o.u04.binding.windowRef) || !token(o.u04.binding.processStamp)) fail('u04_identity');
  }
}
function readiness(o, nowMs, operatingSystem) {
  checkShape(o);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !token(operatingSystem)) fail('clock_or_os');
  if (nowMs < o.observedAtMs || nowMs - o.observedAtMs > o.maxAgeMs)
    return 'OBSERVATION_STALE';
  if (o.u01.operationId !== o.operationId || !o.u01.connected || !o.u01.operationVerified)
    return 'U01_OPERATION_NOT_VERIFIED';
  if (o.u03.status.id !== o.u03.capabilityStatusId) return 'U03_CAPABILITY_ID_CHANGED';
  if (o.u03.compatible !== true || o.u03.status.available !== true ||
      o.u03.reasons.length !== 0) return 'U03_CAPABILITY_UNAVAILABLE';
  if (!o.host.permissionObserved) return 'HOST_PERMISSION_NOT_OBSERVED';
  if (!o.result.observable) return 'RESULT_OBSERVATION_UNAVAILABLE';
  if (o.path === 'BROWSER_USE') {
    if (o.browser.commandId !== o.operationId || !o.browser.commandSupported)
      return 'BROWSER_COMMAND_UNSUPPORTED';
    if (!o.browser.active) return 'TAB_NOT_ACTIVE';
  }
  if (o.path === 'COMPUTER_USE') {
    if (o.computer.operatingSystem !== operatingSystem) return 'OS_UNAVAILABLE';
    if (!o.computer.windowPresent) return 'WINDOW_NOT_FOUND';
    if (!o.computer.focused || o.u04.status !== 'WINDOW_FOCUSED')
      return 'WINDOW_NOT_FOCUSED';
    if (!o.computer.screenReadable) return 'SCREEN_UNAVAILABLE';
    if (!o.computer.requiredInputs.every(k => o.computer.availableInputs.includes(k)))
      return 'INPUT_UNAVAILABLE';
    if (o.u04.binding.windowRef !== o.computer.windowRef ||
        o.u04.binding.processStamp !== o.computer.processStamp ||
        o.u04.binding.appRef !== o.programRef) return 'WINDOW_IDENTITY_CHANGED';
  }
  return null;
}
function identity(o) {
  return {
    providerId:o.providerId,path:o.path,programRef:o.programRef,operationId:o.operationId,
    connectionEpoch:o.u01.connectionEpoch,
    u01ObservationRef:o.u01.observationRef,
    u01OperationId:o.u01.operationId,
    u03CapabilityStatusId:o.u03.capabilityStatusId,
    u03ObservationRef:o.u03.status.observationRef,
    hostPermissionRef:o.host.permissionRef,
    resultObservationRef:o.result.observationRef,
    ...(o.browser?{tabRef:o.browser.tabRef,tabEpoch:o.browser.tabEpoch,
      commandId:o.browser.commandId}:{}),
    ...(o.computer?{windowRef:o.computer.windowRef,processStamp:o.computer.processStamp,
      screenRef:o.computer.screenRef,screenEpoch:o.computer.screenEpoch,
      operatingSystem:o.computer.operatingSystem,
      u04BindingRef:o.u04.binding.bindingRef}:{}),
  };
}
function summary(o, selected) {
  return {path:o.path,providerId:o.providerId,programRef:o.programRef,
    operationId:o.operationId,identity:identity(o),
    providerFeeUsd:selected.providerFeeUsd,latencyMsP50:selected.latencyMsP50,
    capabilityDigest:selected.capabilityDigest,
    observedAtMs:o.observedAtMs,maxAgeMs:o.maxAgeMs,
    expectedResultObservation:{method:o.result.method,observationRef:o.result.observationRef,
      required:true,observedAfterInvocation:false},
    limitations:['HOST_REOBSERVATION_REQUIRED','HOST_INVOCATION_AUTHORITY_REQUIRED',
      'RESULT_NOT_YET_VERIFIED','RECOVERY_REQUIRES_CURRENT_BINDING'],
    accuracy:'NOT_MEASURED',recovery:'REOBSERVE_AND_REPLAN',
  };
}
// Adapter around the SAME K02 resolver and SAME invocation plan. No runtime.
// A program is eligible only for an exact operation with current U01/U03,
// host permission, and a declared result-observation channel. Visual paths
// additionally require current tab/window/screen references.
export function resolveProgramInterface({
  task,solution,requirementId,available,observations,nowMs,operatingSystem,
  trialEvidence=null,selectedSkills=[],
}) {
  const req=requirementFor(solution,requirementId);
  if (!object(task) || task.solutionId !== solution.solutionId ||
      !Array.isArray(available) || !Array.isArray(observations) ||
      !Array.isArray(selectedSkills) || observations.length>128) fail('inputs');
  if (solution.requirements.length !== 1) fail('one_operation_per_handoff');
  const ids=new Set(), accepted=[],excluded=[];
  for (const o of observations) {
    checkShape(o);
    if (ids.has(o.providerId)) fail('duplicate_interface');
    ids.add(o.providerId);
    if (o.operationId !== req.capabilityId) {
      excluded.push({providerId:o.providerId,reason:'OPERATION_MISMATCH'});continue;
    }
    const d=available.find(x=>x.providerId===o.providerId);
    if (!d) { excluded.push({providerId:o.providerId,reason:'PROVIDER_NOT_REGISTERED'});continue; }
    const matched=resolveRequirements(solution,[d],trialEvidence);
    if (matched.status !== 'SUPPORTED') {
      excluded.push({providerId:o.providerId,reason:matched.missing[0]?.reason??'INCOMPATIBLE'});
      continue;
    }
    const reason=readiness(o,nowMs,operatingSystem);
    if (reason) { excluded.push({providerId:o.providerId,reason});continue; }
    accepted.push({observation:o,descriptor:d});
  }
  const sorted=accepted.sort((a,b) => PATHS.indexOf(a.observation.path)-PATHS.indexOf(b.observation.path));
  const firstPath=sorted[0]?.observation.path;
  const peers=sorted.filter(x=>x.observation.path===firstPath).map(x=>x.descriptor);
  const resolved=firstPath?resolveRequirements(solution,peers,trialEvidence):null;
  const selected=resolved?.status==='SUPPORTED'?resolved.selected[0]:null;
  const o=selected?sorted.find(x=>x.observation.providerId===selected.providerId)?.observation:null;
  const plan=selected?buildInvocationPlan(task,selectedSkills,resolved):null;
  const chosen=o?summary(o,selected):null;
  const draft={schema:PROGRAM_INTERFACE_VERSION,
    decision:chosen?'INTERFACE_PROPOSED_NOT_AUTHORIZED':'NO_READY_INTERFACE',
    requirementId,selected:chosen,alternatives:sorted
      .filter(x=>x.observation.providerId!==selected?.providerId)
      .map(x=>summary(x.observation,resolveRequirements(solution,[x.descriptor],trialEvidence).selected[0])),
    excluded,plan,
    selectedObservation:o??null,
    hostAuthorityGranted:false,providerInvoked:false,resultProduced:false};
  return {...draft,handoffDigest:digest(draft)};
}
// Call only with a fresh host-observed U01/U03/U04 or Browser/Computer status.
// The owning host separately retains the plan digest AND handoff digest.
export async function verifyProgramInterfaceReadiness({
  handoff, trustedHandoffDigest, trustedPlanDigest, provider, observe, nowMs, operatingSystem,
}) {
  if (!object(handoff) || !HEX.test(trustedHandoffDigest??'') ||
      !HEX.test(trustedPlanDigest??'') || typeof observe!=='function') fail('trusted_inputs');
  const body={...handoff};delete body.handoffDigest;
  if (handoff.handoffDigest!==trustedHandoffDigest ||
      digest(body)!==trustedHandoffDigest ||
      handoff.decision!=='INTERFACE_PROPOSED_NOT_AUTHORIZED' ||
      !handoff.selected || !handoff.plan ||
      handoff.plan.planDigest!==trustedPlanDigest ||
      handoff.hostAuthorityGranted!==false || handoff.providerInvoked!==false ||
      handoff.resultProduced!==false) fail('untrusted_handoff');
  const step=handoff.plan.steps.find(s=>s.requirementId===handoff.requirementId);
  if (!step || step.providerId!==handoff.selected.providerId ||
      step.capabilityDigest!==handoff.selected.capabilityDigest ||
      step.invocationAuthority!=='HOST_ONLY' || step.proofOfInvoke!==null) fail('step_mismatch');
  const probed=await verifyInvocationReadiness(
    handoff.plan,handoff.requirementId,provider,trustedPlanDigest);
  const current=await observe();
  // A host observation is asynchronous. Refuse a changed handoff after it returns.
  const unchanged={...handoff};delete unchanged.handoffDigest;
  if (handoff.handoffDigest!==trustedHandoffDigest ||
      digest(unchanged)!==trustedHandoffDigest) fail('handoff_changed_during_observation');
  const reason=readiness(current,nowMs,operatingSystem);
  if (reason) return {status:'INTERFACE_NOT_READY',reason,hostAuthorityGranted:false};
  if (digest(identity(current))!==digest(handoff.selected.identity)) {
    return {status:'INTERFACE_NOT_READY',reason:current.path==='BROWSER_USE'?
      'TAB_OR_BINDING_CHANGED':current.path==='COMPUTER_USE'?
      'WINDOW_OR_SCREEN_CHANGED':'PROGRAM_CONNECTION_CHANGED',hostAuthorityGranted:false};
  }
  return {status:'MATCHED_NOT_AUTHORIZED',path:current.path,
    requirementId:probed.requirementId,planDigest:trustedPlanDigest,
    handoffDigest:trustedHandoffDigest,expectedResultObservation:handoff.selected.expectedResultObservation,
    hostAuthorityGranted:false,providerInvoked:false,resultProduced:false};
}
