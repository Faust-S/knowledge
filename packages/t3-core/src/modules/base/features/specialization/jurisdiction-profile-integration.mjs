export class JurisdictionProfileIntegrationError extends Error {
  constructor(message, code = 'JURISDICTION_PROFILE_INTEGRATION_ERROR') {
    super(message);
    this.name = 'JurisdictionProfileIntegrationError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new JurisdictionProfileIntegrationError(
      `${label} must be a non-empty string`,
      'INVALID_JURISDICTION_PROFILE_INTEGRATION_FIELD',
    );
  }
  return value.trim();
}

function requireApi(value, methods, label) {
  if (!value || typeof value !== 'object') {
    throw new JurisdictionProfileIntegrationError(
      `${label} is required`,
      'INVALID_JURISDICTION_PROFILE_INTEGRATION_API',
    );
  }
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new JurisdictionProfileIntegrationError(
        `${label} must provide ${method}()`,
        'INVALID_JURISDICTION_PROFILE_INTEGRATION_API',
      );
    }
  }
  return value;
}

export function qualifyJurisdictionSourceProfileIntegration({
  specializationIndex,
  profileRegistry,
  profileId,
} = {}) {
  const index=requireApi(
    specializationIndex,
    ['jurisdiction'],
    'specializationIndex',
  );
  const registry=requireApi(
    profileRegistry,
    ['profile','specializationDescriptor'],
    'profileRegistry',
  );
  const id=requireText(profileId,'profileId');
  const profile=registry.profile(id);

  let jurisdiction;
  try {
    jurisdiction=index.jurisdiction(profile.jurisdictionId);
  } catch {
    throw new JurisdictionProfileIntegrationError(
      `profile ${profile.id} references an unregistered jurisdiction: ${profile.jurisdictionId}`,
      'PROFILE_JURISDICTION_NOT_REGISTERED',
    );
  }

  const descriptor=registry.specializationDescriptor(profile.id);
  const exactDescriptor=descriptor?.specializationId===profile.id
    && Array.isArray(descriptor?.jurisdictionIds)
    && descriptor.jurisdictionIds.length===1
    && descriptor.jurisdictionIds[0]===jurisdiction.id
    && descriptor.inferredParentApplicability===false;

  if(!exactDescriptor){
    throw new JurisdictionProfileIntegrationError(
      `profile ${profile.id} specialization descriptor is not exact`,
      'PROFILE_SPECIALIZATION_DESCRIPTOR_MISMATCH',
    );
  }

  return Object.freeze({
    schema:'IWXA_T2_JURISDICTION_SOURCE_PROFILE_INTEGRATION_V1',
    status:'PASS',
    profileId:profile.id,
    jurisdictionId:jurisdiction.id,
    countryCode:profile.countryCode,
    explicitJurisdiction:true,
    inferredParentApplicability:false,
    authorityRoot:false,
    writeAuthorized:false,
  });
}

export function qualifySourceProfileBinding({
  specializationIndex,
  profileRegistry,
  sourceId,
  profileId,
  effectiveAt,
  knownAt,
} = {}) {
  const integration=qualifyJurisdictionSourceProfileIntegration({
    specializationIndex,
    profileRegistry,
    profileId,
  });
  const index=requireApi(
    specializationIndex,
    ['resolveSource'],
    'specializationIndex',
  );
  const source=requireText(sourceId,'sourceId');
  const resolved=index.resolveSource({sourceId:source,effectiveAt,knownAt});
  const matches=resolved.candidates.filter((candidate)=>
    candidate.specializationId===integration.profileId
    && candidate.jurisdictionIds.includes(integration.jurisdictionId)
  );
  const reasons=[];
  if(matches.length===0) reasons.push('PROFILE_NOT_EXPLICITLY_BOUND_TO_SOURCE');
  if(matches.length>1) reasons.push('MULTIPLE_CURRENT_PROFILE_BINDINGS');

  return Object.freeze({
    schema:'IWXA_T2_SOURCE_PROFILE_BINDING_QUALIFICATION_V1',
    status:reasons.length===0?'PASS':'NOT_QUALIFIED',
    qualified:reasons.length===0,
    sourceId:source,
    profileId:integration.profileId,
    jurisdictionId:integration.jurisdictionId,
    matchingBindingIds:Object.freeze(matches.map((binding)=>binding.id).sort()),
    currentCandidateCount:resolved.candidateCount,
    reasons:Object.freeze(reasons),
    selectedByPriority:false,
    inferredParentApplicability:false,
    authorityRoot:false,
    writeAuthorized:false,
  });
}
