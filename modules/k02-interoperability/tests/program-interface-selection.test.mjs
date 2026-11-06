import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_VERSION, buildInvocationPlan, resolveRequirements} from '../index.mjs';
import {resolveProgramInterface, verifyProgramInterfaceReadiness, PROGRAM_INTERFACE_VERSION} from '../program-interface-selection.mjs';

const NOW=1_000_000;
const IN={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const OUT={type:'object',properties:{ack:{type:'string'}},required:['ack'],additionalProperties:false};
const solution={solutionId:'k02-interfaces',requirements:[{requirementId:'update',kind:'tool',
  capabilityId:'record.update',inputSchema:IN,outputSchema:OUT,effectClass:'HOST_AUTHORIZED_WRITE',required:true}]};
const task={taskId:'interface-test',solutionId:solution.solutionId};
const provider=(providerId,fee,latency)=>({contractVersion:CONTRACT_VERSION,providerId,
  availability:'available',capabilities:[{kind:'tool',capabilityId:'record.update',supported:true,
  inputSchema:IN,outputSchema:OUT,effectClass:'HOST_AUTHORIZED_WRITE',
  providerFeeUsd:fee,latencyMsP50:latency}]});
const available=[provider('api',0.025,20),provider('browser',0.003,140),provider('computer',0.001,500)];
const observation=(providerId,path)=>({
  providerId,path,programRef:'app-example',operationId:'record.update',
  u01:{connected:true,operationVerified:true,operationId:'record.update',connectionEpoch:'epoch-3',observationRef:'u01:1'},
  u03:{compatible:true,reasons:[],capabilityStatusId:'iwxa.record.update',status:{schema:'IWXA_CAPABILITY_STATUS/1.0.0',
    id:'iwxa.record.update',version:'1.0.0',available:true,observationRef:'u03:1'}},
  host:{permissionObserved:true,permissionRef:'host:permission'},
  result:{observable:true,method:path==='API'?'READBACK':path==='BROWSER_USE'?'DOM_OBSERVATION':'SCREEN_OBSERVATION',
    observationRef:'readback:ready'},
  observedAtMs:NOW-10,maxAgeMs:5000,
  ...(path==='BROWSER_USE'?{browser:{tabRef:'tab-2',tabEpoch:'tab-epoch-7',
    active:true,commandId:'record.update',commandSupported:true,observationRef:'browser:ready'}}:{}),
  ...(path==='COMPUTER_USE'?{
    computer:{operatingSystem:'Windows 11',windowRef:'hwnd-55',processStamp:'process-epoch',
      windowPresent:true,focused:true,screenRef:'screen-1',screenEpoch:'screen-epoch-5',
      screenReadable:true,requiredInputs:['pointer','keyboard'],
      availableInputs:['pointer','keyboard'],observationRef:'screen:ready'},
    u04:{schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',status:'WINDOW_FOCUSED',
      binding:{appRef:'app-example',bindingRef:'u04-bind-2',windowRef:'hwnd-55',processStamp:'process-epoch'}}
  }:{}),
});
const observations=['API','BROWSER_USE','COMPUTER_USE'].map((path,i)=>observation(['api','browser','computer'][i],path));
const choose=(overrides={})=>resolveProgramInterface({task,solution,requirementId:'update',
  available,observations,nowMs:NOW,operatingSystem:'Windows 11',...overrides});
function selectedProvider(result){return result.selected?.providerId??null;}
function checkNoExecute(result){
  assert.equal(result.hostAuthorityGranted,false);assert.equal(result.providerInvoked,false);
  assert.equal(result.resultProduced,false);
  assert.equal(result.plan?.steps[0]?.invocationAuthority,'HOST_ONLY');
  assert.equal(result.plan?.steps[0]?.proofOfInvoke,null);
}
const fakeProvider=(id)=>({describeCapabilities:async()=>available.find(p=>p.providerId===id),
  invoke:()=>{throw new Error('DO_NOT_INVOKE');}});
async function ready(chosen,current=()=>chosen.selectedObservation) {
  return verifyProgramInterfaceReadiness({handoff:chosen,
    trustedHandoffDigest:chosen.handoffDigest,trustedPlanDigest:chosen.plan.planDigest,
    provider:fakeProvider(chosen.selected.providerId),observe:current,nowMs:NOW,
    operatingSystem:'Windows 11'});
}
test('three ready paths prefer native API even though synthetic visual options cost less',()=>{
 const result=choose();assert.equal(result.schema,PROGRAM_INTERFACE_VERSION);
 assert.equal(result.decision,'INTERFACE_PROPOSED_NOT_AUTHORIZED');
 assert.equal(selectedProvider(result),'api');assert.equal(result.alternatives.length,2);
 assert.deepEqual(result.alternatives.map(a=>a.path),['BROWSER_USE','COMPUTER_USE']);
 assert.equal(result.selected.providerFeeUsd,0.025);
 assert.equal(result.selected.latencyMsP50,20);
 assert.equal(result.selected.accuracy,'NOT_MEASURED');
 assert.equal(result.selected.recovery,'REOBSERVE_AND_REPLAN');
 assert.equal(result.selected.expectedResultObservation.observedAfterInvocation,false);
 checkNoExecute(result);
});
test('API not available falls back to Browser Use with an already active tab and supported command',()=>{
 const obs=structuredClone(observations);obs[0].u01.connected=false;
 const result=choose({observations:obs});
 assert.equal(selectedProvider(result),'browser');
 assert.equal(result.excluded[0].reason,'U01_OPERATION_NOT_VERIFIED');
 assert.equal(result.selected.identity.tabRef,'tab-2');
 assert.equal(result.selected.identity.tabEpoch,'tab-epoch-7');
 checkNoExecute(result);
});
test('unavailable API and browser command fall back to Computer Use with focused verified native window',()=>{
 const obs=structuredClone(observations);
 obs[0].u03.status.available=false;obs[1].browser.commandSupported=false;
 const result=choose({observations:obs});
 assert.equal(selectedProvider(result),'computer');
 assert.equal(result.selected.identity.windowRef,'hwnd-55');
 assert.equal(result.selected.identity.processStamp,'process-epoch');
 assert.equal(result.selected.identity.screenEpoch,'screen-epoch-5');
 assert.deepEqual(result.excluded.map(x=>x.reason),['U03_CAPABILITY_UNAVAILABLE','BROWSER_COMMAND_UNSUPPORTED']);
 checkNoExecute(result);
});
test('tab switched, stale observation and unsupported capability never produce an eligible browser interface',()=>{
 for(const [name,change,reason] of [
  ['inactive',o=>{o.browser.active=false;},'TAB_NOT_ACTIVE'],
  ['unsupported',o=>{o.browser.commandSupported=false;},'BROWSER_COMMAND_UNSUPPORTED'],
  ['stale',o=>{o.observedAtMs=NOW-9000;},'OBSERVATION_STALE'],
  ['denied',o=>{o.host.permissionObserved=false;},'HOST_PERMISSION_NOT_OBSERVED'],
  ['unobserved',o=>{o.result.observable=false;},'RESULT_OBSERVATION_UNAVAILABLE'],
 ]){
  const o=structuredClone(observations[1]);change(o);
  const result=choose({available:[available[1]],observations:[o]});
  assert.equal(result.decision,'NO_READY_INTERFACE',name);
  assert.equal(result.excluded[0].reason,reason,name);
 }
});
test('vanished window, lost screen, changed input/OS or U04 identity fail closed',()=>{
 const scenarios=[
  [o=>{o.computer.windowPresent=false;},'WINDOW_NOT_FOUND'],
  [o=>{o.computer.screenReadable=false;},'SCREEN_UNAVAILABLE'],
  [o=>{o.computer.availableInputs=['pointer'];},'INPUT_UNAVAILABLE'],
  [o=>{o.computer.operatingSystem='Linux';},'OS_UNAVAILABLE'],
  [o=>{o.u04.binding.windowRef='different-window';},'WINDOW_IDENTITY_CHANGED'],
  [o=>{o.u04.status='WINDOW_NOT_FOUND';},'WINDOW_NOT_FOCUSED'],
 ];
 for(const [change,reason] of scenarios){
  const o=structuredClone(observations[2]);change(o);
  const result=choose({available:[available[2]],observations:[o]});
  assert.equal(result.decision,'NO_READY_INTERFACE');
  assert.equal(result.excluded[0].reason,reason);
 }
});
test('new browser tab epoch and native-window identity changes invalidate already selected handoff',async()=>{
 const browser=choose({available:[available[1]],observations:[observations[1]]});
 const before=await ready(browser);assert.equal(before.status,'MATCHED_NOT_AUTHORIZED');
 const changedTab=structuredClone(observations[1]);changedTab.browser.tabEpoch='epoch-8';
 const after=await ready(browser,async()=>changedTab);
 assert.equal(after.status,'INTERFACE_NOT_READY');assert.equal(after.reason,'TAB_OR_BINDING_CHANGED');
 const gui=choose({available:[available[2]],observations:[observations[2]]});
 assert.equal((await ready(gui)).status,'MATCHED_NOT_AUTHORIZED');
 const changedScreen=structuredClone(observations[2]);changedScreen.computer.screenEpoch='epoch-8';
 assert.equal((await ready(gui,async()=>changedScreen)).reason,'WINDOW_OR_SCREEN_CHANGED');
});
test('window vanishes between plan selection and readiness check',async()=>{
 const gui=choose({available:[available[2]],observations:[observations[2]]});
 const gone=structuredClone(observations[2]);gone.computer.windowPresent=false;
 assert.deepEqual(await ready(gui,async()=>gone),{
  status:'INTERFACE_NOT_READY',reason:'WINDOW_NOT_FOUND',hostAuthorityGranted:false
 });
});
test('plan and interface digests reject mutation and no host grant is fabricated',async()=>{
 const chosen=choose();checkNoExecute(chosen);
 assert.equal((await ready(chosen)).status,'MATCHED_NOT_AUTHORIZED');
 const tampered=structuredClone(chosen);tampered.selected.identity.connectionEpoch='injected';
 await assert.rejects(verifyProgramInterfaceReadiness({
  handoff:tampered,trustedHandoffDigest:chosen.handoffDigest,
  trustedPlanDigest:chosen.plan.planDigest,provider:fakeProvider('api'),
  observe:async()=>observations[0],nowMs:NOW,operatingSystem:'Windows 11',
 }),/INVALID_INTERFACE_CHOICE/);
});
test('capability changes invalidate exact K02 plan before the visual readiness result',async()=>{
 const chosen=choose();
 const modified=structuredClone(available[0]);
 modified.capabilities[0].providerFeeUsd=0.2;
 await assert.rejects(verifyProgramInterfaceReadiness({
  handoff:chosen,trustedHandoffDigest:chosen.handoffDigest,
  trustedPlanDigest:chosen.plan.planDigest,
  provider:{describeCapabilities:async()=>modified},
  observe:async()=>observations[0],nowMs:NOW,operatingSystem:'Windows 11',
 }),/BINDING_CHANGED/);
});
test('existing resolver baseline still ranks only compatible providers by price; new interface-aware choice blocks wrong surface',()=>{
 const baseline=resolveRequirements(solution,available);
 assert.equal(baseline.status,'SUPPORTED');assert.equal(baseline.selected[0].providerId,'computer');
 const obs=structuredClone(observations);obs[2].computer.windowPresent=false;
 const chosen=choose({observations:obs});
 assert.equal(selectedProvider(chosen),'api');
 assert.ok(chosen.excluded.some(x=>x.providerId==='computer'&&x.reason==='WINDOW_NOT_FOUND'));
});

test('U01 wrong operation and U03 unrelated capability cannot enable a surface',()=>{
  const badOperation=structuredClone(observations[0]);
  badOperation.u01.operationId='another.operation';
  const r=choose({available:[available[0]],observations:[badOperation]});
  assert.equal(r.decision,'NO_READY_INTERFACE');
  assert.equal(r.excluded[0].reason,'U01_OPERATION_NOT_VERIFIED');
  const wrongStatus=structuredClone(observations[1]);
  wrongStatus.u03.status.id='iwxa.unrelated';
  const b=choose({available:[available[1]],observations:[wrongStatus]});
  assert.equal(b.excluded[0].reason,'U03_CAPABILITY_ID_CHANGED');
});
test('readiness rejects an async modification of the handoff after a provider probe',async()=>{
  const selected=choose();
  const trusted=selected.handoffDigest;
  const provider={describeCapabilities:async()=>{
    selected.selected.programRef='altered';
    return available[0];
  }};
  await assert.rejects(verifyProgramInterfaceReadiness({handoff:selected,
    trustedHandoffDigest:trusted,trustedPlanDigest:selected.plan.planDigest,
    provider,observe:async()=>observations[0],nowMs:NOW,operatingSystem:'Windows 11',
  }),/INVALID_INTERFACE_CHOICE/);
});
test('one chosen interface produces a normal K02 plan that requires P01 approval',()=>{
 const result=choose();
 assert.equal(result.plan.steps.length,1);
 assert.equal(result.plan.steps[0].providerId,'api');
 assert.equal(result.plan.steps[0].invocationState,'NOT_INVOKED');
 assert.equal(result.plan.steps[0].hostApprovalRequired,true);
 assert.equal(result.selected.expectedResultObservation.observedAfterInvocation,false);
 assert.equal(result.resultProduced,false);
});
