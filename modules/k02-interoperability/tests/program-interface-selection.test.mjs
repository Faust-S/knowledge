import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_VERSION, buildInvocationPlan, resolveRequirements} from '../index.mjs';
import {resolveProgramInterface, verifyProgramInterfaceReadiness, draftAgentU01Candidate, projectAgentU01Operation, AGENT_U01_PREPARATION_VERSION, PROGRAM_INTERFACE_VERSION} from '../program-interface-selection.mjs';

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

test('changed browser and computer observations invalidate selected surface, even at same epoch',async()=>{
  const b=choose({available:[available[1]],observations:[observations[1]]});
  const alteredTab=structuredClone(observations[1]);
  alteredTab.browser.observationRef='browser:new-observation';
  const r=await ready(b,async()=>alteredTab);
  assert.equal(r.status,'INTERFACE_NOT_READY');
  assert.equal(r.reason,'TAB_OR_BINDING_CHANGED');

  const c=choose({available:[available[2]],observations:[observations[2]]});
  const alteredScreen=structuredClone(observations[2]);
  alteredScreen.computer.observationRef='screen:new-observation';
  const g=await ready(c,async()=>alteredScreen);
  assert.equal(g.status,'INTERFACE_NOT_READY');
  assert.equal(g.reason,'WINDOW_OR_SCREEN_CHANGED');
});
test('stale observation is refused during fresh pre-invocation readiness',async()=>{
  const b=choose({available:[available[1]],observations:[observations[1]]});
  const r=await verifyProgramInterfaceReadiness({
    handoff:b,trustedHandoffDigest:b.handoffDigest,
    trustedPlanDigest:b.plan.planDigest,provider:fakeProvider('browser'),
    observe:async()=>observations[1],nowMs:NOW+6000,operatingSystem:'Windows 11',
  });
  assert.equal(r.status,'INTERFACE_NOT_READY');
  assert.equal(r.reason,'OBSERVATION_STALE');
  assert.equal(r.hostAuthorityGranted,false);
});
test('one existing Task with multiple K04 requirements produces a one-step K02 host draft',()=>{
  const extended={solutionId:solution.solutionId,requirements:[
    {requirementId:'context',kind:'tool',capabilityId:'source.read',
      inputSchema:IN,outputSchema:OUT,effectClass:'HOST_AUTHORIZED_READ',required:true},
    ...solution.requirements,
  ]};
  const r=choose({solution:extended});
  assert.equal(r.decision,'INTERFACE_PROPOSED_NOT_AUTHORIZED');
  assert.equal(r.plan.steps.length,1);
  assert.equal(r.plan.steps[0].requirementId,'update');
  assert.equal(r.plan.taskId,task.taskId);
  assert.equal(r.plan.solutionId,solution.solutionId);
  checkNoExecute(r);
});
test('method cost/latency and recovery are explanatory; never pretend measured UI success',()=>{
  const r=choose();
  const fee=r.alternatives.map(a=>a.providerFeeUsd);
  assert.deepEqual(fee,[0.003,0.001]);
  assert.equal(r.selected.providerFeeUsd,0.025);
  for (const a of [r.selected,...r.alternatives]) {
    assert.equal(a.accuracy,'NOT_MEASURED');
    assert.equal(a.recovery,'REOBSERVE_AND_REPLAN');
    assert.equal(a.expectedResultObservation.observedAfterInvocation,false);
    assert.ok(a.limitations.includes('RESULT_NOT_YET_VERIFIED'));
  }
  assert.equal(r.resultProduced,false);
});


const NATIVE_ARGUMENTS={type:'object',properties:{
  operation:{type:'string'},
  parameters:{type:'object',properties:{expression:{type:'string'}},
    required:['expression'],additionalProperties:false},
  connection_epoch:{type:'string'},
},required:['operation','parameters','connection_epoch'],additionalProperties:false};
const nativeSolution={solutionId:'native-agent03-program',requirements:[{
  requirementId:'program-step',kind:'tool',capabilityId:'program.invoke',
  inputSchema:NATIVE_ARGUMENTS,outputSchema:OUT,effectClass:'HOST_AUTHORIZED_WRITE',required:true,
}]};
const nativeTask={taskId:'existing-P01-task-ref',solutionId:nativeSolution.solutionId};
const nativeProvider={contractVersion:CONTRACT_VERSION,providerId:'JQ_CLI_V1',
  availability:'available',capabilities:[{kind:'tool',capabilityId:'program.invoke',
    supported:true,inputSchema:NATIVE_ARGUMENTS,outputSchema:OUT,
    effectClass:'HOST_AUTHORIZED_WRITE',providerFeeUsd:null,latencyMsP50:null}]};
const nativeObservation={
  providerId:'JQ_CLI_V1',path:'API',programRef:'JQ_CLI_V1',operationId:'program.invoke',
  u01:{connected:true,operationVerified:false,firstUseEligible:true,
    programOperation:'evaluate',operationId:'program.invoke',
    connectionEpoch:'123456789abcdef0',observationRef:'u01:connected'},
  u03:{compatible:false,reasons:['U03_CAPABILITY_UNAVAILABLE:program.evaluate'],
    capabilityStatusId:'program.evaluate',
    status:{schema:'IWXA_CAPABILITY_STATUS/1.0.0',id:'program.evaluate',
      available:false,reason:'execution-receipt-missing'}},
  host:{permissionObserved:false,permissionRef:'host:pending'},
  result:{observable:true,method:'READBACK',observationRef:'p01:readback-later'},
  observedAtMs:NOW-10,maxAgeMs:5000,
};
const nativeChoice=(o=nativeObservation)=>resolveProgramInterface({
 task:nativeTask,solution:nativeSolution,requirementId:'program-step',
 available:[nativeProvider],observations:[o],nowMs:NOW,operatingSystem:'Windows 11',
});
test('native Agent 0.3 first-use U01 proposal does not require a prior Core execution receipt',async()=>{
  const proposal=nativeChoice();
  assert.equal(proposal.decision,'INTERFACE_PROPOSED_NOT_AUTHORIZED');
  assert.equal(proposal.selected.firstUseNeedsNativeApproval,true);
  assert.equal(proposal.hostAuthorityGranted,false);
  assert.equal(proposal.resultProduced,false);
  assert.ok(proposal.selected.limitations.includes('U01_FIRST_USE_REQUIRES_NATIVE_PREPARE_APPROVAL'));
  const preflight=await verifyProgramInterfaceReadiness({
    handoff:proposal,trustedHandoffDigest:proposal.handoffDigest,
    trustedPlanDigest:proposal.plan.planDigest,
    provider:{describeCapabilities:async()=>nativeProvider},
    observe:async()=>nativeObservation,nowMs:NOW,operatingSystem:'Windows 11',
  });
  assert.equal(preflight.status,'MATCHED_NOT_AUTHORIZED');
  assert.equal(preflight.hostAuthorityGranted,false);
  const candidate=draftAgentU01Candidate({
    handoff:proposal,trustedHandoffDigest:proposal.handoffDigest,
    trustedPlanDigest:proposal.plan.planDigest,parameters:{expression:'1+1'},
  });
  assert.equal(candidate.schema,AGENT_U01_PREPARATION_VERSION);
  assert.equal(candidate.status,'ACTION_CANDIDATE_DRAFT_NOT_ACCEPTED');
  assert.deepEqual(candidate.intendedAction,{
    operation:'program.invoke',target:'JQ_CLI_V1',
    arguments:{operation:'evaluate',parameters:{expression:'1+1'},
      connection_epoch:'123456789abcdef0'},
    risk:'high',reversible:false,execution_tier:'T6_REQUIRED',
  });
  assert.equal(candidate.hostAuthorityGranted,false);
  assert.equal(candidate.providerInvoked,false);
  assert.equal(candidate.resultProduced,false);
  assert.equal(candidate.providerOperationRef,null);
});
test('first-use U03 unavailable states are only admitted for a declared and offerable U01 operation',()=>{
  for(const [change,reason] of [
    [o=>{o.u01.connected=false;},'U01_OPERATION_NOT_VERIFIED'],
    [o=>{o.u01.firstUseEligible=false;},'U01_OPERATION_NOT_VERIFIED'],
    [o=>{o.u01.programOperation='wrong';},'U01_OPERATION_NOT_VERIFIED'],
    [o=>{o.u03.status.reason='operation-unsupported';},'U03_CAPABILITY_UNAVAILABLE'],
    [o=>{o.u03.reasons=[];},'U03_CAPABILITY_UNAVAILABLE'],
    [o=>{o.u03.status.available=true;o.u03.status.version='1.0.0';o.u03.status.observationRef='unearned';},'U03_CAPABILITY_UNAVAILABLE'],
  ]){
    const o=structuredClone(nativeObservation);change(o);
    const r=nativeChoice(o);
    assert.equal(r.decision,'NO_READY_INTERFACE');
    assert.equal(r.excluded[0].reason,reason);
  }
});
test('draft refuses changed identity, incorrect native parameters and missing approval-proof fields',()=>{
  const p=nativeChoice();
  const base={handoff:p,trustedHandoffDigest:p.handoffDigest,
    trustedPlanDigest:p.plan.planDigest,parameters:{expression:'1+1'}};
  assert.throws(()=>draftAgentU01Candidate({...base,parameters:{wrong:'value'}}),/SCHEMA_VALUE_INVALID/);
  const mutated=structuredClone(p);
  mutated.selectedObservation.u01.connectionEpoch='new-connection-epoch';
  assert.throws(()=>draftAgentU01Candidate({...base,handoff:mutated}),/INVALID_INTERFACE_CHOICE/);
  assert.equal('idempotency_key_or_none' in draftAgentU01Candidate(base),false);
  assert.equal('nativeBindingVerified' in draftAgentU01Candidate(base),false);
  assert.equal('approval_id' in draftAgentU01Candidate(base),false);
});
test('native program operation is not equivalent to direct tool execution or a product Result',()=>{
  const p=nativeChoice();
  assert.equal(p.plan.steps[0].capabilityId,'program.invoke');
  assert.equal(p.selected.identity.u01ProgramOperation,'evaluate');
  assert.equal(p.selected.identity.u03CapabilityStatusId,'program.evaluate');
  assert.equal(p.selected.expectedResultObservation.observedAfterInvocation,false);
  const wrong=structuredClone(nativeObservation);
  wrong.operationId='program.evaluate';wrong.u01.operationId='program.evaluate';
  const result=nativeChoice(wrong);
  assert.equal(result.decision,'NO_READY_INTERFACE');
  assert.equal(result.excluded[0].reason,'OPERATION_MISMATCH');
});


function agentProjection({verified=false,offer=true,epoch='123456789abcdef0',reason}={}) {
  return {
    program_id:'JQ_CLI_V1',
    source:{schema:'IWXA_PROGRAM_CONNECTION/1.0.0',program_id:'JQ_CLI_V1',
      transport:'cli',status:'DECLARED',connected:true,connection_epoch:epoch},
    operations:[{operation:'evaluate',capability_id:'program.evaluate',
      can_offer_invocation:offer,execution_verified:verified,
      observation:verified
        ? {schema:'IWXA_CAPABILITY_STATUS/1.0.0',id:'program.evaluate',
           available:true,version:'1.0.0',observationRef:'TXR-confirmed'}
        : {schema:'IWXA_CAPABILITY_STATUS/1.0.0',id:'program.evaluate',
           available:false,reason:reason??'execution-receipt-missing'}}],
    execution_authority_granted:false,
  };
}
test('Agent 0.3 native projection becomes an offerable U01 first-use draft without inventing execution proof',()=>{
  const mapped=projectAgentU01Operation(agentProjection(),'evaluate');
  assert.equal(mapped.u01.firstUseEligible,true);
  assert.equal(mapped.executionVerified,false);
  assert.equal(mapped.u03.status.available,false);
  const obs={...structuredClone(nativeObservation),...mapped};
  const proposal=nativeChoice(obs);
  assert.equal(proposal.decision,'INTERFACE_PROPOSED_NOT_AUTHORIZED');
  const candidate=draftAgentU01Candidate({
    handoff:proposal,trustedHandoffDigest:proposal.handoffDigest,
    trustedPlanDigest:proposal.plan.planDigest,parameters:{expression:'2+2'},
  });
  assert.equal(candidate.intendedAction.arguments.connection_epoch,'123456789abcdef0');
  assert.equal(candidate.hostAuthorityGranted,false);
  assert.equal(candidate.resultProduced,false);
});
test('Agent 0.3 native projection distinguishes executed receipt from first-use capability',()=>{
  const mapped=projectAgentU01Operation(agentProjection({verified:true}),'evaluate');
  assert.equal(mapped.executionVerified,true);
  assert.equal(mapped.u01.firstUseEligible,false);
  assert.equal(mapped.u03.status.available,true);
  assert.equal(mapped.u03.status.observationRef,'TXR-confirmed');
  const obs={...structuredClone(nativeObservation),...mapped,
    host:{permissionObserved:true,permissionRef:'host:pending'}};
  assert.equal(nativeChoice(obs).decision,'INTERFACE_PROPOSED_NOT_AUTHORIZED');
});
test('Agent 0.3 U01 translation rejects unsupported operation, removed connection and false receipt',()=>{
  const disconnected=agentProjection();disconnected.source.connected=false;
  assert.throws(()=>projectAgentU01Operation(disconnected,'evaluate'),/INVALID_INTERFACE_CHOICE/);
  const changed=agentProjection();changed.source.connection_epoch=null;
  assert.throws(()=>projectAgentU01Operation(changed,'evaluate'),/INVALID_INTERFACE_CHOICE/);
  const wrong=agentProjection();wrong.operations[0].capability_id='program.other';
  assert.throws(()=>projectAgentU01Operation(wrong,'evaluate'),/INVALID_INTERFACE_CHOICE/);
  const denied=agentProjection({offer:false});
  assert.throws(()=>projectAgentU01Operation(denied,'evaluate'),/INVALID_INTERFACE_CHOICE/);
  const fabricated=agentProjection();fabricated.operations[0].execution_verified=true;
  assert.throws(()=>projectAgentU01Operation(fabricated,'evaluate'),/INVALID_INTERFACE_CHOICE/);
  const absence=agentProjection();absence.operations[0].observation.reason='operation-unsupported';
  assert.throws(()=>projectAgentU01Operation(absence,'evaluate'),/INVALID_INTERFACE_CHOICE/);
});
