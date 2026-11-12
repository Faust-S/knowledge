// Optional request preparation for the current Agent 0.5 K02 owner CLI.
// It consumes a separately checked native-model candidate, and never changes
// a provider, executes an owner program or claims a native P01 receipt.
import {CONTRACT_VERSION,InteropError,digest,
  resolveRequirements,buildInvocationPlan} from './index.mjs';
import {recommendModelForStep} from './model-step-selection.mjs';
import {AGENT05_OLLAMA_CANDIDATE_VERSION}
  from './agent05-native-model-candidate.mjs';

export const AGENT05_OWNER_REQUEST_DRAFT_VERSION=
  'IWXA.K02.AGENT05_OWNER_REQUEST_DRAFT/0.1.0';
const HEX=/^[0-9a-f]{64}$/;
const TASK=/^TASK-[A-Za-z0-9_-]{1,100}$/;
const NAME=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const rec=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pinMatches=(a,b)=>rec(a)&&rec(b)&&a.name===b.name&&
  typeof a.name==='string'&&a.name.length>0&&
  a.digest===b.digest&&HEX.test(a.digest??'');
function invalid(reason){throw new InteropError('INVALID_AGENT05_OWNER_DRAFT',reason);}
function state(status,reason,other={}){
  return {schema:AGENT05_OWNER_REQUEST_DRAFT_VERSION,status,reason,
    ownerRequest:null,ownerRequestDigest:null,hostAuthorityGranted:false,
    ownerExecuted:false,ownerReceiptsVerified:false,graphChanged:false,
    modelInvoked:false,resultProduced:false,...other};
}
function fixedPlan(plan,trusted){
  if(!rec(plan)||!HEX.test(trusted??'')||plan.planDigest!==trusted)
    invalid('native_scoped_plan_not_trusted');
  const body={...plan};delete body.planDigest;
  if(digest(body)!==trusted)invalid('native_scoped_plan_changed');
}
function safeTrialRows(rows,pin,providerId,profile,step,environment){
  // Do not relabel alias evidence as native evidence. The native provider's
  // independent observation must already exist in the host's evidence feed.
  if(!Array.isArray(rows)||rows.length!==1)return false;
  const row=rows[0];
  return rec(row)&&row.providerId===providerId&&
    pinMatches(row.modelPin,pin)&&row.taskClass===step.taskClass&&
    row.difficulty===step.difficulty&&row.operatingSystem===environment.operatingSystem&&
    row.runtimeVersion===profile.runtimeVersion&&
    typeof row.proofRef==='string'&&row.proofRef.trim().length>0&&
    Number.isSafeInteger(row.attempts)&&row.attempts>=step.minSamples&&
    Number.isSafeInteger(row.passed)&&row.passed>=0&&row.passed<=row.attempts;
}


// Existing K02 trial evidence has no model digest field. Require a separate,
// host-bound observation that pins the EXACT native model digest and task.
// Do not retag an alias observation (or another OS/mode/model version) as native.
function checkedNativeTrial(observation,expectedSourceRef,expectedTaskKey,pin,profile,environment){
  if(observation===null)return {valid:true,scope:null};
  if(!rec(observation)||Object.keys(observation).sort().join(',')!==
       'mode,modelPin,scope,sourceRef,taskKey'||
     typeof expectedSourceRef!=='string'||!expectedSourceRef||
     observation.sourceRef!==expectedSourceRef||
     typeof expectedTaskKey!=='string'||!expectedTaskKey.trim()||
     observation.taskKey!==expectedTaskKey||
     !pinMatches(observation.modelPin,pin)||
     typeof observation.taskKey!=='string'||!observation.taskKey.trim()||
     (observation.mode!==null&&(typeof observation.mode!=='string'||!observation.mode.trim()))||
     !rec(observation.scope)||observation.scope.taskKey!==observation.taskKey||
     !Array.isArray(observation.scope.candidateConfigurations)||
     observation.scope.candidateConfigurations.length!==1||
     !Array.isArray(observation.scope.failures))return {valid:false,scope:null};
  const config=observation.scope.candidateConfigurations[0];
  const expected={
    providerId:'OLLAMA_LOCAL_V1',kind:'model',capabilityId:'text.generate',
    modelId:pin.name,executorVersion:profile.runtimeVersion,
    mode:observation.mode,operatingSystem:environment.operatingSystem,
  };
  if(!rec(config)||Object.keys(config).sort().join(',')!==
     Object.keys(expected).sort().join(',')||
     Object.keys(expected).some(k=>config[k]!==expected[k]))return {valid:false,scope:null};
  if(observation.scope.failures.some(row=>!rec(row)||
      row.taskKey!==observation.taskKey||
      Object.keys(expected).some(k=>row[k]!==expected[k])))
    return {valid:false,scope:null};
  return {valid:true,scope:observation.scope};
}

/** Prepare EXACT shape of the existing tools/agent03-owner-cli/k02.mjs.
 *
 * Native evidence MUST be separately collected and keyed by
 * OLLAMA_LOCAL_V1 + exact pin + OS + runtime + step class/difficulty.
 * K02 never fabricates or rekeys the alias's measured success rate.
 * The result is merely input to a future pinned U01 owner CLI call.
 */
export function prepareAgent05OwnerRequestDraft({
  nativeCandidate,trustedScopedPlanDigest,
  nativeDescriptor,nativeProfile,nativeQualityEvidence,
  step,environment,taskId,requirementId,
  nativeTrialObservation=null,trustedNativeTrialSourceRef=null,
  expectedTrialTaskKey=null,
}){
  if(!rec(nativeCandidate)||nativeCandidate.schema!==AGENT05_OLLAMA_CANDIDATE_VERSION||
     !TASK.test(taskId??'')||!NAME.test(requirementId??''))
    invalid('input_identity');
  if(nativeCandidate.status!=='SCOPED_NATIVE_MODEL_PROPOSED_NOT_AUTHORIZED'||
     nativeCandidate.hostAuthorityGranted!==false||
     nativeCandidate.ownerReceiptsVerified!==false||
     nativeCandidate.modelInvoked!==false||
     nativeCandidate.resultProduced!==false||
     nativeCandidate.globalModelChanged!==false||
     nativeCandidate.fullTaskPlanUsable!==false||
     nativeCandidate.nativeOwnerPreflightRequired!==true||
     nativeCandidate.nativeOwnerAction!=='REPLAN_WITH_PINNED_K02_K04_OWNER_CLI')
    return state('OWNER_REQUEST_HOLD','NATIVE_CANDIDATE_NOT_QUALIFIED');
  if(nativeCandidate.taskId!==taskId||nativeCandidate.requirementId!==requirementId||
     nativeCandidate.nativeProviderId!=='OLLAMA_LOCAL_V1')
    return state('OWNER_REQUEST_HOLD','NATIVE_CANDIDATE_SCOPE_CHANGED');
  fixedPlan(nativeCandidate.scopedPlanPreview,trustedScopedPlanDigest);
  const snapshot=nativeCandidate.scopedPlanPreview;
  if(snapshot.taskId!==taskId||snapshot.steps?.length!==1||
     snapshot.steps[0].requirementId!==requirementId||
     snapshot.steps[0].kind!=='model'||
     snapshot.steps[0].providerId!=='OLLAMA_LOCAL_V1'||
     snapshot.steps[0].capabilityId!=='text.generate'||
     snapshot.steps[0].effectClass!=='MODEL_INFERENCE'||
     snapshot.steps[0].invocationAuthority!=='HOST_ONLY'||
     snapshot.steps[0].invocationState!=='NOT_INVOKED'||
     snapshot.steps[0].proofOfInvoke!==null||
     !pinMatches(snapshot.steps[0].modelPin,nativeCandidate.modelPin)||
     snapshot.steps[0].capabilityDigest!==nativeCandidate.nativeCapabilityDigest)
    return state('OWNER_REQUEST_HOLD','SCOPED_NATIVE_PLAN_CHANGED');
  if(!rec(nativeProfile)||nativeProfile.providerId!=='OLLAMA_LOCAL_V1'||
     !pinMatches(nativeProfile.modelPin,nativeCandidate.modelPin)||
     !rec(step)||!rec(environment)||
     !safeTrialRows(nativeQualityEvidence,nativeCandidate.modelPin,
       'OLLAMA_LOCAL_V1',nativeProfile,step,environment))
    return state('OWNER_REQUEST_HOLD','INDEPENDENT_NATIVE_QUALITY_EVIDENCE_REQUIRED');
  const trial=checkedNativeTrial(nativeTrialObservation,trustedNativeTrialSourceRef,
    expectedTrialTaskKey,nativeCandidate.modelPin,nativeProfile,environment);
  if(!trial.valid)return state('OWNER_REQUEST_HOLD','NATIVE_TRIAL_SCOPE_NOT_BOUND');
  const req={solutionId:snapshot.solutionId,requirements:[{
    requirementId,kind:'model',capabilityId:'text.generate',required:true,
    inputSchema:snapshot.steps[0].inputSchema,
    outputSchema:snapshot.steps[0].outputSchema,
    effectClass:'MODEL_INFERENCE',inputModes:['text'],
    outputModes:['text'],modelPin:{...nativeCandidate.modelPin},
  }]};
  let resolution,recommended;
  try {
    resolution=resolveRequirements(req,[nativeDescriptor],trial.scope);
    // The exact-task negative observation is a hard veto even when an
    // unrelated aggregate quality sample meets the statistical floor.
    if(resolution.evidenceExclusions?.length){
      const failure=resolution.evidenceExclusions[0];
      return state('OWNER_REQUEST_HOLD','KNOWN_NATIVE_TASK_FAILURE',{
        failureKind:failure.failureKind,proofRef:failure.proofRef,
        failedProviderId:failure.providerId,
      });
    }
    recommended=recommendModelForStep({
      solution:req,requirementId,step,available:[nativeDescriptor],
      profiles:[nativeProfile],qualityEvidence:nativeQualityEvidence,
      environment,userModelPin:nativeCandidate.modelPin,
      allowPinnedAlternatives:false,trialEvidence:trial.scope,
    });
  } catch(e) {
    if(e instanceof InteropError)
      return state('OWNER_REQUEST_HOLD','NATIVE_DESCRIPTOR_OR_EVIDENCE_INVALID');
    throw e;
  }
  if(resolution.status!=='SUPPORTED'||resolution.selected?.length!==1)
    return state('OWNER_REQUEST_HOLD','NATIVE_CAPABILITY_UNAVAILABLE');
  const selected=resolution.selected[0];
  if(selected.providerId!=='OLLAMA_LOCAL_V1'||
     selected.capabilityDigest!==snapshot.steps[0].capabilityDigest||
     !pinMatches(selected.modelPin,nativeCandidate.modelPin))
    return state('OWNER_REQUEST_HOLD','NATIVE_CAPABILITY_CHANGED');
  if(recommended.decision!=='RECOMMENDED_NOT_AUTHORIZED'||
     recommended.selected?.quality?.status!=='MEETS_OBSERVED_FLOOR'||
     recommended.selected.providerId!=='OLLAMA_LOCAL_V1'||
     recommended.selected.capabilityDigest!==selected.capabilityDigest)
    return state('OWNER_REQUEST_HOLD','NATIVE_QUALITY_UNKNOWN_OR_BELOW_FLOOR');
  const preview=buildInvocationPlan({taskId,solutionId:req.solutionId},[],resolution);
  if(preview.planDigest!==trustedScopedPlanDigest)
    return state('OWNER_REQUEST_HOLD','NATIVE_PLAN_ESTIMATE_OR_BINDING_CHANGED');
  // Exact snake_case owner CLI envelope, one requirement per owner invocation.
  // The P01 caller must still run its genuine pinned executable through U01.
  const ownerRequest={schema:'PA.K02_K04.OWNER_REQUEST/0.1.0',
    task_id:taskId,
    k02:{
      solution:req,providers:[nativeDescriptor],selected_skills:[],
      trial_evidence:trial.scope,
      model_recommendation:{
        requirement_id:requirementId,step,
        profiles:[nativeProfile],quality_evidence:nativeQualityEvidence,
        environment,user_model_pin:{...nativeCandidate.modelPin},
      },
    },
  };
  return state('OWNER_REQUEST_DRAFT_NOT_EXECUTED',
    'PINNED_K02_OWNER_CLI_AND_K04_RECEIPTS_REQUIRED',{
    ownerRequest,ownerRequestDigest:digest(ownerRequest),
    taskId,requirementId,nativeProviderId:'OLLAMA_LOCAL_V1',
    selectedModelPin:{...nativeCandidate.modelPin},
    expectedOwnerPlanDigest:trustedScopedPlanDigest,
    evidenceBasis:'HOST_SUPPLIED_NATIVE_OBSERVATIONS_NOT_AGENT_ATTESTATION',
    fullTaskPlanUsable:false,
    requiredNextActions:[
      'P01_PINNED_K02_OWNER_PROGRAM_INVOKE',
      'P01_PINNED_K04_OWNER_PROGRAM_INVOKE',
      'P01_CHECK_U01_OWNER_EXECUTION_RECEIPTS',
      'P01_GRAPH_MODEL_CHOICE_PREPARE',
      'P01_USER_APPROVAL',
    ],
  });
}
