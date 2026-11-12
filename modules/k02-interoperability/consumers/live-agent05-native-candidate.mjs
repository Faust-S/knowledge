// Real open-host qualification of K02 alias -> native Ollama model pin.
// This uses installed public Ollama, NOT the closed Personal Agent Core/P01.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {OllamaLocalModelProvider,MODEL_INPUT,MODEL_OUTPUT}
  from '../adapters/ollama-local.mjs';
import {verifyInvocationReadiness} from '../index.mjs';
import {recommendTaskStages} from '../task-step-composition.mjs';
import {prepareAgent05OllamaCandidate}
  from '../agent05-native-model-candidate.mjs';
import {prepareAgent05OwnerRequestDraft}
  from '../agent05-owner-request-draft.mjs';

const outputDir=process.env.K02_CASE_OUTPUT_DIR;
if(!outputDir)throw Error('K02_LIVE_OUTPUT_DIR_REQUIRED');
const measurements=JSON.parse(await readFile(join(outputDir,'measurements.json'),'utf8'));
assert.equal(measurements.schema,'IWXA.K02.LIVE_DOCUMENT_STUDY/0.1.0');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ps=await fetch('http://127.0.0.1:11434/api/tags');
assert.equal(ps.status,200);
const tags=await ps.json();
assert.ok(Array.isArray(tags.models)&&tags.models.length>=2);
const version=(await (await fetch('http://127.0.0.1:11434/api/version')).json()).version;
const osName='linux-'+process.arch+';ollama-'+version;
const realModels=measurements.modelVariants;
assert.deepEqual(realModels.map(x=>x.id),['mini','qwen']);
const candidates=[],profiles=[],resourceProfiles=[],qualityEvidence=[];
for(const x of realModels){
  assert.match(x.expectedDigest,/^[a-f0-9]{64}$/);
  const installed=tags.models.filter(y=>y.name===x.modelName);
  assert.equal(installed.length,1);
  assert.equal(installed[0].digest,x.expectedDigest);
  const calibration=measurements.calibration.filter(y=>y.id===x.id);
  const medianOf=calibration.map(c=>c.medianDurationMs).sort((a,b)=>a-b);
  const latencyMsP50=medianOf[Math.floor(medianOf.length/2)]??null;
  const provider=new OllamaLocalModelProvider({...x,latencyMsP50});
  const descriptor=await provider.describeCapabilities();
  assert.equal(descriptor.availability,'available');
  candidates.push({id:x.id,provider,descriptor,latencyMsP50,
    modelPin:{name:x.modelName,digest:x.expectedDigest}});
  const runtimeVersion=osName+';thinking:'+x.thinkingMode;
  const minRamMiB=Math.ceil(installed[0].size/1048576+256);
  profiles.push({providerId:x.providerId,
    modelPin:{name:x.modelName,digest:x.expectedDigest},runtimeVersion,
    memoryMiB:minRamMiB,computeUsdPerAttempt:null,costBasis:'UNKNOWN'});
  resourceProfiles.push({providerId:x.providerId,
    modelPin:{name:x.modelName,digest:x.expectedDigest},
    minRamMiB,minVramMiB:0,contextWindowTokens:4096,basis:'ESTIMATED'});
  for(const row of calibration.filter(c=>c.taskClass==='summary')){
    qualityEvidence.push({providerId:x.providerId,
      modelPin:{name:x.modelName,digest:x.expectedDigest},
      taskClass:'summary',difficulty:'complex',operatingSystem:osName,
      runtimeVersion,passed:row.passed,attempts:row.attempts,
      proofRef:'open-run:calibration:'+hash(row).slice(0,32)});
  }
}
let availableRamMiB=null;
try{
  const m=readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m);
  if(m)availableRamMiB=Math.floor(Number(m[1])/1024);
}catch{}
const now=Date.now(),taskId='TASK-K02-REAL-NATIVE';
const context={ref:'public-document-case',digest:measurements.sourceDigest};
const solution={solutionId:'real-ollama-summary',requirements:[{
  requirementId:'summary',kind:'model',capabilityId:'text.generate',required:true,
  inputSchema:MODEL_INPUT,outputSchema:MODEL_OUTPUT,effectClass:'MODEL_INFERENCE',
  inputModes:['text'],outputModes:['text']}]};
const recommendation=recommendTaskStages({
  task:{taskId,solutionId:solution.solutionId},solution,
  stages:[{stageId:'source-backed-summary',requirementId:'summary',
    requiredContextTokens:256,step:{taskClass:'summary',difficulty:'complex',
      minObservedSuccessRate:0.5,minSamples:2,maxAttempts:1,
      maxLatencyMs:null,maxMemoryMiB:null}}],
  available:candidates.map(x=>x.descriptor),profiles,qualityEvidence,
  resourceProfiles,resourceObservation:availableRamMiB===null?null:{
    availableRamMiB,availableVramMiB:null,observedAtMs:now,maxAgeMs:10000,
    sourceRef:'open-run:proc-meminfo'},
  environment:{operatingSystem:osName},nowMs:now+1,
  selectedSkills:[],contextBinding:context,
});
const result={schema:'IWXA.K02.OPEN_OLLAMA_NATIVE_REBIND_TRIAL/0.1.0',
  boundary:'REAL_OPEN_OLLAMA_NOT_PRIVATE_AGENT_P01',
  timeBasis:'ONE_PUBLIC_RUN_NOT_WINDOWS_BENCHMARK',
  studySourceDigest:measurements.sourceDigest,
  calibration:measurements.calibration.filter(c=>c.taskClass==='summary'),
  selection:recommendation.decision,
  selectedCandidateId:recommendation.stages[0].providerId??null,
  nativeModelPin:null,nativePlanDigest:null,hostProviderInvoked:false,
  nativeAgentResultProduced:false,status:'NOT_RUN',
  resourceBasis:'MemAvailable and estimated model weight plus 256MiB',
  measuredHostComputeCostUsd:null,
  independentNativeQuality:null,ownerRequestDraftStatus:'NOT_RUN',
  ownerRequestDigest:null,ownerPlanPreviewDigest:null};
if(recommendation.decision==='STAGES_PROPOSED_NOT_AUTHORIZED'){
  const selected=candidates.find(x=>x.descriptor.providerId===result.selectedCandidateId);
  assert.ok(selected,'SELECTED_REAL_PROVIDER_UNAVAILABLE');
  const native=new OllamaLocalModelProvider({
    modelName:selected.modelPin.name,expectedDigest:selected.modelPin.digest,
    providerId:'OLLAMA_LOCAL_V1',
    latencyMsP50:selected.latencyMsP50,
    thinkingMode:selected.provider.thinkingMode,
  });
  const nativeDescriptor=await native.describeCapabilities();
  assert.equal(nativeDescriptor.availability,'available');
  const inventoryRef='open-host:ollama-tags:'+hash(tags.models);
  const observed=prepareAgent05OllamaCandidate({
    recommendation,trustedRecommendationDigest:recommendation.recommendationDigest,
    trustedPlanDigest:recommendation.plan.planDigest,taskId,
    requirementId:'summary',expectedContextBinding:context,
    candidateDescriptor:selected.descriptor,nativeDescriptor,
    candidateBinding:{candidateProviderId:selected.descriptor.providerId,
      modelPin:selected.modelPin,nativeProviderId:'OLLAMA_LOCAL_V1',
      sourceRef:inventoryRef},
    activeBinding:{providerId:'OLLAMA_LOCAL_V1',
      bindingDigest:'OPEN_HOST_PSEUDO_BINDING_NOT_AGENT'},
    trustedNativeBindingDigest:'OPEN_HOST_PSEUDO_BINDING_NOT_AGENT',
    localAiSetup:{source_confirmed:true,daemon_ready:true,
      local_models:tags.models.map(x=>({name:x.name,digest:x.digest}))},
    trustedInventoryRef:inventoryRef,nowMs:Date.now(),
  });
  assert.equal(observed.status,'SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED');
  assert.equal(observed.fullTaskPlanUsable,false);
  assert.equal(observed.hostAuthorityGranted,false);
  assert.equal(observed.ownerReceiptsVerified,false);
  const preflight=await verifyInvocationReadiness(
    observed.scopedPlanPreview,'summary',native,observed.scopedPlanPreview.planDigest);
  assert.equal(preflight.status,'MATCHED_NOT_AUTHORIZED');
  const prompt='Return the single word READY, or report that you cannot comply.';
  const inference=await native.invoke('text.generate',
    {system:'Reply briefly in plain text.',prompt,max_output_tokens:24},
    {hostApproved:true,pinnedModelDigest:selected.modelPin.digest});
  assert.ok(inference.output.text.trim().length>0);
  assert.equal(inference.output.model_digest,selected.modelPin.digest);
  result.status='REAL_NATIVE_OPEN_HOST_MODEL_INVOKE';
  result.nativeModelPin=selected.modelPin;
  result.nativePlanDigest=observed.scopedPlanPreview.planDigest;
  result.hostProviderInvoked=true;
  result.nativeAgentResultProduced=false;
  result.observedDurationMs=inference.observation.durationMs;
  result.proofClass=inference.observation.proofClass;
  result.modelAnswerSha256=createHash('sha256').update(inference.output.text).digest('hex');
  // These are fresh, independently invoked native-provider trials, not a
  // relabel of earlier "ollama-qwen" alias quality_evidence. Tiny samples
  // are only open-host qualification, not future quality guarantees.
  const trialPrompts=[
    ['Status is PENDING, not complete. Return only the status token.','PENDING'],
    ['References X-01 and X-02. Return only the second reference.','X-02'],
  ];
  const trialResults=[];
  for(const [prompt,expected] of trialPrompts){
    try{
      const reply=await native.invoke('text.generate',{
        system:'Answer with the requested single token or code; no commentary.',
        prompt,max_output_tokens:32,
      },{hostApproved:true,pinnedModelDigest:selected.modelPin.digest});
      const actual=reply.output.text.trim();
      trialResults.push({expected,correct:actual===expected,
        durationMs:reply.observation.durationMs,
        outputSha256:createHash('sha256').update(actual).digest('hex'),
        invokeProof:reply.observation.proofClass});
    }catch(e){
      trialResults.push({expected,correct:false,error:String(e.code??e.message)});
    }
  }
  const successes=trialResults.filter(x=>x.correct).length;
  const nativeRuntimeVersion=osName+';thinking:'+selected.provider.thinkingMode;
  const evidence=[{
    providerId:'OLLAMA_LOCAL_V1',modelPin:selected.modelPin,
    taskClass:'summary',difficulty:'complex',operatingSystem:osName,
    runtimeVersion:nativeRuntimeVersion,attempts:trialResults.length,
    passed:successes,proofRef:'open-real-native:'+hash(trialResults),
  }];
  const selectedProfile=profiles.find(x=>x.providerId===selected.descriptor.providerId);
  assert.ok(selectedProfile);
  const nativeProfile={...selectedProfile,providerId:'OLLAMA_LOCAL_V1'};
  const nativeOwnerInputs={
    nativeCandidate:observed,trustedScopedPlanDigest:observed.scopedPlanPreview.planDigest,
    nativeDescriptor,nativeProfile,nativeQualityEvidence:evidence,
    step:{taskClass:'summary',difficulty:'complex',
      minObservedSuccessRate:0.5,minSamples:2,maxAttempts:1,
      maxLatencyMs:null,maxMemoryMiB:null},
    environment:{operatingSystem:osName},taskId,requirementId:'summary',
  };
  const ownerDraft=prepareAgent05OwnerRequestDraft(nativeOwnerInputs);
  const failedResponse=trialResults.find(row=>!row.correct&&row.outputSha256);
  if(failedResponse){
    const nativeStack={providerId:'OLLAMA_LOCAL_V1',kind:'model',
      capabilityId:'text.generate',modelId:selected.modelPin.name,
      executorVersion:nativeProfile.runtimeVersion,
      mode:selected.provider.thinkingMode,operatingSystem:osName};
    const taskKey='open-token-qualification:'+failedResponse.expected;
    const sourceRef='open-real-native:'+selected.modelPin.digest;
    const proofRef='open-real-native-incorrect:'+failedResponse.outputSha256;
    const nativeTrialObservation={
      modelPin:selected.modelPin,taskKey,sourceRef,mode:nativeStack.mode,
      scope:{taskKey,candidateConfigurations:[nativeStack],
        failures:[{...nativeStack,taskKey,failureKind:'INCORRECT_RESULT',proofRef}]},
    };
    const denied=prepareAgent05OwnerRequestDraft({...nativeOwnerInputs,
      nativeTrialObservation,trustedNativeTrialSourceRef:sourceRef,
      expectedTrialTaskKey:taskKey});
    assert.equal(denied.status,'OWNER_REQUEST_HOLD');
    assert.equal(denied.reason,'KNOWN_NATIVE_TASK_FAILURE');
    assert.equal(denied.ownerRequest,null);
    assert.equal(denied.proofRef,proofRef);
    result.nativeKnownFailureVeto={status:'EXACT_TASK_FAILURE_HELD',
      taskKey,proofRef,reason:denied.reason,ownerRequestProduced:false};
  } else {
    result.nativeKnownFailureVeto={status:'NOT_RUN_NO_OBSERVED_INCORRECT_OUTPUT'};
  }
  assert.equal(ownerDraft.ownerExecuted,false);
  assert.equal(ownerDraft.ownerReceiptsVerified,false);
  assert.equal(ownerDraft.modelInvoked,false);
  assert.equal(ownerDraft.resultProduced,false);
  result.independentNativeQuality={attempts:trialResults.length,
    passed:successes,proofRef:evidence[0].proofRef,trialResults,
    qualification:'OBSERVED_OPEN_HOST_SAMPLE_NOT_QUALITY_GUARANTEE'};
  result.ownerRequestDraftStatus=ownerDraft.status;
  result.ownerRequestDigest=ownerDraft.ownerRequestDigest;
  result.ownerPlanPreviewDigest=ownerDraft.expectedOwnerPlanDigest??null;
  if(ownerDraft.status==='OWNER_REQUEST_DRAFT_NOT_EXECUTED'){
    assert.equal(ownerDraft.ownerRequest.k02.providers.length,1);
    assert.equal(ownerDraft.ownerRequest.k02.providers[0].providerId,'OLLAMA_LOCAL_V1');
    assert.equal(ownerDraft.ownerRequest.k02.model_recommendation.quality_evidence[0].providerId,
      'OLLAMA_LOCAL_V1');
    await writeFile(join(outputDir,'native-owner-request-draft.json'),
      JSON.stringify({boundary:'OPEN_HOST_DRAFT_NOT_AGENT_U01_OWNER_RECEIPT',
        ownerRequest:ownerDraft.ownerRequest,ownerRequestDigest:ownerDraft.ownerRequestDigest,
        modelInvokedByOwner:false,ownerReceiptProduced:false},null,2)+'\n');
  }else{
    assert.equal(ownerDraft.status,'OWNER_REQUEST_HOLD');
    assert.equal(ownerDraft.ownerRequest,null);
  }
}
await writeFile(join(outputDir,'native-ollama-candidate.json'),JSON.stringify(result,null,2)+'\n');
process.stdout.write('K02_REAL_OLLAMA_NATIVE_CANDIDATE '+JSON.stringify(result)+'\n');
