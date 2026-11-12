// Host-neutral, optional K02 composition. Reuses the verified model selector,
// capability resolver and existing invocation plan. Never executes a Task,
// chooses a Graph edge, activates a Skill or allocates a model runtime.
import {
  CONTRACT_VERSION, InteropError, digest, resolveRequirements, buildInvocationPlan,
} from './index.mjs';
import { recommendModelForStep } from './model-step-selection.mjs';

export const STAGE_SELECTION_VERSION = 'IWXA.K02.TASK_STAGE_SELECTION/0.1.0';
const HEX=/^[a-f0-9]{64}$/;
const rec=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string'&&v.length>0&&v.length<=180;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const issue=reason=>{throw new InteropError('INVALID_STAGE_SELECTION',reason);};
function keys(value,allowed,label){
  if(!rec(value)||Object.keys(value).some(k=>!allowed.includes(k)))issue(label);
}
function pinKey(pin){return pin?.name+'@'+pin?.digest;}
function memoryReason(profile,budget,requiredTokens){
  if(!profile)return 'RESOURCE_REQUIREMENT_UNKNOWN';
  if(!rec(profile.modelPin)||!HEX.test(profile.modelPin.digest??''))return 'RESOURCE_PROFILE_INVALID';
  if(!Number.isSafeInteger(profile.minRamMiB)||profile.minRamMiB<0||
     !Number.isSafeInteger(profile.minVramMiB)||profile.minVramMiB<0||
     !Number.isSafeInteger(profile.contextWindowTokens)||profile.contextWindowTokens<=0||
     !['MEASURED','ESTIMATED'].includes(profile.basis))return 'RESOURCE_PROFILE_INVALID';
  if(budget===null)return 'RESOURCE_OBSERVATION_UNAVAILABLE';
  if(budget.ageStatus!=='FRESH')return 'RESOURCE_OBSERVATION_STALE';
  if(budget.availableRamMiB===null)return 'RAM_UNKNOWN';
  if(profile.minRamMiB>budget.availableRamMiB)return 'RAM_INSUFFICIENT';
  if(profile.minVramMiB>0 && budget.availableVramMiB===null)return 'VRAM_UNKNOWN';
  if(profile.minVramMiB>(budget.availableVramMiB??0))return 'VRAM_INSUFFICIENT';
  if(requiredTokens>profile.contextWindowTokens)return 'CONTEXT_CAPACITY_INSUFFICIENT';
  return null;
}
function budgetSnapshot(input,nowMs){
  if(input===null)return null;
  keys(input,['availableRamMiB','availableVramMiB','observedAtMs','maxAgeMs','sourceRef'],'resource_snapshot');
  if((input.availableRamMiB!==null&&!integer(input.availableRamMiB))||
     (input.availableVramMiB!==null&&!integer(input.availableVramMiB))||
     !integer(input.observedAtMs)||!integer(input.maxAgeMs)||input.maxAgeMs===0||
     input.maxAgeMs>120000||!str(input.sourceRef))issue('resource_observation_invalid');
  return {...input,ageStatus:nowMs>=input.observedAtMs&&nowMs-input.observedAtMs<=input.maxAgeMs?'FRESH':'STALE',
    resourceCost:'OBSERVED_AVAILABLE_NOT_RESERVED'};
}
function selectedTool(scoped,available,trialEvidence,explicitProvider){
  const eligible=explicitProvider?available.filter(x=>x.providerId===explicitProvider):available;
  const result=resolveRequirements(scoped,eligible,trialEvidence);
  return result.status==='SUPPORTED'?{selected:result.selected[0],status:'SUPPORTED'}:
    {status:'UNSUPPORTED',reason:result.missing[0]?.reason??'ABSENT'};
}
function knownSum(rows,key){
  return rows.every(x=>x[key]!==null)&&rows.every(x=>typeof x[key]==='number')
    ? Number(rows.reduce((sum,x)=>sum+x[key],0).toFixed(6)):null;
}
// stages are already accepted Task step requirements (K04/P01), NOT a new
// planner. K02 only recommends compatible providers with current capacity.
// For a model, insufficient or unknown quality never becomes success.
// A host pin is binding; no automatic fallback changes a user's pin.
export function recommendTaskStages({
  task,solution,stages,available,profiles=[],qualityEvidence=[],
  resourceProfiles=[],resourceObservation=null,environment,nowMs,
  selectedSkills=[],userModelPins={},trialEvidence=null,contextBinding,
}){
  if(!rec(task)||!rec(solution)||!Array.isArray(solution.requirements)||
     task.solutionId!==solution.solutionId||!str(task.taskId)||!str(task.solutionId)||
     !Array.isArray(stages)||stages.length===0||stages.length>32||
     !Array.isArray(available)||!Array.isArray(profiles)||!Array.isArray(qualityEvidence)||
     !Array.isArray(resourceProfiles)||!Array.isArray(selectedSkills)||
     !rec(userModelPins)||!rec(environment)||!str(environment.operatingSystem)||
     !integer(nowMs))issue('inputs');
  keys(contextBinding,['ref','digest'],'context_binding');
  if(!str(contextBinding.ref)||!HEX.test(contextBinding.digest??''))issue('context_identity');
  if(resourceProfiles.length>128||Object.keys(userModelPins).length>32)issue('input_size');
  const budget=budgetSnapshot(resourceObservation,nowMs);
  const seen=new Set(),selected=[],results=[],blocked=[];
  for(const stage of stages){
    keys(stage,['stageId','requirementId','step','requiredContextTokens','providerId'],'stage');
    if(!str(stage.stageId)||!str(stage.requirementId)||seen.has(stage.requirementId)||
       !Number.isSafeInteger(stage.requiredContextTokens)||stage.requiredContextTokens<1)
       issue('stage_identity_or_context');
    seen.add(stage.requirementId);
    const requirements=solution.requirements.filter(r=>r.requirementId===stage.requirementId);
    if(requirements.length!==1)issue('stage_requirement_missing_or_duplicated');
    const requirement=requirements[0];
    const scoped={solutionId:solution.solutionId,requirements:[requirement]};
    if(requirement.kind==='model'){
      if(!rec(stage.step)||stage.providerId!==undefined)issue('model_stage_shape');
      const resourceExclusions=[];
      const candidates=available.filter(d=>d.capabilities?.some(c=>c.kind==='model'&&c.capabilityId===requirement.capabilityId));
      const eligible=[];
      for(const provider of candidates){
        const pinned=provider.capabilities.find(c=>c.kind==='model'&&c.capabilityId===requirement.capabilityId)?.modelPin;
        const requirements=resourceProfiles.filter(r=>r.providerId===provider.providerId);
        if(requirements.length>1)issue('resource_profile_duplicate');
        const profile=requirements[0]??null;
        const invalidPin=profile && pinKey(profile.modelPin)!==pinKey(pinned);
        const problem=invalidPin?'RESOURCE_BINDING_CHANGED':memoryReason(profile,budget,stage.requiredContextTokens);
        if(problem){resourceExclusions.push({providerId:provider.providerId,reason:problem});continue;}
        eligible.push(provider);
      }
      const selection=recommendModelForStep({
        solution,requirementId:stage.requirementId,step:stage.step,
        available:eligible,profiles:profiles.filter(p=>eligible.some(x=>x.providerId===p.providerId)),
        qualityEvidence,environment,
        userModelPin:userModelPins[stage.requirementId]??null,trialEvidence,
      });
      const excluded=[...resourceExclusions,...selection.excluded];
      const accepted=selection.selected && selection.decision==='RECOMMENDED_NOT_AUTHORIZED';
      let bound=null;
      if(accepted){
        const d=eligible.find(x=>x.providerId===selection.selected.providerId);
        const matched=resolveRequirements(scoped,[d],trialEvidence);
        if(matched.status!=='SUPPORTED')issue('model_binding_changed');
        bound=matched.selected[0];selected.push(bound);
      }
      const info={stageId:stage.stageId,requirementId:stage.requirementId,kind:'model',
        decision:accepted?'MODEL_PROPOSED_NOT_AUTHORIZED':selection.decision,
        providerId:bound?.providerId??null,
        modelPin:bound?.modelPin??null,
        reasons:selection.selected?.reasons??[],
        quality:selection.selected?.quality??null,
        alternatives:selection.alternatives.map(x=>({providerId:x.providerId,
          quality:x.quality.status,requiresHostApproval:true})),
        excluded,
        uncertainties:selection.uncertainties,
        contextRef:contextBinding.ref,contextDigest:contextBinding.digest,
        resourceObservationRef:budget?.sourceRef??null,
        resourceReservation:false};
      results.push(info);
      if(!accepted)blocked.push({requirementId:stage.requirementId,reason:selection.decision});
    }else if(requirement.kind==='tool'){
      if(stage.step!==undefined)issue('tool_stage_shape');
      const selectedToolProvider=selectedTool(scoped,available,trialEvidence,stage.providerId);
      const bound=selectedToolProvider.selected??null;
      if(bound)selected.push(bound);
      results.push({stageId:stage.stageId,requirementId:stage.requirementId,kind:'tool',
        decision:bound?'TOOL_PROPOSED_NOT_AUTHORIZED':selectedToolProvider.reason,
        providerId:bound?.providerId??null,capabilityId:requirement.capabilityId,
        contextRef:contextBinding.ref,contextDigest:contextBinding.digest,
        resultNotVerified:true,hostAuthorityGranted:false,
        expectedLatencyMs:bound?.latencyMsP50??null});
      if(!bound)blocked.push({requirementId:stage.requirementId,reason:selectedToolProvider.reason});
    }else issue('unsupported_stage_kind');
  }
  let plan=null,skillIssue=null;
  if(blocked.length===0){
    // Do not duplicate SkillRuntime. This existing contract rejects missing
    // capabilities; P01 independently checks instruction digests before use.
    const result={
      contractVersion:CONTRACT_VERSION,solutionId:solution.solutionId,status:'SUPPORTED',selected,
      estimates:{providerFeeUsd:knownSum(selected,'providerFeeUsd'),
        latencyMs:knownSum(selected,'latencyMsP50'),hostComputeCostUsd:null},
    };
    try{plan=buildInvocationPlan(task,selectedSkills,result);}
    catch(e){
      if(!(e instanceof InteropError))throw e;
      skillIssue=e.code+':'+e.message;
      blocked.push({requirementId:null,reason:'SKILL_UNSUPPORTED_OR_UNVERIFIED'});
    }
  }
  const body={schema:STAGE_SELECTION_VERSION,taskId:task.taskId,
    solutionId:solution.solutionId,decision:blocked.length===0?'STAGES_PROPOSED_NOT_AUTHORIZED':'INCOMPATIBLE',
    stages:results,blocked,skillIssue,
    contextBinding:{...contextBinding,transferred:false},
    resources:budget,plan,hostAuthorityGranted:false,
    taskExecuted:false,resultProduced:false,modelSwitchExecuted:false,
    executionAuthority:'P01_ONLY'};
  return {...body,recommendationDigest:digest(body)};
}
