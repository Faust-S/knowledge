import canonicalRegistrations from './domain-result-authority-registrations.json' with {type:'json'};
import {
  assertDomainNativeResultAuthorityBinding,
} from './result-acceptance-authority.mjs';

const BASELINE_ENTRIES = Object.freeze({
  D01: Object.freeze({
    domainId:'D01',
    acceptedNativeResult:'Career/Study/Practice/Calculator/Mind accepted results/evidence',
    resultProducer:'Learn',
    canonicalAuthorityCore:'OWNER_DECISION_REQUIRED',
    preparationStatus:'READY_PRODUCT_LOGIC / OPERATOR_VERIFY',
    persistentNativeResultProven:true,
  }),
  D02: Object.freeze({
    domainId:'D02',
    acceptedNativeResult:'Accepted personal situation/resource/role/project/route/evidence result',
    resultProducer:'Club IWXA',
    canonicalAuthorityCore:'ru.iwxa.club',
    preparationStatus:'READY_PRODUCT_LOGIC / CURRENT_DOMAIN_AUTHORITY_CORRECTED / T0_TO_T2',
    persistentNativeResultProven:true,
  }),
  D03: Object.freeze({
    domainId:'D03',
    acceptedNativeResult:'Accepted calculation/decision snapshot or managerial diagnostic/report/priority',
    resultProducer:'ArtBazy',
    canonicalAuthorityCore:'artbazy',
    preparationStatus:'READY_PRODUCT_LOGIC',
    persistentNativeResultProven:true,
  }),
  D04: Object.freeze({
    domainId:'D04',
    acceptedNativeResult:'Accepted health observation/assessment/plan/protocol/checklist/progress/report',
    resultProducer:'Bazmed',
    canonicalAuthorityCore:'bazmed',
    preparationStatus:'READY_PRODUCT_LOGIC / POLICY_STRICT / MIGRATION_REQUIRED',
    persistentNativeResultProven:true,
  }),
  D05: Object.freeze({
    domainId:'D05',
    acceptedNativeResult:'Approved production order; execution/quality; plan-fact/closure',
    resultProducer:'Cehovod',
    canonicalAuthorityCore:'artbazy',
    preparationStatus:'READY_PRODUCT_LOGIC / NO_5IBS_COMPAT_GAP',
    persistentNativeResultProven:true,
  }),
  D06: Object.freeze({
    domainId:'D06',
    acceptedNativeResult:'Accepted acquisition/configuration/offer/delivery/item/lifecycle decisions',
    resultProducer:'Komplektovod',
    canonicalAuthorityCore:'komplektovod',
    preparationStatus:'READY_PRODUCT_LOGIC / CURRENT_DOMAIN_AUTHORITY_CORRECTED / TECH_MIXED',
    persistentNativeResultProven:true,
  }),
  D07: Object.freeze({
    domainId:'D07',
    acceptedNativeResult:'Accepted brief/proposal-risk/acceptance/ServiceOrder',
    resultProducer:'Uslugovod',
    canonicalAuthorityCore:'artbazy',
    preparationStatus:'READY_PRODUCT_LOGIC / MIGRATION_LARGE',
    persistentNativeResultProven:true,
  }),
  D08: Object.freeze({
    domainId:'D08',
    acceptedNativeResult:'Contractor reference/selection; marketplace launch diagnostic/map/report',
    resultProducer:'MarketOps',
    canonicalAuthorityCore:'artbazy',
    preparationStatus:'READY_PRODUCT_LOGIC',
    persistentNativeResultProven:true,
  }),
  D09: Object.freeze({
    domainId:'D09',
    acceptedNativeResult:'Accepted interactive project/.iwxa; narrow recipient result/event',
    resultProducer:'Hop',
    canonicalAuthorityCore:'club.iwxa',
    preparationStatus:'READY_PRODUCT_LOGIC',
    persistentNativeResultProven:true,
  }),
  D10: Object.freeze({
    domainId:'D10',
    acceptedNativeResult:'Accepted seven-stage launch / diagnostic / calculation / experiment / growth-map result',
    resultProducer:'ArtBazi',
    canonicalAuthorityCore:'ru.artbazi.artbazy-sales',
    preparationStatus:'READY_PRODUCT_LOGIC / OWNER_APPROVED_D10_AUTHORITY / EXECUTABLE_QUALIFIED / MIGRATION_REQUIRED',
    persistentNativeResultProven:true,
  }),
  D11: Object.freeze({
    domainId:'D11',
    acceptedNativeResult:'No accepted corporate Result; persisted preliminary AS-IS/TO-BE, requirements, ToR and brief proposals',
    resultProducer:'Advice Logistics',
    canonicalAuthorityCore:'ru.iwxa.advice-logistics.workspace',
    preparationStatus:'READY_PRODUCT_LOGIC / CURRENT_DOMAIN_AUTHORITY_CORRECTED / PROPOSAL_ONLY',
    persistentNativeResultProven:true,
    nativeResultPhase:'PROPOSAL_ONLY',
    nativeResultAcceptance:'NOT_REQUESTED',
  }),
  D12: Object.freeze({
    domainId:'D12',
    acceptedNativeResult:'Public discovery/reference outcome; persistent private T2 result NOT YET PROVEN',
    resultProducer:'IWXA Main public publication surface',
    canonicalAuthorityCore:'NO_NEW_ROOT_AUTHORITY',
    preparationStatus:'PRODUCT_ROLE_CONFIRMED / T2_USE_CASE_OPEN',
    persistentNativeResultProven:false,
  }),
});

export class DomainResultAuthorityRegistryError extends Error {
  constructor(message, code='DOMAIN_RESULT_AUTHORITY_REGISTRY_ERROR') {
    super(message);
    this.name='DomainResultAuthorityRegistryError';
    this.code=code;
  }
}

// This is canonical source configuration of the existing registry, not intake grants.
// Only an independently reviewed Owner decision may be published into this file.
export function validateFutureDomainAuthorityRegistration(value){
 const r=value,d=r?.humanDecision;
 if(!r||!/^D(?:1[3-9]|[2-9][0-9]|[1-9][0-9]{2,})$/.test(r.domainId)||
    !d||d.decisionSource!=='HUMAN_EXPLICIT'||d.decision!=='APPROVE'||d.domainId!==r.domainId||
    d.canonicalAuthorityCore!==r.canonicalAuthorityCore||d.resultProducer!==r.resultProducer||
    typeof d.decisionId!=='string'||!d.decisionId.trim()||typeof d.decidedBy!=='string'||!d.decidedBy.trim()||Number.isNaN(Date.parse(d.decidedAt))||
    !/^git:Faust-S\/iwxa@[a-f0-9]{40}:.+/.test(d.evidenceRef??'')||
    typeof r.resultProducer!=='string'||!r.resultProducer.trim()||typeof r.acceptedNativeResult!=='string'||!r.acceptedNativeResult.trim()||
    typeof r.canonicalAuthorityCore!=='string'||!r.canonicalAuthorityCore.trim()||['OWNER_DECISION_REQUIRED','NO_NEW_ROOT_AUTHORITY'].includes(r.canonicalAuthorityCore)||
    r.externalAuthorityInherited!==false||r.productionActivation!==false||r.persistentNativeResultProven!==true||
    !/^sha256:[a-f0-9]{64}$/.test(r.canonicalSourceRef??'')||d.canonicalSourceRef!==r.canonicalSourceRef){
  throw new DomainResultAuthorityRegistryError('explicit canonical Owner authority registration required','DOMAIN_AUTHORITY_REGISTRATION_INVALID');
 }
 return Object.freeze({domainId:r.domainId,resultProducer:r.resultProducer,acceptedNativeResult:r.acceptedNativeResult,canonicalAuthorityCore:r.canonicalAuthorityCore,persistentNativeResultProven:true,preparationStatus:'OWNER_REGISTERED_CANONICAL_AUTHORITY',ownerDecisionId:d.decisionId,authorityEvidence:d.evidenceRef,canonicalSourceRef:r.canonicalSourceRef});
}
if(canonicalRegistrations.schema!=='IWXA_T2_C3_DOMAIN_AUTHORITY_REGISTRATIONS_V1'||!Array.isArray(canonicalRegistrations.registrations))throw new DomainResultAuthorityRegistryError('invalid canonical authority registrations');
const registeredEntries={};
for(const r of canonicalRegistrations.registrations){const entry=validateFutureDomainAuthorityRegistration(r);if(Object.hasOwn(BASELINE_ENTRIES,entry.domainId)||Object.hasOwn(registeredEntries,entry.domainId))throw new DomainResultAuthorityRegistryError('duplicate canonical domain registration');registeredEntries[entry.domainId]=entry;}
const ENTRIES=Object.freeze({...BASELINE_ENTRIES,...registeredEntries});

export const DOMAIN_RESULT_AUTHORITY_REGISTRY = Object.freeze({
  schema:'IWXA_T2_C3_DOMAIN_RESULT_AUTHORITY_REGISTRY_V1',
  authoritySource:'IWXA_T2_CURRENT_DOMAIN_AUTHORITY_REGISTRY / PRODUCT_LOGIC_BASELINE_WITH_GOVERNANCE_CORRECTIONS',
  authoritySourceRole:'CURRENT_EXECUTABLE_REGISTRY',
  productLogicSha256:'6db3cff40f3494218f4162cd78367fa16659e94aee22a1ed02fddbb7b552e1b5',
  matrixSha256:'44f9f6d89bd0ae70c6a8b99d0e4f24fe539ad16454b092138fe0ff4c4cd8a273',
  baselineAuthorityEvidence:'product/C3_DOMAIN_RESULT_AUTHORITY_REGISTRY_2026-09-18.json',
  corrections:Object.freeze([
    Object.freeze({
      correctionId:'T2-COMMON-DEFECT-D02-STALE-AUTHORITY-REGISTRY',
      domainId:'D02',
      previousCanonicalAuthorityCore:'club.iwxa',
      canonicalAuthorityCore:'ru.iwxa.club',
      externalAuthorityInherited:false,
      decisionAuthority:'EXPLICIT_PERSONAL_WORKSPACE_USER',
      evidence:'product/D02_AUTHORITY_REGISTRY_CORRECTION_2026-10-08.json',
    }),
    Object.freeze({
      correctionId:'T2-COMMON-DEFECT-D06-STALE-AUTHORITY-REGISTRY',
      domainId:'D06',
      previousCanonicalAuthorityCore:'artbazy',
      canonicalAuthorityCore:'komplektovod',
      externalAuthorityInherited:false,
      decisionAuthority:'EXPLICIT_WORKSPACE_ACTOR_PERSON_OR_ORGANIZATION',
      evidence:'product/D06_AUTHORITY_REGISTRY_CORRECTION_2026-10-07.json',
    }),
    Object.freeze({
      correctionId:'T2-COMMON-DEFECT-D10-STALE-AUTHORITY-REGISTRY',
      domainId:'D10',
      previousCanonicalAuthorityCore:'OWNER_DECISION_REQUIRED',
      canonicalAuthorityCore:'ru.artbazi.artbazy-sales',
      externalAuthorityInherited:false,
      decisionAuthority:'EXPLICIT_AUTHORIZED_WORKSPACE_ACTOR_PERSON_OR_ORGANIZATION_WHERE_DECISION_REQUIRED',
      ownerDecisionId:'D10-ARTBAZI-CANONICAL-AUTHORITY-CORE-2026-10-07',
      evidence:'product/D10_AUTHORITY_REGISTRY_CORRECTION_2026-10-07.json',
    }),
    Object.freeze({
      correctionId:'T2-COMMON-DEFECT-D11-PROPOSAL-AUTHORITY-ACCEPTANCE',
      domainId:'D11',
      previousCanonicalAuthorityCore:'artbazy',
      canonicalAuthorityCore:'ru.iwxa.advice-logistics.workspace',
      externalAuthorityInherited:false,
      decisionAuthority:'EXPLICIT_WORKSPACE_ACTOR_SCOPED_SAVE_NOT_HUMAN_ACCEPTANCE',
      nativeResultPhase:'PROPOSAL_ONLY',
      nativeResultAcceptance:'NOT_REQUESTED',
      evidence:'product/D11_AUTHORITY_REGISTRY_CORRECTION_2026-10-22.json',
    }),
  ]),
  entries:ENTRIES,
});

export function domainResultAuthority(domainId) {
  const id=typeof domainId === 'string' ? domainId.trim().toUpperCase() : '';
  const entry=ENTRIES[id];
  if(!entry){
    throw new DomainResultAuthorityRegistryError(
      `unknown T2 domain ${String(domainId)}`,
      'UNKNOWN_T2_DOMAIN_RESULT_AUTHORITY',
    );
  }
  return entry;
}

export function domainResultAuthorityReadiness(domainId) {
  const id=typeof domainId==='string'?domainId.trim().toUpperCase():'';
  // A future domain is not automatically a source-truth authority.
  // Domain Run can perform scoped engineering, but binding and persistent
  // writes remain forbidden until canonical registration by the owner.
  if(/^D(?:0[1-9]|[1-9][0-9]+)$/.test(id)&&!Object.hasOwn(ENTRIES,id)){
    return Object.freeze({
      domainId:id,
      status:'OWNER_DECISION_REQUIRED',
      sourceTruthBindingAllowed:false,
      reason:'DOMAIN_AUTHORITY_REGISTRATION_REQUIRED',
    });
  }
  const entry=domainResultAuthority(id);
  if(entry.canonicalAuthorityCore.startsWith('OWNER_DECISION_REQUIRED')){
    return Object.freeze({
      domainId:entry.domainId,
      status:'OWNER_DECISION_REQUIRED',
      sourceTruthBindingAllowed:false,
      reason:'CANONICAL_AUTHORITY_CORE_UNRESOLVED',
    });
  }
  if(entry.persistentNativeResultProven !== true){
    return Object.freeze({
      domainId:entry.domainId,
      status:'NATIVE_RESULT_USE_CASE_NOT_PROVEN',
      sourceTruthBindingAllowed:false,
      reason:'PERSISTENT_NATIVE_T2_RESULT_NOT_PROVEN',
    });
  }
  return Object.freeze({
    domainId:entry.domainId,
    status:'AUTHORITY_BOUND_PRODUCT_LOGIC',
    sourceTruthBindingAllowed:true,
    reason:null,
  });
}

export function bindDomainNativeResultAuthority(domainId, input) {
  const readiness=domainResultAuthorityReadiness(domainId);
  if(!readiness.sourceTruthBindingAllowed){
    throw new DomainResultAuthorityRegistryError(
      `${readiness.domainId} cannot bind source-truth Result yet: ${readiness.reason}`,
      readiness.status,
    );
  }
  const entry=domainResultAuthority(domainId);
  if(input?.resultProducer !== entry.resultProducer){
    throw new DomainResultAuthorityRegistryError(
      `${entry.domainId} Result Producer must be ${entry.resultProducer}`,
      'DOMAIN_RESULT_PRODUCER_MISMATCH',
    );
  }
  if(input?.canonicalAuthorityCore !== entry.canonicalAuthorityCore){
    throw new DomainResultAuthorityRegistryError(
      `${entry.domainId} Canonical Authority Core must be ${entry.canonicalAuthorityCore}`,
      'DOMAIN_RESULT_AUTHORITY_MISMATCH',
    );
  }
  return assertDomainNativeResultAuthorityBinding({
    ...input,
    domainId:entry.domainId,
    acceptedNativeResultRef:input?.acceptedNativeResultRef ?? `product-logic:${entry.domainId}:accepted-native-result`,
  });
}
