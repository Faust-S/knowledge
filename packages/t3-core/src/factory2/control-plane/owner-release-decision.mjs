import {plainDataSnapshot} from '../../foundation/plain-data-snapshot.mjs';
import {computeFactory2ReleaseSubjectSha256} from './release-subject.mjs';

export class Factory2OwnerDecisionError extends Error {
  constructor(message,code='FACTORY2_OWNER_DECISION_ERROR'){super(message);this.name='Factory2OwnerDecisionError';this.code=code;}
}
const DECISIONS=new Set(['APPROVE','REJECT','NOT_DECIDED']);

function record(value,code){
  const out=plainDataSnapshot(value,{errorFactory:(message)=>new Factory2OwnerDecisionError(message,code)});
  if(!out||typeof out!=='object'||Array.isArray(out)) throw new Factory2OwnerDecisionError('record required',code);
  return out;
}
function token(value,label){
  if(typeof value!=='string'||!value.trim()) throw new Factory2OwnerDecisionError(`${label} required`,'FACTORY2_OWNER_DECISION_FIELD_REQUIRED');
  return value.trim();
}
function decision(value,label){
  if(!DECISIONS.has(value)) throw new Factory2OwnerDecisionError(`invalid ${label}`,'FACTORY2_OWNER_DECISION_VALUE_INVALID');
  return value;
}

export function validateFactory2OwnerReleaseDecision({technicalReadiness,decision:decisionValue}){
  const technical=record(technicalReadiness,'FACTORY2_OWNER_DECISION_TECHNICAL_INVALID');
  if(technical.schema!=='IWXA_T2_FACTORY2_RELEASE_CONTROL_TECHNICAL_READINESS_V1'||
     technical.status!=='TECHNICAL_SUBJECT_BOUND_OWNER_DECISIONS_PENDING'||
     technical.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||
     typeof technical.subjectSha256!=='string'||!/^[0-9a-f]{64}$/.test(technical.subjectSha256)){
    throw new Factory2OwnerDecisionError('exact technical release subject required','FACTORY2_OWNER_DECISION_TECHNICAL_INVALID');
  }
  const subject=technical.subject;
  if(!subject||typeof subject!=='object'||Array.isArray(subject)||
     typeof subject.sourceCommitSha!=='string'||!/^[0-9a-f]{40}$/.test(subject.sourceCommitSha)||
     typeof subject.artifactSha256!=='string'||!/^[0-9a-f]{64}$/.test(subject.artifactSha256)||
     !Number.isSafeInteger(subject.artifactBytes)||subject.artifactBytes<1){
    throw new Factory2OwnerDecisionError('exact technical subject payload required','FACTORY2_OWNER_DECISION_TECHNICAL_INVALID');
  }
  if(computeFactory2ReleaseSubjectSha256(subject)!==technical.subjectSha256){
    throw new Factory2OwnerDecisionError('technical release subject digest mismatch','FACTORY2_OWNER_DECISION_TECHNICAL_SUBJECT_DIGEST_INVALID');
  }
  const x=record(decisionValue,'FACTORY2_OWNER_DECISION_INVALID');
  if(x.schema!=='IWXA_T2_FACTORY2_OWNER_RELEASE_DECISION_V1'||x.factoryId!=='IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2'||x.generation!==2){
    throw new Factory2OwnerDecisionError('Factory 2 Owner decision identity mismatch','FACTORY2_OWNER_DECISION_IDENTITY_MISMATCH');
  }
  if(x.decisionSource!=='OWNER_EXPLICIT') throw new Factory2OwnerDecisionError('decision source must be explicit Owner input','FACTORY2_OWNER_DECISION_SOURCE_INVALID');
  token(x.decisionId,'decisionId'); token(x.decidedBy,'decidedBy'); token(x.decidedAt,'decidedAt');
  if(Number.isNaN(Date.parse(x.decidedAt))) throw new Factory2OwnerDecisionError('decidedAt must be ISO date-time','FACTORY2_OWNER_DECISION_DATE_INVALID');
  if(x.subjectSha256!==technical.subjectSha256||x.sourceCommitSha!==technical.subject?.sourceCommitSha||x.artifactSha256!==technical.subject?.artifactSha256){
    throw new Factory2OwnerDecisionError('Owner decision subject does not match exact technical release subject','FACTORY2_OWNER_DECISION_SUBJECT_MISMATCH');
  }
  const d={
    commonReleaseLock:decision(x.decisions?.commonReleaseLock,'commonReleaseLock'),
    commonFreeze:decision(x.decisions?.commonFreeze,'commonFreeze'),
    p6:decision(x.decisions?.p6,'p6'),
    p7:decision(x.decisions?.p7,'p7'),
    factoryAcceptance:decision(x.decisions?.factoryAcceptance,'factoryAcceptance'),
  };
  if(d.commonFreeze==='APPROVE'&&d.commonReleaseLock!=='APPROVE') throw new Factory2OwnerDecisionError('Common Freeze approval requires Common Release Lock approval','FACTORY2_OWNER_DECISION_DEPENDENCY_INVALID');
  if(d.p6==='APPROVE'&&d.commonFreeze!=='APPROVE') throw new Factory2OwnerDecisionError('P6 approval requires Common Freeze approval','FACTORY2_OWNER_DECISION_DEPENDENCY_INVALID');
  if(d.p7==='APPROVE'&&d.p6!=='APPROVE') throw new Factory2OwnerDecisionError('P7 approval requires P6 approval','FACTORY2_OWNER_DECISION_DEPENDENCY_INVALID');
  if(d.factoryAcceptance==='APPROVE'&&d.p7!=='APPROVE') throw new Factory2OwnerDecisionError('Factory acceptance approval requires P7 approval','FACTORY2_OWNER_DECISION_DEPENDENCY_INVALID');
  const readiness=technical.releaseControl??{};
  for(const [decisionKey,readinessKey] of [
    ['commonReleaseLock','commonReleaseLockTechnicalSubjectReady'],
    ['commonFreeze','commonFreezeTechnicalSubjectReady'],
    ['p6','p6TechnicalSubjectReady'],
    ['p7','p7TechnicalSubjectReady'],
  ]){
    if(d[decisionKey]==='APPROVE'&&readiness[readinessKey]!==true){
      throw new Factory2OwnerDecisionError(`${decisionKey} cannot be approved before its technical subject is ready`,'FACTORY2_OWNER_DECISION_TECHNICAL_READINESS_REQUIRED');
    }
  }
  if(d.factoryAcceptance==='APPROVE'&&[
    'commonReleaseLockTechnicalSubjectReady','commonFreezeTechnicalSubjectReady','p6TechnicalSubjectReady','p7TechnicalSubjectReady'
  ].some((key)=>readiness[key]!==true)){
    throw new Factory2OwnerDecisionError('Factory acceptance requires the complete technical release-control graph','FACTORY2_OWNER_DECISION_TECHNICAL_READINESS_REQUIRED');
  }
  const technicalFlags=technical.technicalReadiness??{};
  if(d.factoryAcceptance==='APPROVE'&&[
    'exactDistributionIdentityAvailable','exactProductSealSetAvailable','currentExecutableVerificationPass',
    'runtimeContractSnapshotPass','neutralAcceptanceExecuted','deterministicStagingVerified',
    'deterministicZipEmitted','deterministicZipRebuildVerified','selfContainedFreshExtractPass','t25Transfer44Of44'
  ].some((key)=>technicalFlags[key]!==true)){
    throw new Factory2OwnerDecisionError('Factory acceptance requires complete strict technical readiness','FACTORY2_OWNER_DECISION_TECHNICAL_READINESS_REQUIRED');
  }
  if(x.productionActivation!==false) throw new Factory2OwnerDecisionError('Factory release decision must not authorize production activation','FACTORY2_OWNER_DECISION_PRODUCTION_FORBIDDEN');
  return Object.freeze({...x,decisions:Object.freeze(d)});
}

export function deriveFactory2ReleaseDecisionState({technicalReadiness,decision}){
  const x=validateFactory2OwnerReleaseDecision({technicalReadiness,decision});
  const d=x.decisions;
  const approved=(key)=>d[key]==='APPROVE';
  const rejected=Object.entries(d).filter(([,value])=>value==='REJECT').map(([key])=>key);
  const pending=Object.entries(d).filter(([,value])=>value==='NOT_DECIDED').map(([key])=>key);
  const finalApproved=approved('factoryAcceptance');
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_RELEASE_DECISION_STATE_V1',
    status:finalApproved?'FACTORY2_ACCEPTED_BY_EXPLICIT_OWNER_DECISION':rejected.length?'FACTORY2_OWNER_REJECTED_OR_BLOCKED':'FACTORY2_OWNER_DECISIONS_PENDING',
    factoryId:'IWXA_T2_FULL_UNIVERSAL_DOMAIN_FACTORY_2',
    generation:2,
    subjectSha256:technicalReadiness.subjectSha256,
    sourceCommitSha:technicalReadiness.subject.sourceCommitSha,
    artifactSha256:technicalReadiness.subject.artifactSha256,
    decisionId:x.decisionId,
    decidedBy:x.decidedBy,
    decidedAt:x.decidedAt,
    explicitOwnerDecision:true,
    factoryAcceptanceDecision:d.factoryAcceptance,
    commonReleaseLockIssued:approved('commonReleaseLock'),
    commonFreezeIssued:approved('commonFreeze'),
    p6Authorized:approved('p6'),
    p7Authorized:approved('p7'),
    factoryAcceptanceGranted:finalApproved,
    ownerApprovalGranted:finalApproved,
    rejected:Object.freeze(rejected),
    pending:Object.freeze(pending),
    productionActivation:false,
    realDomainRunAuthorized:finalApproved,
  });
}
