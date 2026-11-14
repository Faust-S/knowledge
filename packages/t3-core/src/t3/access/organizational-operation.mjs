// Original signed T3 organization enrolment/operation evaluator adopted
// into the single executable Access owner in knowledge. Reuses original
// T2 Kernel-persisted signed AccessRegistry via a trusted, branded port,
// instead of constructing a second IAM or admitting caller-supplied state.
import { createPublicKey, verify } from 'node:crypto';
import { isOriginalKernelRegistryStatePort } from './original-kernel-registry-state.mjs';
import { canonical, copy, digest, evaluate, fields, identifier, insist, timestamp, verifiedChain } from './core.mjs';
import { selectContextCandidate, validateProductContract } from './product-contracts.mjs';

// Non-production, explicit-operation binding to the existing T3 Access evaluator.
// No organization root, data root, key or status is provisioned by this adapter.
export const ORG_ENROLLMENT_SCHEMA = 'IWXA_T3_ORGANIZATION_ENROLLMENT/1';
export const ORG_ENROLLMENT_CLAIMS = 'IWXA_T3_ORGANIZATION_ENROLLMENT_CLAIMS/1';
export const ORG_OPERATION_SCHEMA = 'IWXA_T3_ORGANIZATION_OPERATION/1';
const prefix = 'IWXA-T3-ORG-ENROLLMENT-V1\0';
const requiredClaims = ['schema','organizationId','realmId','issuerAuthorityId','personId','workspaceId',
  'membershipId','credentialId','credentialPublicKeyRef','grantId','signedGrantDigest',
  'organizationDataRootId','membershipEpoch','issuedAt','notBefore','expiresAt'];
const knownRightClasses = Object.freeze(['DATA','ACTION','ACCEPTANCE','ADMINISTRATION']);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameIds = (left,right) => Array.isArray(left) && Array.isArray(right) &&
  left.length===right.length && new Set(left).size===left.length &&
  left.every(x=>right.includes(x));

export function validateOrganizationEnrollmentClaims(input) {
  const p=copy(input);
  fields(p,requiredClaims);
  insist(p.schema===ORG_ENROLLMENT_CLAIMS,'ORG_ENROLLMENT_SCHEMA_INVALID');
  for(const id of requiredClaims.slice(1,11)) identifier(p[id]);
  identifier(p.organizationDataRootId);
  insist(hex(p.signedGrantDigest),'ORG_ENROLLMENT_GRANT_DIGEST_INVALID');
  insist(Number.isSafeInteger(p.membershipEpoch)&&p.membershipEpoch>=0,'ORG_ENROLLMENT_EPOCH_INVALID');
  const issued=timestamp(p.issuedAt),start=timestamp(p.notBefore),end=timestamp(p.expiresAt);
  insist(issued<=start&&start<end,'ORG_ENROLLMENT_INTERVAL_INVALID');
  return p;
}
const enrollmentMessage = record => Buffer.from(prefix+canonical({
  schema:record.schema,keyId:record.keyId,payload:record.payload
}),'utf8');

// For a trusted Admin issuer host only. Its existing signer stays outside every record.
export function signOrganizationEnrollment(claims,issuerSigner) {
  const payload=validateOrganizationEnrollmentClaims(claims);
  insist(issuerSigner&&typeof issuerSigner.sign==='function','ORG_ISSUER_SIGNER_REQUIRED');
  const record={schema:ORG_ENROLLMENT_SCHEMA,keyId:identifier(issuerSigner.keyId),payload};
  const signature=issuerSigner.sign(enrollmentMessage(record));
  insist(Buffer.isBuffer(signature)&&signature.length===64,'ORG_ENROLLMENT_SIGNATURE_INVALID');
  return {...record,signature:signature.toString('base64url')};
}
export function verifyOrganizationEnrollment(input,state,organization,now) {
  const record=copy(input);
  fields(record,['schema','keyId','payload','signature']);
  insist(record.schema===ORG_ENROLLMENT_SCHEMA,'ORG_ENROLLMENT_SCHEMA_INVALID');
  identifier(record.keyId);
  const payload=validateOrganizationEnrollmentClaims(record.payload);
  insist(typeof record.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(record.signature),
    'ORG_ENROLLMENT_SIGNATURE_FORMAT');
  const signature=Buffer.from(record.signature,'base64url');
  insist(signature.length===64&&signature.toString('base64url')===record.signature,
    'ORG_ENROLLMENT_SIGNATURE_FORMAT');
  const authority=state.policy?.authorities?.[organization.issuerAuthorityId];
  const key=state.policy?.keys?.[record.keyId];
  insist(authority&&key&&authority.issuerKeys.includes(record.keyId),'ORG_ISSUER_NOT_TRUSTED');
  insist(key.uses.includes('GRANT')&&key.status==='ACTIVE'&&
    key.environment===state.policy.environment,'ORG_ISSUER_KEY_UNAVAILABLE');
  insist(timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt),
    'ORG_ISSUER_KEY_EXPIRED');
  insist(payload.organizationId===organization.organizationId &&
    payload.realmId===organization.realmId &&
    payload.issuerAuthorityId===organization.issuerAuthorityId &&
    payload.organizationDataRootId===organization.organizationDataRootId &&
    payload.membershipEpoch===organization.membershipEpoch,'ORG_ENROLLMENT_AUTHORITY_MISMATCH');
  insist(timestamp(payload.issuedAt)<=now&&timestamp(payload.notBefore)<=now&&
    now<timestamp(payload.expiresAt),'ORG_ENROLLMENT_NOT_CURRENT');
  insist(timestamp(payload.expiresAt)-timestamp(payload.notBefore)<=authority.maxTtlSeconds*1000,
    'ORG_ENROLLMENT_EXCEEDS_ISSUER_CEILING');
  insist(createPublicKey(key.publicKey).asymmetricKeyType==='ed25519' &&
    verify(null,enrollmentMessage(record),createPublicKey(key.publicKey),signature),
    'ORG_ENROLLMENT_SIGNATURE_INVALID');
  return payload;
}


// A trusted organizational issuer may link a distinct agent key and a
// narrowed signed GRANT to an existing human staff membership. This is a
// versioned enrolment of the ORIGINAL organizational Access owner, not a
// second IAM, issuer, signer or Store. The issuer key never goes to the agent.
export const ORG_AGENT_ENROLLMENT_SCHEMA = 'IWXA_T3_ORGANIZATION_AGENT_ENROLLMENT/1';
export const ORG_AGENT_ENROLLMENT_CLAIMS = 'IWXA_T3_ORGANIZATION_AGENT_ENROLLMENT_CLAIMS/1';
const agentPrefix = 'IWXA-T3-ORG-AGENT-ENROLLMENT-V1\0';
const agentClaimFields = ['schema','organizationId','realmId','issuerAuthorityId',
  'responsiblePersonId','workspaceId','membershipId','rootGrantId','agentId',
  'agentCredentialPublicKeyRef','delegatedGrantId','signedDelegatedGrantDigest',
  'membershipEpoch','issuedAt','notBefore','expiresAt'];
export function validateOrganizationAgentEnrollmentClaims(input) {
  const p=copy(input);
  fields(p,agentClaimFields);
  insist(p.schema===ORG_AGENT_ENROLLMENT_CLAIMS,'ORG_AGENT_ENROLLMENT_SCHEMA_INVALID');
  for(const k of ['organizationId','realmId','issuerAuthorityId','responsiblePersonId',
    'workspaceId','membershipId','rootGrantId','agentId',
    'agentCredentialPublicKeyRef','delegatedGrantId']) identifier(p[k]);
  insist(hex(p.signedDelegatedGrantDigest),'ORG_AGENT_ENROLLMENT_GRANT_DIGEST_INVALID');
  insist(Number.isSafeInteger(p.membershipEpoch)&&p.membershipEpoch>=0,
    'ORG_AGENT_ENROLLMENT_EPOCH_INVALID');
  insist(timestamp(p.issuedAt)<=timestamp(p.notBefore) &&
    timestamp(p.notBefore)<timestamp(p.expiresAt),
    'ORG_AGENT_ENROLLMENT_INTERVAL_INVALID');
  return p;
}
const agentEnrollmentMessage=record=>Buffer.from(agentPrefix+canonical({
  schema:record.schema,keyId:record.keyId,payload:record.payload
}),'utf8');
export function signOrganizationAgentEnrollment(claims,issuerSigner) {
  const payload=validateOrganizationAgentEnrollmentClaims(claims);
  insist(issuerSigner&&typeof issuerSigner.sign==='function','ORG_ISSUER_SIGNER_REQUIRED');
  const record={schema:ORG_AGENT_ENROLLMENT_SCHEMA,
    keyId:identifier(issuerSigner.keyId),payload};
  const signature=issuerSigner.sign(agentEnrollmentMessage(record));
  insist(Buffer.isBuffer(signature)&&signature.length===64,'ORG_AGENT_ENROLLMENT_SIGNATURE_INVALID');
  return {...record,signature:signature.toString('base64url')};
}
export function verifyOrganizationAgentEnrollment(input,state,organization,now) {
  const record=copy(input);
  fields(record,['schema','keyId','payload','signature']);
  insist(record.schema===ORG_AGENT_ENROLLMENT_SCHEMA,'ORG_AGENT_ENROLLMENT_SCHEMA_INVALID');
  identifier(record.keyId);
  const payload=validateOrganizationAgentEnrollmentClaims(record.payload);
  insist(typeof record.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(record.signature),
    'ORG_AGENT_ENROLLMENT_SIGNATURE_FORMAT');
  const signature=Buffer.from(record.signature,'base64url');
  insist(signature.length===64&&signature.toString('base64url')===record.signature,
    'ORG_AGENT_ENROLLMENT_SIGNATURE_FORMAT');
  const authority=state.policy?.authorities?.[organization.issuerAuthorityId];
  const key=state.policy?.keys?.[record.keyId];
  insist(authority&&key&&authority.issuerKeys.includes(record.keyId),
    'ORG_AGENT_ISSUER_NOT_TRUSTED');
  insist(key.uses.includes('GRANT')&&key.status==='ACTIVE'&&
    key.environment===state.policy.environment,
    'ORG_AGENT_ISSUER_KEY_UNAVAILABLE');
  insist(timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt),
    'ORG_AGENT_ISSUER_KEY_EXPIRED');
  insist(payload.organizationId===organization.organizationId&&
    payload.realmId===organization.realmId&&
    payload.issuerAuthorityId===organization.issuerAuthorityId&&
    payload.membershipEpoch===organization.membershipEpoch,
    'ORG_AGENT_ENROLLMENT_AUTHORITY_MISMATCH');
  insist(timestamp(payload.issuedAt)<=now&&timestamp(payload.notBefore)<=now&&
    now<timestamp(payload.expiresAt),'ORG_AGENT_ENROLLMENT_NOT_CURRENT');
  insist(timestamp(payload.expiresAt)-timestamp(payload.notBefore)<=authority.maxTtlSeconds*1000,
    'ORG_AGENT_ENROLLMENT_EXCEEDS_ISSUER_CEILING');
  insist(createPublicKey(key.publicKey).asymmetricKeyType==='ed25519'&&
    verify(null,agentEnrollmentMessage(record),createPublicKey(key.publicKey),signature),
    'ORG_AGENT_ENROLLMENT_SIGNATURE_INVALID');
  return payload;
}

function prepareWithBoundState(untrusted) {
  const input=copy(untrusted);
  fields(input,['profile','selection','descriptors','credential','enrollment',
    'accessState','operation','asOf'],['agentEnrollment']);
  const person=validateProductContract('PersonalSubjectProfile',input.profile);
  const choice=validateProductContract('ActiveContextSelection',input.selection);
  const credential=validateProductContract('AdminIssuedCredential',input.credential);
  const op=input.operation;
  fields(op,['operationId','productId','audience','resource','action','purpose','payloadDigest']);
  for(const k of ['operationId','productId','audience','resource','action','purpose'])
    identifier(op[k]);
  insist(hex(op.payloadDigest),'ORG_OPERATION_PAYLOAD_DIGEST_INVALID');
  insist(['IWXA_CONTROL_CENTER','IWXA_ADMIN_CENTER'].includes(op.productId),
    'ORG_PRODUCT_UNKNOWN');
  const now=timestamp(input.asOf);
  const candidate=selectContextCandidate(person,choice,input.descriptors,input.asOf);
  insist(candidate.subjectType==='ORGANIZATION'&&candidate.authorized===false,
    'ORG_CONTEXT_PREVIEW_REQUIRED');
  const state=input.accessState;
  const policy=state.policy;
  insist(policy&&state.grants&&policy.authorities&&policy.keys,
    'ORG_ACCESS_STATE_REQUIRED');
  const org=validateProductContract('OrganizationIdentity',
    input.descriptors.organizations.find(o=>o.organizationId===choice.organizationId));
  const workspace=validateProductContract('ManagedWorkspace',
    input.descriptors.workspaces.find(w=>w.workspaceId===choice.workspaceId));
  const member=validateProductContract('StaffMembership',
    input.descriptors.memberships.find(m=>m.membershipId===choice.membershipId));
  const binding=validateProductContract('OrganizationGrant',
    input.descriptors.grants.find(g=>g.grantId===choice.grantId));
  insist(org.issuerAuthorityId!=='local-admin','LEGACY_LOCAL_ADMIN_IS_NOT_ORGANIZATION');
  const authority=policy.authorities[org.issuerAuthorityId];
  insist(authority&&authority.principalId===org.organizationId &&
    policy.realmId===org.realmId &&
    authority.membershipEpoch===org.membershipEpoch,'ORG_TRUST_REALM_OR_EPOCH_MISMATCH');
  insist(org.issuerPublicKeyRefs.every(k=>authority.issuerKeys.includes(k)),
    'ORG_ISSUER_REFS_NOT_TRUSTED');
  insist(workspace.organizationId===org.organizationId &&
    workspace.ownerDataRootId===org.organizationDataRootId,'ORG_DATA_ROOT_MISMATCH');
  const enrollment=verifyOrganizationEnrollment(input.enrollment,state,org,now);
  insist(enrollment.personId===person.personId &&
    enrollment.workspaceId===workspace.workspaceId &&
    enrollment.membershipId===member.membershipId &&
    enrollment.credentialId===credential.credentialId &&
    enrollment.credentialPublicKeyRef===credential.publicKeyRef &&
    enrollment.grantId===binding.grantId,'ORG_ENROLLMENT_SUBJECT_BINDING');
  insist(credential.organizationId===org.organizationId &&
    credential.membershipId===member.membershipId &&
    credential.issuerAuthorityId===org.issuerAuthorityId &&
    credential.holderPersonId===person.personId &&
    credential.status==='ACTIVE' &&
    timestamp(credential.notBefore)<=now&&now<timestamp(credential.expiresAt),
    'ORG_CREDENTIAL_INVALID');
  insist(!person.personalPublicKeyRefs.includes(credential.publicKeyRef),
    'PERSONAL_SIGNER_CANNOT_BE_ORG_CREDENTIAL');
  const key=policy.keys[credential.publicKeyRef];
  insist(key&&key.subjectId===person.personId&&key.environment===policy.environment &&
    key.status==='ACTIVE'&&key.uses.includes('PROOF') &&
    !key.uses.some(use=>['GRANT','STATUS','LICENSE','LICENSE_STATUS'].includes(use)) &&
    !authority.issuerKeys.includes(credential.publicKeyRef) &&
    !authority.statusKeys.includes(credential.publicKeyRef),
    'ORG_PROOF_CREDENTIAL_NOT_INDEPENDENT');
  const envelope=state.grants[binding.grantId];
  insist(envelope&&hex(binding.signedEnvelopeDigest) &&
    digest(envelope)===binding.signedEnvelopeDigest &&
    enrollment.signedGrantDigest===binding.signedEnvelopeDigest,
    'ORG_GRANT_ENVELOPE_CHANGED');
  const grant=verifiedChain(binding.grantId,state,now).at(-1);
  insist(grant.authorityId===org.issuerAuthorityId &&
    grant.principalId===org.organizationId && grant.holderId===person.personId &&
    grant.realmId===org.realmId && grant.roleId===member.roleId &&
    grant.membershipEpoch===member.membershipEpoch &&
    grant.membershipEpoch===org.membershipEpoch,'ORG_SIGNED_GRANT_SCOPE_MISMATCH');
  insist(grant.notBefore===binding.notBefore&&grant.expiresAt===binding.expiresAt &&
    sameIds(grant.resources,binding.resources) &&
    sameIds(grant.actions,binding.actions) &&
    sameIds(grant.purposes,binding.purposes),'ORG_GRANT_BINDING_NOT_EXACT');
  insist(member.notBefore>=grant.notBefore&&member.expiresAt<=grant.expiresAt &&
    enrollment.notBefore<=member.notBefore &&
    enrollment.expiresAt<=member.expiresAt,'ORG_MEMBERSHIP_INTERVAL_OUTSIDE_ENROLLMENT');
  insist(knownRightClasses.includes(grant.rightClass) &&
    (op.productId==='IWXA_ADMIN_CENTER'||grant.rightClass!=='ADMINISTRATION'),
    'ORG_PRODUCT_ACTION_CLASS_DENIED');
  insist(grant.audience===op.audience &&
    binding.resources.includes(op.resource) &&
    binding.actions.includes(op.action) &&
    binding.purposes.includes(op.purpose) &&
    policy.actionCatalog[op.action]===grant.rightClass,
    'ORG_OPERATION_OUTSIDE_GRANT');
  // A corporate agent is admitted through the SAME signed organizational
  // membership, root grant, issuer and Access evaluator as a person. Issuer
  // evidence binds the independent agent proof key to the responsible human.
  // The proof-only employee credential is NEVER made into a grant signer.
  let actorId=person.personId,actorGrant=grant;
  let credentialKeyId=credential.publicKeyRef;
  let credentialValidUntil=credential.expiresAt;
  let enrollmentValidUntil=enrollment.expiresAt;
  let agentBinding=null;
  if(input.agentEnrollment!==undefined) {
    const agent=verifyOrganizationAgentEnrollment(input.agentEnrollment,state,org,now);
    insist(agent.responsiblePersonId===person.personId&&
      agent.workspaceId===workspace.workspaceId&&
      agent.membershipId===member.membershipId&&
      agent.rootGrantId===binding.grantId&&
      agent.delegatedGrantId!==binding.grantId,
      'ORG_AGENT_RESPONSIBLE_MEMBER_MISMATCH');
    insist(timestamp(agent.notBefore)>=timestamp(member.notBefore)&&
      timestamp(agent.expiresAt)<=timestamp(member.expiresAt)&&
      timestamp(agent.expiresAt)<=timestamp(grant.expiresAt),
      'ORG_AGENT_MANDATE_OUTSIDE_MEMBER');
    const delegatedEnvelope=state.grants[agent.delegatedGrantId];
    insist(delegatedEnvelope&&
      digest(delegatedEnvelope)===agent.signedDelegatedGrantDigest,
      'ORG_AGENT_DELEGATED_GRANT_CHANGED');
    const agentChain=verifiedChain(agent.delegatedGrantId,state,now);
    const terminal=agentChain.at(-1);
    insist(agentChain.length>=2&&agentChain[0].id===binding.grantId&&
      terminal.id===agent.delegatedGrantId&&
      terminal.holderId===agent.agentId&&
      terminal.authorityId===org.issuerAuthorityId&&
      terminal.principalId===org.organizationId&&
      terminal.roleId===member.roleId&&
      terminal.membershipEpoch===member.membershipEpoch&&
      terminal.realmId===org.realmId&&
      terminal.audience===op.audience,
      'ORG_AGENT_SIGNED_DELEGATION_MISMATCH');
    const agentKey=policy.keys[agent.agentCredentialPublicKeyRef];
    insist(agentKey&&agentKey.subjectId===agent.agentId&&
      agentKey.environment===policy.environment&&agentKey.status==='ACTIVE'&&
      agentKey.uses.includes('PROOF')&&
      !agentKey.uses.some(use=>['GRANT','STATUS','LICENSE','LICENSE_STATUS'].includes(use))&&
      !authority.issuerKeys.includes(agent.agentCredentialPublicKeyRef)&&
      !authority.statusKeys.includes(agent.agentCredentialPublicKeyRef)&&
      !person.personalPublicKeyRefs.includes(agent.agentCredentialPublicKeyRef)&&
      timestamp(agentKey.notBefore)<=now&&now<timestamp(agentKey.expiresAt),
      'ORG_AGENT_INDEPENDENT_PROOF_KEY_REQUIRED');
    actorId=agent.agentId;
    actorGrant=terminal;
    credentialKeyId=agent.agentCredentialPublicKeyRef;
    credentialValidUntil=agentKey.expiresAt;
    enrollmentValidUntil=timestamp(agent.expiresAt)<timestamp(enrollment.expiresAt)
      ?agent.expiresAt:enrollment.expiresAt;
    agentBinding={agentId:agent.agentId,delegatedGrantId:agent.delegatedGrantId,
      credentialKeyId,agentEnrollmentDigest:digest(input.agentEnrollment),
      signedDelegatedGrantDigest:agent.signedDelegatedGrantDigest};
  }
  const bindingDigest=digest({schema:ORG_OPERATION_SCHEMA,
    selectionId:choice.selectionId,personId:person.personId,
    organizationId:org.organizationId,workspaceId:workspace.workspaceId,
    membershipId:member.membershipId,credentialId:credential.credentialId,
    grantId:binding.grantId,signedGrantDigest:binding.signedEnvelopeDigest,
    ...(agentBinding?{agentBinding}:{}),
    operation:op});
  const request={id:'org-context:'+bindingDigest,
    actorId,principalId:org.organizationId,roleId:actorGrant.roleId,
    grantId:actorGrant.id,audience:op.audience,resource:op.resource,
    action:op.action,purpose:op.purpose,realmId:org.realmId,
    operationDigest:bindingDigest};
  return {schema:'IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1',
    outcome:'PREVIEW_ONLY',authorized:false,productionActivation:false,
    subjectType:candidate.subjectType,
    organizationId:org.organizationId,workspaceId:workspace.workspaceId,
    dataRootId:org.organizationDataRootId,credentialKeyId,
    // Signed organization membership assigns accountable human, distinct
    // from signed agent actor. Never infer from a string prefix or a model.
    responsiblePersonId:person.personId,actorIdentityKind:agentBinding?'AGENT':'PERSON',
    agentEnrollmentDigest:agentBinding?.agentEnrollmentDigest??null,
    request,scopeDigest:bindingDigest,contextSelectedByUser:true,
    membershipValidUntil:member.expiresAt,statusObservedUntil:member.statusValidUntil,
    credentialValidUntil,enrollmentValidUntil};
}

function authorizeWithBoundState(input,authorization) {
  const denied=(reason,outcome='DENIED')=>({schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
    allowed:false,outcome,reasons:[reason],productionActivation:false,
    evidenceOnly:true});
  try {
    const proofContext=copy(authorization);
    fields(proofContext,['now','challenge','proof'],['confirmations','timeAssurance']);
    const verifiedInput=copy(input);
    const preview=prepareWithBoundState({...verifiedInput,asOf:proofContext.now});
    insist(proofContext.proof?.keyId===preview.credentialKeyId,
      'ORG_PROOF_MUST_USE_ISSUED_CREDENTIAL');
    const decision=evaluate(preview.request,verifiedInput.accessState,{
      now:proofContext.now,challenge:proofContext.challenge,proof:proofContext.proof,
      confirmations:proofContext.confirmations??[],
      timeAssurance:proofContext.timeAssurance??'LOCAL_BEST_EFFORT'
    });
    if(decision.allowed!==true||decision.outcome!=='PERMITTED')
      return denied(decision.reasons?.[0]??'ORG_ACCESS_DENIED',decision.outcome);
    const floor=Math.min(...[decision.validUntil,preview.membershipValidUntil,
      preview.statusObservedUntil,preview.credentialValidUntil,preview.enrollmentValidUntil]
      .map(timestamp));
    insist(floor>timestamp(proofContext.now),'ORG_JIT_AUTHORIZATION_EXPIRED');
    return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
      outcome:'PERMITTED',allowed:true,productionActivation:false,evidenceOnly:true,
      organizationId:preview.organizationId,workspaceId:preview.workspaceId,
      actorId:preview.request.actorId,responsiblePersonId:preview.responsiblePersonId,
      actorIdentityKind:preview.actorIdentityKind,
      agentEnrollmentDigest:preview.agentEnrollmentDigest,
      operationDigest:preview.request.operationDigest,requestDigest:decision.requestDigest,
      grantId:preview.request.grantId,statusSequence:decision.statusSequence,
      validUntil:new Date(floor).toISOString(),policyDigest:decision.policyDigest,
      evidenceDigest:digest({request:preview.request,accessDecision:decision,
        responsiblePersonId:preview.responsiblePersonId,
        actorIdentityKind:preview.actorIdentityKind,
        agentEnrollmentDigest:preview.agentEnrollmentDigest}),
      doesNotTransferData:true,doesNotAcceptCorporateCopy:true};
  } catch(error) {
    return denied(typeof error?.code==='string'?error.code:'ORG_AUTHORIZATION_INVALID');
  }
}


// Direct/unbound authorization is forbidden. A caller-provided registry snapshot
// (even one containing valid-looking keys) is not a source of local trust.
export function prepareOrganizationalOperation() {
  insist(false,'ORG_HOST_BOUND_REGISTRY_REQUIRED');
}
export function authorizeOrganizationalOperation() {
  return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',allowed:false,
    outcome:'UNRESOLVED',reasons:['ORG_HOST_BOUND_REGISTRY_REQUIRED'],
    evidenceOnly:true,productionActivation:false};
}
// Only a trusted local host may construct this gate with its existing
// AccessRegistry. Never expose the factory or registry as a client API.
export function createOrganizationalOperationGate({registry}={}) {
  // Reuse the ONE existing signed AccessRegistry persisted in the ORIGINAL
  // Kernel Store. No second in-memory IAM, issuer, journal or alternate DB.
  insist(isOriginalKernelRegistryStatePort(registry),
    'ORG_TRUSTED_ACCESS_REGISTRY_REQUIRED');
  const bind = async incoming => {
    const input=copy(incoming);
    fields(input,['profile','selection','descriptors','credential','enrollment',
      'operation','asOf'],['agentEnrollment']);
    const current=await registry.readState();
    insist(current?.policy&&current.grants&&current.statuses,
      'ORG_REGISTRY_STATE_UNAVAILABLE');
    return {...input,accessState:current};
  };
  const denied = error => ({schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
    allowed:false,outcome:'DENIED',
    reasons:[typeof error?.code==='string'?error.code:'ORG_OPERATION_INVALID'],
    evidenceOnly:true,productionActivation:false});
  return Object.freeze({
    preview: async incoming => prepareWithBoundState(await bind(incoming)),
    authorize: async (incoming,authorization) => {
      try { return authorizeWithBoundState(await bind(incoming),authorization); }
      catch(error) { return denied(error); }
    }
  });
}
