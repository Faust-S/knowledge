import {plainDataSnapshot} from '../../../../foundation/plain-data-snapshot.mjs';

const COMMON_PROJECT_PROCESS_OWNER = 'iwxa.project-process.owner';
const UNRESOLVED_AUTHORITY = 'OWNER_DECISION_REQUIRED';
const NO_NEW_ROOT_AUTHORITY = 'NO_NEW_ROOT_AUTHORITY';

export class ResultAcceptanceAuthorityError extends Error {
  constructor(message, code = 'RESULT_ACCEPTANCE_AUTHORITY_ERROR') {
    super(message);
    this.name = 'ResultAcceptanceAuthorityError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResultAcceptanceAuthorityError(
      `${label} must be a non-empty string`,
      'INVALID_RESULT_AUTHORITY_BINDING',
    );
  }
  return value.trim();
}

function requireUniqueTexts(values, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new ResultAcceptanceAuthorityError(
      `${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`,
      'INVALID_RESULT_AUTHORITY_BINDING',
    );
  }
  const normalized=values.map((value) => requireText(value,label));
  if(normalized.some((value)=>/^(?:NONE_PROVEN|UNPROVEN|UNBOUND)(?:$|[_:\s])/i.test(value))){
    throw new ResultAcceptanceAuthorityError('unproven observation is not an authority reference','INVALID_RESULT_AUTHORITY_BINDING');
  }
  if(new Set(normalized).size !== normalized.length){
    throw new ResultAcceptanceAuthorityError(
      `${label} must not contain duplicates`,
      'INVALID_RESULT_AUTHORITY_BINDING',
    );
  }
  return Object.freeze(normalized);
}

function stableIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResultAcceptanceAuthorityError(
      'stableIdentity must be an object',
      'INVALID_RESULT_AUTHORITY_BINDING',
    );
  }
  return Object.freeze({
    workspace_id: requireText(value.workspace_id, 'stableIdentity.workspace_id'),
    object_id: requireText(value.object_id, 'stableIdentity.object_id'),
    schema_id: requireText(value.schema_id, 'stableIdentity.schema_id'),
    schema_version: requireText(value.schema_version, 'stableIdentity.schema_version'),
    created_by_service: requireText(value.created_by_service, 'stableIdentity.created_by_service'),
    updated_by_service: requireText(value.updated_by_service, 'stableIdentity.updated_by_service'),
  });
}

export const RESULT_ACCEPTANCE_AUTHORITY = Object.freeze({
  authoritySource: 'IWXA_T2_PRODUCT_LOGIC_0.3.7',
  authorityPackageSha256: '6db3cff40f3494218f4162cd78367fa16659e94aee22a1ed02fddbb7b552e1b5',
  crossDomainProcessMatrixSha256: '44f9f6d89bd0ae70c6a8b99d0e4f24fe539ad16454b092138fe0ff4c4cd8a273',
  commonResultProjection: Object.freeze({
    sourceTruth: false,
    writable: false,
    role: 'DOMAIN_NATIVE_RESULT_REFERENCE_PROJECTION',
  }),
  genericAcceptance: Object.freeze({
    sourceTruth: false,
    writable: false,
    derived: true,
    role: 'CRITERIA_EVIDENCE_PROJECTION_ONLY',
  }),
  sourceTruthRule: Object.freeze({
    ownership: 'DOMAIN_BOUND',
    resultProducerSeparatedFromCanonicalAuthorityCore: true,
    commonProjectProcessOwnerMayProduceResult: false,
    commonProjectProcessOwnerMayWriteAcceptance: false,
    unknownAuthorityState: UNRESOLVED_AUTHORITY,
    noNewRootAuthoritySentinel: NO_NEW_ROOT_AUTHORITY,
  }),
});

export function assertDomainNativeResultAuthorityBinding(input) {
  input=plainDataSnapshot(input,{errorFactory:(message)=>new ResultAcceptanceAuthorityError(message,'INVALID_RESULT_AUTHORITY_BINDING')});
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ResultAcceptanceAuthorityError(
      'domain-native Result authority binding must be an object',
      'INVALID_RESULT_AUTHORITY_BINDING',
    );
  }

  const domainId=requireText(input.domainId,'domainId');
  const acceptedNativeResultRef=requireText(input.acceptedNativeResultRef,'acceptedNativeResultRef');
  const resultProducer=requireText(input.resultProducer,'resultProducer');
  const canonicalAuthorityCore=requireText(input.canonicalAuthorityCore,'canonicalAuthorityCore');

  if(resultProducer === COMMON_PROJECT_PROCESS_OWNER){
    throw new ResultAcceptanceAuthorityError(
      'common Project/Process owner cannot become a domain Result Producer',
      'COMMON_RESULT_PRODUCER_FORBIDDEN',
    );
  }
  if(canonicalAuthorityCore === COMMON_PROJECT_PROCESS_OWNER){
    throw new ResultAcceptanceAuthorityError(
      'common Project/Process owner cannot become Canonical Authority Core',
      'COMMON_RESULT_AUTHORITY_FORBIDDEN',
    );
  }
  if(canonicalAuthorityCore === NO_NEW_ROOT_AUTHORITY || /^(?:NONE_PROVEN|UNPROVEN|UNBOUND)(?:$|[_:\s])/i.test(canonicalAuthorityCore)){
    throw new ResultAcceptanceAuthorityError('no resolved Canonical Authority Core','RESULT_AUTHORITY_CORE_NOT_RESOLVED');
  }
  if(canonicalAuthorityCore === UNRESOLVED_AUTHORITY){
    throw new ResultAcceptanceAuthorityError(
      'unresolved Canonical Authority Core must remain OWNER_DECISION_REQUIRED',
      'RESULT_AUTHORITY_OWNER_DECISION_REQUIRED',
    );
  }

  const acceptanceCriteriaRefs=requireUniqueTexts(
    input.acceptanceCriteriaRefs,
    'acceptanceCriteriaRefs',
    {nonEmpty:true},
  );
  const provenanceRefs=requireUniqueTexts(input.provenanceRefs,'provenanceRefs',{nonEmpty:true});
  const identity=stableIdentity(input.stableIdentity);
  if(identity.updated_by_service===COMMON_PROJECT_PROCESS_OWNER){
    throw new ResultAcceptanceAuthorityError('common Project/Process cannot update native Results','COMMON_RESULT_WRITER_FORBIDDEN');
  }

  if(identity.created_by_service !== resultProducer){
    throw new ResultAcceptanceAuthorityError(
      'stable identity created_by_service must identify the Result Producer',
      'RESULT_PRODUCER_IDENTITY_MISMATCH',
    );
  }

  return Object.freeze({
    schema:'IWXA_T2_C3_DOMAIN_NATIVE_RESULT_AUTHORITY_BINDING_V1',
    sourceTruthBinding:true,
    domainId,
    acceptedNativeResultRef,
    acceptanceCriteriaRefs,
    resultProducer,
    canonicalAuthorityCore,
    stableIdentity:identity,
    provenanceRefs,
    exchangeEligibility:input.exchangeEligibility == null
      ? null
      : requireText(input.exchangeEligibility,'exchangeEligibility'),
    outboundProjectionRef:input.outboundProjectionRef == null
      ? null
      : requireText(input.outboundProjectionRef,'outboundProjectionRef'),
    sourceRetainedContextRef:input.sourceRetainedContextRef == null
      ? null
      : requireText(input.sourceRetainedContextRef,'sourceRetainedContextRef'),
  });
}

export function commonResultAcceptanceWriteAuthority() {
  return Object.freeze({
    result:false,
    acceptance:false,
    ownerId:COMMON_PROJECT_PROCESS_OWNER,
    reason:'RESULT_AND_ACCEPTANCE_SOURCE_TRUTH_ARE_DOMAIN_BOUND',
  });
}
