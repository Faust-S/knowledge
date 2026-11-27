// Original T3 D3 independent employee enrollment, TRUSTED HOST ONLY.
// No new registry, vault, Store, signing algorithm or .iwxa serializer.
// Only the existing T2 Kernel signed-registry port can persist authority.
// A second employee must own an independently pinned Ed25519 proof credential.
import {randomUUID} from 'node:crypto';
import {
  copy,digest,evaluate,iso,identifier,makeProof,signRecord,timestamp,
  validateGrant,validateStatusSnapshot,verifyRecord,checkCeiling,
  hasRecordedTombstone,verifiedChain
} from './core.mjs';
import {isOriginalKernelRegistryStatePort} from './original-kernel-registry-state.mjs';
import {signOrganizationEnrollment,verifyOrganizationEnrollment}
  from './organizational-operation.mjs';
import {PRODUCT_CONTRACT_IDS,validateProductContract} from './product-contracts.mjs';
import {createOriginalCorporateSeatOwner} from './original-corporate-seat-owner.mjs';
import {ORIGINAL_NETWORK_KEY_TRANSITION,ORIGINAL_NETWORK_KEY_MANAGE,originalNetworkKeyPossessionBytes,
  originalNetworkKeyOperationDigest,originalNetworkKeyStatusId,validateOriginalNetworkKeyTransition,
  createOriginalNetworkAgreementChallenge} from './original-network-key-lifecycle.mjs';

const refuse=code=>{const e=new Error(code);e.name='T3OriginalEmployeeEnrollmentError';e.code=code;throw e;};
const check=(ok,code)=>{if(!ok)refuse(code);};
const id=value=>{try{return identifier(value);}catch{refuse('T3_EMPLOYEE_ID_INVALID');}};
const original=(kind,data)=>validateProductContract(kind,
  {kind,schema:PRODUCT_CONTRACT_IDS[kind],...data});
const audienceResource=({organizationId,workspaceId})=>[
  'workspace:'+workspaceId,'subject:'+organizationId,
  'recipient:'+organizationId,'field:result','operation:UPSERT'
];
const coreGrant=(state,{id:grantId,organization,employeePersonId,roleId,
  resources,actions,purposes,rightClass,ttlSeconds,enrollmentId,
  credentialKeyId,employeeProofDigest,now,
  holderId=employeePersonId,evidenceRefs=null})=>{
  const authority=state.policy.authorities[organization.issuerAuthorityId];
  const grant={
    kind:'GRANT',id:grantId,lineageId:grantId,renewalOf:null,
    parentGrantId:null,authorityId:organization.issuerAuthorityId,
    principalId:organization.organizationId,holderId,
    roleId,rightClass,realmId:organization.realmId,
    environment:state.policy.environment,audience:authority.audiences[0],
    resources,actions,purposes,issuedAt:iso(now),notBefore:iso(now),
    expiresAt:iso(now+ttlSeconds*1000),remainingDepth:0,
    membershipEpoch:organization.membershipEpoch,policyId:state.policy.id,
    policyVersion:state.policy.version,
    // Both original signed grants must retain the exact proof credential and
    // employee actor proof digest for cold reconstruction after a lost ACK.
    evidenceRefs:evidenceRefs??['employee-enrollment:'+enrollmentId,
      'employee-credential:'+credentialKeyId,
      'employee-proof-sha256:'+employeeProofDigest]
  };
  try{validateGrant(grant);checkCeiling(grant,authority,state.policy);}
  catch{refuse('T3_EMPLOYEE_GRANT_OUTSIDE_SIGNED_AUTHORITY');}
  return grant;
};

/**
 * The issuer and manager signers are existing owner-held credentials supplied
 * by the installed Host. "begin" gives the OTHER employee an original
 * makeProof challenge. Nothing is persisted before their separate proof.
 * The pending challenge is process-local: a cold start cannot replay it.
 */
export function createOriginalEmployeeEnrollmentOwner({
  registry,issuerSigner,proveManager,trustedOrganization,
  trustedWorkspaceId,clock=Date.now,corporateSeatSource=null,networkPilot=null
}={}){
  check(isOriginalKernelRegistryStatePort(registry)&&
    issuerSigner&&typeof issuerSigner.sign==='function'&&
    typeof issuerSigner.keyId==='string'&&typeof proveManager==='function'&&
    typeof clock==='function',
    'T3_EMPLOYEE_ORIGINAL_OWNER_REQUIRED');
  // Organizational identity and Workspace are chosen by the trusted Host,
  // NEVER inferred from a caller-provided invitation or arbitrary UI input.
  let pinnedOrganization;
  try{pinnedOrganization=validateProductContract(
    'OrganizationIdentity',trustedOrganization);
    identifier(trustedWorkspaceId);
  }catch{refuse('T3_EMPLOYEE_TRUSTED_HOST_CONTEXT_REQUIRED');}
  let pending=null,operationAttempted=false;
  const now=()=>{const t=clock();check(Number.isSafeInteger(t)&&t>0,'T3_EMPLOYEE_CLOCK_INVALID');return t;};
  const state=()=>registry.readState();
  function checkInput(input,at,state){
    check(input&&Object.getPrototypeOf(input)===Object.prototype&&
      Object.keys(input).sort().join()===
      ['credentialKeyId','employeePersonId','managerGrantId',
       'managerPersonId','organization','ttlSeconds','workspaceId'].sort().join(),
      'T3_EMPLOYEE_ENROLLMENT_INPUT_INVALID');
    const {organization,credentialKeyId,employeePersonId,managerPersonId,
      managerGrantId,workspaceId,ttlSeconds}=input;
    const org=validateProductContract('OrganizationIdentity',organization);
    check(digest(org)===digest(pinnedOrganization)&&
      workspaceId===trustedWorkspaceId,
      'T3_EMPLOYEE_TRUSTED_ORGANIZATION_CONTEXT_CHANGED');
    id(employeePersonId);id(managerPersonId);id(credentialKeyId);
    id(managerGrantId);id(workspaceId);
    check(employeePersonId!==managerPersonId,
      'T3_EMPLOYEE_INDEPENDENT_PERSON_REQUIRED');
    const auth=state.policy.authorities[org.issuerAuthorityId];
    check(!!auth&&auth.principalId===org.organizationId&&
      org.realmId===state.policy.realmId&&
      auth.membershipEpoch===org.membershipEpoch&&
      org.issuerPublicKeyRefs.includes(issuerSigner.keyId)&&
      auth.issuerKeys.includes(issuerSigner.keyId),
      'T3_EMPLOYEE_ORGANIZATION_AUTHORITY_MISMATCH');
    const issuerKey=state.policy.keys[issuerSigner.keyId];
    check(issuerKey?.status==='ACTIVE'&&issuerKey.uses.includes('GRANT')&&
      issuerKey.uses.includes('STATUS')&&
      timestamp(issuerKey.notBefore)<=at&&at<timestamp(issuerKey.expiresAt),
      'T3_EMPLOYEE_ISSUER_NOT_ACTIVE');
    const credential=state.policy.keys[credentialKeyId];
    check(credential&&credential.subjectId===employeePersonId&&
      credential.status==='ACTIVE'&&
      credential.uses.length===1&&credential.uses[0]==='PROOF'&&
      !auth.issuerKeys.includes(credentialKeyId)&&
      !auth.statusKeys.includes(credentialKeyId)&&
      credential.environment===state.policy.environment&&
      timestamp(credential.notBefore)<=at&&at<timestamp(credential.expiresAt),
      'T3_EMPLOYEE_CREDENTIAL_NOT_PRETRUSTED');
    const managerGrant=state.grants[managerGrantId]?.payload;
    check(managerGrant&&managerGrant.holderId===managerPersonId&&
      managerGrant.principalId===org.organizationId&&
      managerGrant.authorityId===org.issuerAuthorityId&&
      managerGrant.rightClass==='ADMINISTRATION'&&
      managerGrant.actions.includes('grant.issue')&&
      managerGrant.resources.includes('authority:'+org.issuerAuthorityId),
      'T3_EMPLOYEE_MANAGER_GRANT_REQUIRED');
    check(Number.isSafeInteger(ttlSeconds)&&ttlSeconds>0&&
      ttlSeconds<=auth.maxTtlSeconds&&
      at+ttlSeconds*1000<=timestamp(issuerKey.expiresAt)&&
      at+ttlSeconds*1000<=timestamp(credential.expiresAt),
      'T3_EMPLOYEE_CREDENTIAL_OR_GRANT_EXPIRY');
    const required=[
      {rightClass:'ACTION',actions:['work.prepare'],purposes:['work'],
        resources:[workspaceId]},
      {rightClass:'DATA',actions:['package.export'],purposes:['handoff'],
        resources:audienceResource({organizationId:org.organizationId,workspaceId})}
    ];
    check(auth.resources.includes(workspaceId)&&
      required.every(entry=>entry.actions.every(action=>auth.actions.includes(action)&&
        state.policy.actionCatalog[action]===entry.rightClass)&&
        entry.purposes.every(purpose=>auth.purposes.includes(purpose))&&
        entry.resources.every(resource=>auth.resources.includes(resource))),
      'T3_EMPLOYEE_POLICY_CEILING_REQUIRES_TRUSTED_UPDATE');
    const existing=Object.values(state.grants).some(record=>{
      const g=record.payload;
      return g.holderId===employeePersonId&&
        g.authorityId===org.issuerAuthorityId&&
        g.resources.includes(workspaceId)&&
        g.evidenceRefs.some(ref=>ref.startsWith('employee-enrollment:'));
    });
    check(!existing,'T3_EMPLOYEE_ALREADY_ENROLLED_READBACK_REQUIRED');
    return {organization:org,auth,managerGrant,required};
  }
  function proofRequest(input,enrollmentId){
    const org=input.organization;
    return {
      id:'employee-proof:'+enrollmentId,
      actorId:input.employeePersonId,
      principalId:org.organizationId,
      roleId:'worker',grantId:'enrollment:'+enrollmentId,
      audience:'t3.employee.enrollment',
      resource:input.workspaceId,action:'work.prepare',
      purpose:'work',realmId:org.realmId,
      operationDigest:digest({schema:'IWXA_T3_EMPLOYEE_INTENT/1',
        input,enrollmentId})
    };
  }
  // Rebuild the EXACT same signed issuer enrollment from original persisted
  // grants after a cold restart. Never mint new IDs or a replacement grant.
  function reconstruct({saved,employeePersonId,enrollmentId,at,signEnrollment=true}){
    const organization=pinnedOrganization,workspaceId=trustedWorkspaceId;
    check(organization.organizationId&&employeePersonId&&enrollmentId,
      'T3_EMPLOYEE_RECOVERY_INPUT_REQUIRED');
    const rows=Object.values(saved.grants).filter(env=>{
      const g=env.payload;
      return g.principalId===organization.organizationId&&
        g.authorityId===organization.issuerAuthorityId&&
        g.holderId===employeePersonId&&
        (g.resources.includes(workspaceId)||g.resources.includes('workspace:'+workspaceId))&&
        g.evidenceRefs.includes('employee-enrollment:'+enrollmentId);
    });
    check(rows.length===2,'T3_EMPLOYEE_ORIGINAL_GRANT_PAIR_REQUIRED');
    const workRecord=rows.find(x=>x.payload.rightClass==='ACTION'&&
      x.payload.actions.length===1&&x.payload.actions[0]==='work.prepare');
    const exportRecord=rows.find(x=>x.payload.rightClass==='DATA'&&
      x.payload.actions.length===1&&x.payload.actions[0]==='package.export');
    check(workRecord&&exportRecord&&workRecord!==exportRecord,
      'T3_EMPLOYEE_ORIGINAL_GRANT_PAIR_INVALID');
    const work=workRecord.payload,exportGrant=exportRecord.payload;
    const fields=['issuedAt','notBefore','expiresAt','roleId','realmId',
      'environment','membershipEpoch','audience','principalId','holderId',
      'authorityId'];
    check(fields.every(k=>work[k]===exportGrant[k])&&
      work.roleId==='worker'&&work.resources.length===1&&
      work.resources[0]===workspaceId&&work.purposes.length===1&&
      work.purposes[0]==='work'&&
      exportGrant.purposes.length===1&&
      exportGrant.purposes[0]==='handoff'&&
      JSON.stringify(exportGrant.resources)===JSON.stringify(
        audienceResource({organizationId:organization.organizationId,workspaceId})),
      'T3_EMPLOYEE_RECOVERY_GRANT_SCOPE_CHANGED');
    check(workRecord.keyId===issuerSigner.keyId&&
      exportRecord.keyId===issuerSigner.keyId,
      'T3_EMPLOYEE_RECOVERY_ORIGINAL_SIGNER_REQUIRED');
    for(const env of rows){
      verifyRecord(env,saved.policy,at,'GRANT');
      verifiedChain(env.payload.id,saved,at);
    }
    const proofEvidence=(record,prefix)=>record.payload.evidenceRefs
      .filter(x=>x.startsWith(prefix));
    const keyRefs=proofEvidence(workRecord,'employee-credential:');
    const digestRefs=proofEvidence(workRecord,'employee-proof-sha256:');
    check(keyRefs.length===1&&digestRefs.length===1&&
      exportRecord.payload.evidenceRefs.includes(keyRefs[0])&&
      exportRecord.payload.evidenceRefs.includes(digestRefs[0]),
      'T3_EMPLOYEE_RECOVERY_PROOF_EVIDENCE_CHANGED');
    const credentialKeyId=keyRefs[0].slice('employee-credential:'.length);
    const proofDigest=digestRefs[0].slice('employee-proof-sha256:'.length);
    check(/^[a-f0-9]{64}$/.test(proofDigest)&&
      saved.policy.keys[credentialKeyId]?.subjectId===employeePersonId&&
      saved.policy.keys[credentialKeyId]?.status==='ACTIVE'&&
      saved.policy.keys[credentialKeyId]?.uses.includes('PROOF'),
      'T3_EMPLOYEE_RECOVERY_CREDENTIAL_UNTRUSTED');
    const status=validateStatusSnapshot(organization.issuerAuthorityId,saved,at);
    check(rows.every(x=>status.entries.some(entry=>
      entry.grantId===x.payload.id&&entry.state==='ACTIVE')&&
      !hasRecordedTombstone(saved,x.payload.id)),
      'T3_EMPLOYEE_RECOVERY_AUTHORITY_NOT_ACTIVE');
    const membershipId='member:'+enrollmentId;
    const credential=original('AdminIssuedCredential',{
      credentialId:'credential:'+credentialKeyId,
      organizationId:organization.organizationId,membershipId,
      issuerAuthorityId:organization.issuerAuthorityId,
      holderPersonId:employeePersonId,publicKeyRef:credentialKeyId,
      custody:'HOLDER_ORG_SCOPED',personalKeySource:false,
      notBefore:work.notBefore,expiresAt:work.expiresAt,status:'ACTIVE'
    });
    const membership=original('StaffMembership',{
      membershipId,organizationId:organization.organizationId,
      personId:employeePersonId,workspaceId,roleId:'worker',
      grantId:work.id,issuerAuthorityId:organization.issuerAuthorityId,
      membershipEpoch:organization.membershipEpoch,
      notBefore:work.notBefore,expiresAt:work.expiresAt,
      status:'ACTIVE',statusObservedAt:status.issuedAt,
      statusValidUntil:status.validUntil
    });
    const binding=original('OrganizationGrant',{
      organizationId:organization.organizationId,membershipId,
      grantId:work.id,authorityId:organization.issuerAuthorityId,
      realmId:organization.realmId,holderPersonId:employeePersonId,
      roleId:'worker',membershipEpoch:organization.membershipEpoch,
      resources:work.resources,actions:work.actions,purposes:work.purposes,
      notBefore:work.notBefore,expiresAt:work.expiresAt,
      signedEnvelopeDigest:digest(workRecord)
    });
    // Product inventory needs the original verified grant pair and proof
    // binding, not another enrollment signature or invitation.
    if(!signEnrollment)return Object.freeze({
      enrollmentId,organizationId:organization.organizationId,employeePersonId,
      workspaceId,credentialPublicKeyRef:credentialKeyId,
      grantIds:{work:work.id,export:exportGrant.id},statusSequence:status.sequence,
      originalSigned:true});
    const enrollment=signOrganizationEnrollment({
      schema:'IWXA_T3_ORGANIZATION_ENROLLMENT_CLAIMS/1',
      organizationId:organization.organizationId,
      realmId:organization.realmId,
      issuerAuthorityId:organization.issuerAuthorityId,
      personId:employeePersonId,workspaceId,membershipId,
      credentialId:credential.credentialId,credentialPublicKeyRef:credentialKeyId,
      grantId:work.id,signedGrantDigest:digest(workRecord),
      organizationDataRootId:organization.organizationDataRootId,
      membershipEpoch:organization.membershipEpoch,
      issuedAt:work.issuedAt,notBefore:work.notBefore,expiresAt:work.expiresAt
    },issuerSigner);
    verifyOrganizationEnrollment(enrollment,saved,organization,at);
    return Object.freeze({state:'SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED',
      enrollmentId,organizationId:organization.organizationId,
      employeePersonId,workspaceId,credentialPublicKeyRef:credentialKeyId,
      grantIds:{work:work.id,export:exportGrant.id},
      statusSequence:status.sequence,membership,credential,binding,enrollment,
      exportGrant:exportRecord,workGrant:workRecord,
      originalSigned:true,invitationDelivered:false,automaticTransfer:false,
      productionActivation:false});
  }
  async function begin(input){
    check(!pending&&!operationAttempted,'T3_EMPLOYEE_PENDING_OR_OUTCOME_UNKNOWN');
    const at=now(),signed=await state();
    checkInput(input,at,signed);
    const enrollmentId=randomUUID(),challenge=randomUUID()+randomUUID();
    const intent=copy(input),request=proofRequest(intent,enrollmentId);
    pending={enrollmentId,input:intent,request,challenge,
      grantIds:{work:'grant:'+randomUUID(),export:'grant:'+randomUUID()},
      validUntil:at+60000,attempted:false};
    return Object.freeze({
      state:'AWAITING_EMPLOYEE_PROOF',enrollmentId,request:copy(request),
      challenge,validUntil:iso(pending.validUntil),credentialKeyId:intent.credentialKeyId,
      // No invitation or corporate membership exists at this stage.
      signed:false,member:false
    });
  }
  // This is exclusively a process-local UNSUBMITTED challenge. No Kernel
  // Object/Event, signed grant or STATUS exists until complete() dispatches.
  // Even a failed complete() may have committed before losing its ACK, so
  // cancellation MUST refuse after the first attempt without using readback
  // to guess whether the write happened.
  function cancelPending({enrollmentId,employeePersonId}={}){
    const p=pending;
    check(p&&!p.attempted&&!operationAttempted&&
      p.enrollmentId===enrollmentId&&
      p.input.employeePersonId===employeePersonId,
      'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN');
    pending=null;
    return Object.freeze({
      schema:'IWXA_T3_ORIGINAL_EMPLOYEE_CHALLENGE_CANCEL/1',
      state:'UNSUBMITTED_EMPLOYEE_CHALLENGE_CANCELLED',
      enrollmentId,employeePersonId,
      originalKernelWriteAttempted:false
    });
  }
  async function complete({enrollmentId,employeeProof}={}){
    const p=pending,at=now();
    check(p&&!p.attempted&&p.enrollmentId===enrollmentId&&
      at<p.validUntil,'T3_EMPLOYEE_ENROLLMENT_CHALLENGE_STALE');
    p.attempted=true;operationAttempted=true;
    // The operation may commit even if the later ACK is lost. No retry here.
    const before=await state(),{organization,managerGrant,required}=
      checkInput(p.input,at,before);
    const currentStatus=validateStatusSnapshot(organization.issuerAuthorityId,before,at);
    check(!hasRecordedTombstone(before,managerGrant.id)&&
      currentStatus.entries.some(x=>x.grantId===managerGrant.id&&x.state==='ACTIVE'),
      'T3_EMPLOYEE_MANAGER_REVOKED');
    check(employeeProof?.keyId===p.input.credentialKeyId,
      'T3_EMPLOYEE_PROOF_WRONG_CREDENTIAL');
    let key;
    try{key=verifyRecord(employeeProof,before.policy,at,'PROOF');}
    catch{refuse('T3_EMPLOYEE_ORIGINAL_PROOF_INVALID');}
    check(key.subjectId===p.input.employeePersonId&&
      employeeProof.payload.requestDigest===digest(p.request)&&
      employeeProof.payload.challenge===p.challenge&&
      timestamp(employeeProof.payload.issuedAt)<=at&&
      at<timestamp(employeeProof.payload.expiresAt)&&
      at-timestamp(employeeProof.payload.issuedAt)<
        before.policy.proofMaxAgeSeconds*1000,
      'T3_EMPLOYEE_PROOF_BINDING_OR_TIME_INVALID');
    const managerRequest={
      id:'enroll-manager:'+enrollmentId,actorId:p.input.managerPersonId,
      principalId:organization.organizationId,roleId:managerGrant.roleId,
      grantId:managerGrant.id,audience:managerGrant.audience,
      resource:'authority:'+organization.issuerAuthorityId,
      action:'grant.issue',purpose:'access-administration',
      realmId:before.policy.realmId,
      operationDigest:digest({enrollmentId,request:p.request,
        employeeProofDigest:digest(employeeProof)})
    };
    const managerChallenge=randomUUID()+randomUUID();
    const managerProof=await proveManager({request:copy(managerRequest),
      challenge:managerChallenge,asOf:iso(at),
      managerPersonId:p.input.managerPersonId,
      organizationId:organization.organizationId});
    const decision=evaluate(managerRequest,before,{now:iso(at),
      challenge:managerChallenge,proof:managerProof,
      timeAssurance:'LOCAL_BEST_EFFORT'});
    check(decision.allowed===true&&decision.outcome==='PERMITTED',
      'T3_EMPLOYEE_MANAGER_NOT_AUTHORIZED');
    const evidence={credentialKeyId:p.input.credentialKeyId,
      employeeProofDigest:digest(employeeProof)};
    const ttl=p.input.ttlSeconds,work=coreGrant(before,{
      id:p.grantIds.work,organization,employeePersonId:p.input.employeePersonId,
      roleId:'worker',ttlSeconds:ttl,enrollmentId,now:at,...evidence,...required[0]});
    const exportGrant=coreGrant(before,{
      id:p.grantIds.export,organization,employeePersonId:p.input.employeePersonId,
      roleId:'worker',ttlSeconds:ttl,enrollmentId,now:at,...evidence,...required[1]});
    const workSigned=signRecord(work,issuerSigner);
    const exportSigned=signRecord(exportGrant,issuerSigner);
    try{
      verifyRecord(workSigned,before.policy,at,'GRANT');
      verifyRecord(exportSigned,before.policy,at,'GRANT');
    }catch{refuse('T3_EMPLOYEE_ORIGINAL_ISSUER_SIGNATURE_INVALID');}
    const next=copy(before),authorityId=organization.issuerAuthorityId;
    next.grants[work.id]=workSigned;
    next.grants[exportGrant.id]=exportSigned;
    const previous=next.statuses[authorityId].payload;
    const sequence=previous.sequence+1;
    const issuedAt=iso(at);
    const expiry=Math.min(at+next.policy.offlineMaxAgeSeconds*1000,
      timestamp(next.policy.keys[issuerSigner.keyId].expiresAt));
    check(expiry>at,'T3_EMPLOYEE_STATUS_WINDOW_INVALID');
    const entries=[
      ...previous.entries,
      ...[work,exportGrant].map(g=>({grantId:g.id,state:'ACTIVE',
        effectiveAt:issuedAt,evidenceRef:'employee-enrollment:'+enrollmentId}))
    ].sort((a,b)=>a.grantId.localeCompare(b.grantId));
    next.statuses[authorityId]=signRecord({...previous,
      id:'status:'+randomUUID(),sequence,issuedAt,validUntil:iso(expiry),
      entries},issuerSigner);
    next.statusFloor[authorityId]=sequence;
    // The original Kernel owns the one authoritative Object+Event commit.
    // Lost ACK => original readback, NEVER an alternative Store or new grants.
    const saved=await registry.commitSignedState(next);
    const readback=await state();
    check(readback.statusFloor[authorityId]===sequence&&
      digest(readback.grants[work.id])===digest(workSigned)&&
      digest(readback.grants[exportGrant.id])===digest(exportSigned),
      'T3_EMPLOYEE_ORIGINAL_COMMIT_READBACK_HOLD');
    const finalized=reconstruct({saved:readback,employeePersonId:p.input.employeePersonId,
      enrollmentId,at});
    check(finalized.statusSequence===sequence&&
      finalized.grantIds.work===work.id&&finalized.grantIds.export===exportGrant.id,
      'T3_EMPLOYEE_ORIGINAL_READBACK_BINDING_CHANGED');
    pending=null;
    operationAttempted=false;
    return Object.freeze({...finalized,kernelReceipt:saved});
  }
  async function readEnrollment({organizationId,employeePersonId,enrollmentId}={}){
    id(organizationId);id(employeePersonId);id(enrollmentId);
    check(organizationId===pinnedOrganization.organizationId,
      'T3_EMPLOYEE_TRUSTED_ORGANIZATION_CONTEXT_CHANGED');
    const at=now(),saved=await state();
    const rows=Object.values(saved.grants).filter(env=>
      env.payload.principalId===organizationId&&
      env.payload.authorityId===pinnedOrganization.issuerAuthorityId&&
      env.payload.holderId===employeePersonId&&
      (env.payload.resources.includes(trustedWorkspaceId)||
       env.payload.resources.includes('workspace:'+trustedWorkspaceId))&&
      env.payload.evidenceRefs.includes('employee-enrollment:'+enrollmentId));
    check(rows.length===2,'T3_EMPLOYEE_ENROLLMENT_READBACK_NOT_FOUND');
    let authorityState='ORIGINAL_GRANTS_ACTIVE';
    for(const env of rows){
      const g=env.payload;
      try {
        verifyRecord(env,saved.policy,at,'GRANT');
        if(hasRecordedTombstone(saved,g.id)||
           timestamp(g.expiresAt)<=at||timestamp(g.notBefore)>at){
          authorityState='ORIGINAL_GRANTS_REVOKED_OR_EXPIRED';continue;
        }
        verifiedChain(g.id,saved,at);
        const status=validateStatusSnapshot(g.authorityId,saved,at);
        const row=status.entries.find(x=>x.grantId===g.id);
        if(!row||row.state!=='ACTIVE')
          authorityState='ORIGINAL_GRANTS_REVOKED_OR_EXPIRED';
      }catch{
        authorityState='ORIGINAL_STATUS_UNKNOWN_HOLD';
      }
    }
    // Once original Kernel readback establishes a non-replayed outcome, a
    // different employee can be admitted. The same employee cannot be reissued.
    if(pending?.enrollmentId===enrollmentId){
      pending=null;operationAttempted=false;
    }
    const base={state:authorityState,enrollmentId,organizationId,
      employeePersonId,grants:rows.map(x=>x.payload.id).sort(),
      originalReadback:true,safeToReissue:false,invitationDelivered:false};
    if(authorityState!=='ORIGINAL_GRANTS_ACTIVE')return Object.freeze(base);
    const restored=reconstruct({saved,employeePersonId,enrollmentId,at});
    return Object.freeze({...base,originalSigned:true,
      originalEnrollment:restored.enrollment,
      membership:restored.membership,credential:restored.credential,
      binding:restored.binding,workGrant:restored.workGrant,
      exportGrant:restored.exportGrant,
      statusSequence:restored.statusSequence});
  }

  // A manager needs a DIFFERENT signed DATA right before exporting a Task
  // to an independently enrolled colleague. Worker ACTION/DATA grants alone
  // never authorize the manager to export to that recipient.
  const taskRecipientResources=(org,personId)=>[
    'workspace:'+trustedWorkspaceId,
    'subject:'+org.organizationId,
    'recipient:'+personId,'field:task','operation:UPSERT'
  ];
  const relatedTaskGrants=(saved,{enrollmentId,employeePersonId,
    managerPersonId})=>Object.values(saved.grants).filter(env=>
    env?.payload?.holderId===managerPersonId&&
    env.payload.evidenceRefs?.includes('employee-enrollment:'+enrollmentId)&&
    env.payload.evidenceRefs?.includes('task-recipient:'+employeePersonId));
  async function readTaskGrant({organizationId,employeePersonId,enrollmentId,
    managerPersonId}={}){
    id(organizationId);id(employeePersonId);id(enrollmentId);id(managerPersonId);
    check(organizationId===pinnedOrganization.organizationId&&
      employeePersonId!==managerPersonId,
      'T3_EMPLOYEE_TASK_GRANT_TRUSTED_SCOPE_REQUIRED');
    const at=now(),saved=await state();
    // Verifies both original employee grants, their STATUS and the signed
    // enrollment. A revoked worker must not retain newly issued Task rights.
    reconstruct({saved,employeePersonId,enrollmentId,at});
    const rows=relatedTaskGrants(saved,{enrollmentId,employeePersonId,
      managerPersonId});
    check(rows.length<=1,'T3_EMPLOYEE_TASK_GRANT_CONFLICT');
    const base={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_READBACK/1',
      organizationId,workspaceId:trustedWorkspaceId,
      employeePersonId,recipientId:employeePersonId,enrollmentId,
      managerPersonId,originalReadback:true,safeToReissue:false};
    if(!rows.length)return Object.freeze({...base,
      state:'ORIGINAL_MANAGER_TASK_DATA_NOT_FOUND'});
    const env=rows[0],g=env.payload;
    const exact=taskRecipientResources(pinnedOrganization,employeePersonId);
    check(g.principalId===organizationId&&
      g.authorityId===pinnedOrganization.issuerAuthorityId&&
      g.roleId==='assigner'&&g.rightClass==='DATA'&&
      g.actions.length===1&&g.actions[0]==='package.export'&&
      g.purposes.length===1&&g.purposes[0]==='assignment'&&
      JSON.stringify(g.resources)===JSON.stringify(exact)&&
      env.keyId===issuerSigner.keyId,
      'T3_EMPLOYEE_TASK_GRANT_SIGNED_SCOPE_CHANGED');
    try{
      verifyRecord(env,saved.policy,at,'GRANT');
      verifiedChain(g.id,saved,at);
      const status=validateStatusSnapshot(g.authorityId,saved,at);
      const active=status.entries.some(x=>x.grantId===g.id&&x.state==='ACTIVE');
      return Object.freeze({...base,grantId:g.id,grant:copy(env),
        statusSequence:status.sequence,
        state:active&&!hasRecordedTombstone(saved,g.id)
          ?'ORIGINAL_MANAGER_TASK_DATA_ACTIVE'
          :'ORIGINAL_MANAGER_TASK_DATA_REVOKED_OR_EXPIRED'});
    }catch{
      return Object.freeze({...base,grantId:g.id,
        state:'ORIGINAL_MANAGER_TASK_DATA_STATUS_UNKNOWN_HOLD'});
    }
  }
  let taskGrantAttempted=false;
  async function issueTaskGrant({organizationId,employeePersonId,enrollmentId,
    managerPersonId,managerGrantId}={}){
    check(!taskGrantAttempted,'T3_EMPLOYEE_TASK_GRANT_OUTCOME_UNKNOWN_READBACK');
    id(organizationId);id(employeePersonId);id(enrollmentId);
    id(managerPersonId);id(managerGrantId);
    check(organizationId===pinnedOrganization.organizationId&&
      employeePersonId!==managerPersonId,
      'T3_EMPLOYEE_TASK_GRANT_TRUSTED_SCOPE_REQUIRED');
    const at=now(),saved=await state(),org=pinnedOrganization;
    const enrolled=reconstruct({saved,employeePersonId,enrollmentId,at});
    const previous=relatedTaskGrants(saved,{enrollmentId,employeePersonId,
      managerPersonId});
    check(previous.length===0,'T3_EMPLOYEE_TASK_GRANT_EXISTS_USE_READBACK');
    const authority=saved.policy.authorities[org.issuerAuthorityId];
    const resources=taskRecipientResources(org,employeePersonId);
    check(authority&&authority.principalId===organizationId&&
      resources.every(x=>authority.resources.includes(x))&&
      authority.roles.includes('assigner')&&
      authority.rightClasses.includes('DATA')&&
      authority.actions.includes('package.export')&&
      authority.purposes.includes('assignment')&&
      saved.policy.actionCatalog['package.export']==='DATA',
      'T3_EMPLOYEE_TASK_GRANT_SIGNED_CEILING_REQUIRED');
    const manager=saved.grants[managerGrantId]?.payload;
    check(manager?.holderId===managerPersonId&&
      manager.principalId===organizationId&&
      manager.authorityId===org.issuerAuthorityId&&
      manager.rightClass==='ADMINISTRATION'&&
      manager.actions.includes('grant.issue')&&
      manager.resources.includes('authority:'+org.issuerAuthorityId),
      'T3_EMPLOYEE_TASK_MANAGER_GRANT_REQUIRED');
    const issuerKey=saved.policy.keys[issuerSigner.keyId];
    check(issuerKey?.status==='ACTIVE'&&
      timestamp(issuerKey.notBefore)<=at&&at<timestamp(issuerKey.expiresAt),
      'T3_EMPLOYEE_TASK_ISSUER_NOT_ACTIVE');
    const managerRequest={
      id:'employee-task-grant:'+randomUUID(),
      actorId:managerPersonId,principalId:organizationId,
      roleId:manager.roleId,grantId:managerGrantId,
      audience:manager.audience,
      resource:'authority:'+org.issuerAuthorityId,
      action:'grant.issue',purpose:'access-administration',
      realmId:org.realmId,
      operationDigest:digest({schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_INTENT/1',
        organizationId,employeePersonId,enrollmentId,managerPersonId,
        managerGrantId,workGrantId:enrolled.grantIds.work,
        resources})
    };
    const challenge=randomUUID()+randomUUID();
    const managerProof=await proveManager({
      request:copy(managerRequest),challenge,asOf:iso(at),
      managerPersonId,organizationId
    });
    const decision=evaluate(managerRequest,saved,{now:iso(at),
      challenge,proof:managerProof,timeAssurance:'LOCAL_BEST_EFFORT'});
    check(decision.allowed===true&&decision.outcome==='PERMITTED',
      'T3_EMPLOYEE_TASK_MANAGER_NOT_AUTHORIZED');
    const ttlSeconds=Math.min(authority.maxTtlSeconds,86400,
      Math.floor((timestamp(enrolled.workGrant.payload.expiresAt)-at)/1000),
      Math.floor((timestamp(manager.expiresAt)-at)/1000),
      Math.floor((timestamp(issuerKey.expiresAt)-at)/1000));
    check(ttlSeconds>0,'T3_EMPLOYEE_TASK_GRANT_EXPIRY');
    const grantId='grant:'+randomUUID();
    const grant=coreGrant(saved,{id:grantId,organization:org,
      employeePersonId,holderId:managerPersonId,roleId:'assigner',
      rightClass:'DATA',resources,actions:['package.export'],
      purposes:['assignment'],ttlSeconds,enrollmentId,now:at,
      credentialKeyId:enrolled.credentialPublicKeyRef,
      employeeProofDigest:'task-grant-manager-proof',
      evidenceRefs:['employee-enrollment:'+enrollmentId,
        'task-recipient:'+employeePersonId,
        'employee-credential:'+enrolled.credentialPublicKeyRef,
        'manager-approval:'+digest(decision)]});
    const signed=signRecord(grant,issuerSigner);
    try{verifyRecord(signed,saved.policy,at,'GRANT');}
    catch{refuse('T3_EMPLOYEE_TASK_GRANT_ISSUER_SIGNATURE_INVALID');}
    const next=copy(saved),authorityId=org.issuerAuthorityId;
    next.grants[grant.id]=signed;
    const prior=next.statuses[authorityId].payload;
    const sequence=prior.sequence+1;
    const validUntil=Math.min(at+saved.policy.offlineMaxAgeSeconds*1000,
      timestamp(issuerKey.expiresAt));
    check(validUntil>at,'T3_EMPLOYEE_TASK_STATUS_WINDOW_INVALID');
    next.statuses[authorityId]=signRecord({...prior,
      id:'status:'+randomUUID(),sequence,issuedAt:iso(at),
      validUntil:iso(validUntil),
      entries:[...prior.entries,{grantId:grant.id,state:'ACTIVE',
        effectiveAt:iso(at),evidenceRef:'employee-enrollment:'+enrollmentId}]
        .sort((a,b)=>a.grantId.localeCompare(b.grantId))
    },issuerSigner);
    next.statusFloor[authorityId]=sequence;
    // From this point a lost response can follow the original Kernel write.
    // NEVER automatically issue a replacement under another grant ID.
    taskGrantAttempted=true;
    const kernelReceipt=await registry.commitSignedState(next);
    const readback=await readTaskGrant({
      organizationId,employeePersonId,enrollmentId,managerPersonId});
    check(readback.state==='ORIGINAL_MANAGER_TASK_DATA_ACTIVE'&&
      readback.grantId===grantId&&readback.statusSequence===sequence,
      'T3_EMPLOYEE_TASK_GRANT_ORIGINAL_READBACK_UNKNOWN');
    // Another DIFFERENT employee can now be served by this same Host.
    // The same enrollment is still protected by original saved grant history.
    taskGrantAttempted=false;
    return Object.freeze({...readback,kernelReceipt,
      taskSigned:false,taskDelivered:false});
  }

  // The four baseline permissions and optional return-export permission
  // are existing original AccessRegistry grants. The
  // employee's work.prepare or package.export NEVER implies these T2 rights.
  // Use a distinct evidence marker: the original two-grant enrollment
  // reconstruction remains unchanged and survives cold compatibility.
  const workspaceRights=Object.freeze([
    {key:'readAccess',rightClass:'DATA',action:'workspace.read',
      purpose:'workspace.read'},
    {key:'writeAccess',rightClass:'ACTION',action:'object.write',
      purpose:'workspace.work'},
    {key:'createAccess',rightClass:'ACTION',action:'workspace.create',
      purpose:'workspace.onboarding'},
    {key:'importAccess',rightClass:'ACTION',action:'workspace.exchange.import',
      purpose:'workspace.exchange.import'},
  ]);
  const returnExportRight=Object.freeze({key:'exportAccess',rightClass:'DATA',
    action:'workspace.exchange.export',purpose:'workspace.exchange.export'});
  const workspaceMarker=enrollmentId=>'employee-workspace-rights:'+enrollmentId;
  const relatedWorkspaceGrants=(saved,enrollmentId,employeePersonId)=>
    Object.values(saved.grants).filter(env=>
      env?.payload?.holderId===employeePersonId&&
      env.payload.principalId===pinnedOrganization.organizationId&&
      env.payload.authorityId===pinnedOrganization.issuerAuthorityId&&
      env.payload.evidenceRefs?.includes(workspaceMarker(enrollmentId)));
  function workspaceAttachment({spec,env,saved,enrolled,status,at}){
    const g=env.payload,memberId='member:'+spec.key+':'+enrolled.enrollmentId;
    const workspaceId=spec.workspaceId??trustedWorkspaceId;
    const org=pinnedOrganization,issuer=org.issuerAuthorityId;
    const membership=original('StaffMembership',{
      membershipId:memberId,organizationId:org.organizationId,
      personId:enrolled.employeePersonId,workspaceId,
      roleId:g.roleId,grantId:g.id,issuerAuthorityId:issuer,
      membershipEpoch:org.membershipEpoch,notBefore:g.notBefore,
      expiresAt:g.expiresAt,status:'ACTIVE',statusObservedAt:status.issuedAt,
      statusValidUntil:status.validUntil,
    });
    const binding=original('OrganizationGrant',{
      organizationId:org.organizationId,membershipId:memberId,
      grantId:g.id,authorityId:issuer,realmId:org.realmId,
      holderPersonId:enrolled.employeePersonId,roleId:g.roleId,
      membershipEpoch:org.membershipEpoch,
      resources:g.resources,actions:g.actions,purposes:g.purposes,
      notBefore:g.notBefore,expiresAt:g.expiresAt,
      signedEnvelopeDigest:digest(env),
    });
    const credential=original('AdminIssuedCredential',{
      credentialId:'credential:'+spec.key+':'+enrolled.credentialPublicKeyRef,
      organizationId:org.organizationId,membershipId:memberId,
      issuerAuthorityId:issuer,holderPersonId:enrolled.employeePersonId,
      publicKeyRef:enrolled.credentialPublicKeyRef,custody:'HOLDER_ORG_SCOPED',
      personalKeySource:false,notBefore:g.notBefore,expiresAt:g.expiresAt,
      status:'ACTIVE',
    });
    const enrollment=signOrganizationEnrollment({
      schema:'IWXA_T3_ORGANIZATION_ENROLLMENT_CLAIMS/1',
      organizationId:org.organizationId,realmId:org.realmId,
      issuerAuthorityId:issuer,personId:enrolled.employeePersonId,
      workspaceId,membershipId:memberId,
      credentialId:credential.credentialId,
      credentialPublicKeyRef:enrolled.credentialPublicKeyRef,
      grantId:g.id,signedGrantDigest:digest(env),
      organizationDataRootId:org.organizationDataRootId,
      membershipEpoch:org.membershipEpoch,issuedAt:g.issuedAt,
      notBefore:g.notBefore,expiresAt:g.expiresAt,
    },issuerSigner);
    verifyOrganizationEnrollment(enrollment,saved,org,at);
    return Object.freeze({grantId:g.id,membership,binding,
      credential,enrollment});
  }
  async function readWorkspaceGrantSet({organizationId,employeePersonId,
    enrollmentId}={}){
    id(organizationId);id(employeePersonId);id(enrollmentId);
    check(organizationId===pinnedOrganization.organizationId,
      'T3_EMPLOYEE_WORKSPACE_SCOPE_CHANGED');
    const at=now(),saved=await state();
    return workspaceGrantReadback({organizationId,employeePersonId,enrollmentId,saved,at});
  }
  function workspaceGrantReadback({organizationId,employeePersonId,enrollmentId,saved,at}){
    const enrolled=reconstruct({saved,employeePersonId,enrollmentId,at});
    const rows=relatedWorkspaceGrants(saved,enrollmentId,employeePersonId);
    const base={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS/1',
      organizationId,employeePersonId,enrollmentId,
      workspaceId:trustedWorkspaceId,originalReadback:true,
      safeToReissue:false};
    if(rows.length===0)return Object.freeze({
      ...base,state:'ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_NOT_FOUND',
      returnExportAvailable:false});
    // Old four-grant enrollments remain valid. A fifth row is accepted only
    // if it is the exact separately signed Workspace export DATA right.
    const hasReturnExport=rows.length===workspaceRights.length+1;
    check(rows.length===workspaceRights.length||hasReturnExport,
      'T3_EMPLOYEE_WORKSPACE_SIGNED_GRANT_SET_INCOMPLETE');
    const specs=hasReturnExport?[...workspaceRights,returnExportRight]:workspaceRights;
    const status=validateStatusSnapshot(pinnedOrganization.issuerAuthorityId,
      saved,at);
    const attachments={};
    const ids=new Set();
    for(const spec of specs){
      const match=rows.filter(row=>{
        const g=row.payload;
        return g.actions?.length===1&&g.actions[0]===spec.action;
      });
      check(match.length===1,
        'T3_EMPLOYEE_WORKSPACE_SIGNED_GRANT_SET_CHANGED');
      const env=match[0],g=env.payload;
      check(!ids.has(g.id)&&g.rightClass===spec.rightClass&&
        g.roleId==='worker'&&g.purposes.length===1&&
        g.purposes[0]===spec.purpose&&
        g.resources.length===1&&g.resources[0]===trustedWorkspaceId&&
        env.keyId===issuerSigner.keyId&&
        !g.evidenceRefs.includes('employee-enrollment:'+enrollmentId),
        'T3_EMPLOYEE_WORKSPACE_SIGNED_GRANT_SCOPE_CHANGED');
      ids.add(g.id);
      verifyRecord(env,saved.policy,at,'GRANT');
      verifiedChain(g.id,saved,at);
      check(status.entries.some(item=>item.grantId===g.id&&
        item.state==='ACTIVE')&&!hasRecordedTombstone(saved,g.id),
        'T3_EMPLOYEE_WORKSPACE_RIGHT_REVOKED_OR_UNKNOWN');
      attachments[spec.key]=workspaceAttachment({
        spec,env,saved,enrolled,status,at});
    }
    return Object.freeze({...base,state:'ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE',
      statusSequence:status.sequence,grantIds:Object.freeze([...ids]),
      returnExportAvailable:hasReturnExport,
      attachments:Object.freeze(attachments)});
  }
  let workspaceRightsAttempted=false;
  async function issueWorkspaceGrantSet({organizationId,employeePersonId,
    enrollmentId,managerPersonId,managerGrantId,confirmed=false,returnExport=false}={}){
    check(confirmed===true,'T3_EMPLOYEE_WORKSPACE_EXPLICIT_APPROVAL_REQUIRED');
    check(typeof returnExport==='boolean','T3_EMPLOYEE_WORKSPACE_RETURN_EXPORT_OPTION_INVALID');
    check(!workspaceRightsAttempted,
      'T3_EMPLOYEE_WORKSPACE_OUTCOME_UNKNOWN_READBACK');
    id(organizationId);id(employeePersonId);id(enrollmentId);
    id(managerPersonId);id(managerGrantId);
    check(organizationId===pinnedOrganization.organizationId&&
      employeePersonId!==managerPersonId,
      'T3_EMPLOYEE_WORKSPACE_TRUSTED_SCOPE_REQUIRED');
    const at=now(),saved=await state(),org=pinnedOrganization;
    const enrolled=reconstruct({saved,employeePersonId,enrollmentId,at});
    const existing=relatedWorkspaceGrants(saved,enrollmentId,employeePersonId);
    let requested=returnExport?[...workspaceRights,returnExportRight]:workspaceRights;
    if(existing.length!==0){
      check(returnExport&&existing.length===workspaceRights.length,
        'T3_EMPLOYEE_WORKSPACE_RIGHTS_EXIST_USE_READBACK');
      // Upgrade an intact historical set from the same registry snapshot.
      // Never replace baseline rights or sign an implicit export right.
      const prior=workspaceGrantReadback({organizationId,employeePersonId,
        enrollmentId,saved,at});
      check(prior.state==='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE'&&
        prior.returnExportAvailable===false,
        'T3_EMPLOYEE_WORKSPACE_RIGHTS_EXIST_USE_READBACK');
      requested=[returnExportRight];
    }
    const authority=saved.policy.authorities[org.issuerAuthorityId];
    check(authority?.principalId===organizationId&&
      authority.roles.includes('worker')&&
      authority.resources.includes(trustedWorkspaceId)&&
      requested.every(spec=>
        authority.rightClasses.includes(spec.rightClass)&&
        authority.actions.includes(spec.action)&&
        authority.purposes.includes(spec.purpose)&&
        saved.policy.actionCatalog[spec.action]===spec.rightClass),
      'T3_EMPLOYEE_WORKSPACE_RIGHTS_POLICY_CEILING_REQUIRED');
    const manager=saved.grants[managerGrantId]?.payload;
    check(manager?.holderId===managerPersonId&&
      manager.principalId===organizationId&&
      manager.authorityId===org.issuerAuthorityId&&
      manager.rightClass==='ADMINISTRATION'&&
      manager.actions.includes('grant.issue')&&
      manager.resources.includes('authority:'+org.issuerAuthorityId),
      'T3_EMPLOYEE_WORKSPACE_MANAGER_GRANT_REQUIRED');
    const issuerKey=saved.policy.keys[issuerSigner.keyId];
    check(issuerKey?.status==='ACTIVE'&&
      issuerKey.uses.includes('GRANT')&&issuerKey.uses.includes('STATUS')&&
      timestamp(issuerKey.notBefore)<=at&&at<timestamp(issuerKey.expiresAt),
      'T3_EMPLOYEE_WORKSPACE_ISSUER_NOT_ACTIVE');
    const request={
      id:'employee-workspace-grants:'+randomUUID(),
      actorId:managerPersonId,principalId:organizationId,
      roleId:manager.roleId,grantId:managerGrantId,
      audience:manager.audience,resource:'authority:'+org.issuerAuthorityId,
      action:'grant.issue',purpose:'access-administration',
      realmId:org.realmId,
      operationDigest:digest({schema:'IWXA_T3_ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_INTENT/1',
        organizationId,employeePersonId,enrollmentId,
        managerPersonId,managerGrantId,
        workGrantId:enrolled.grantIds.work,
        existingGrantIds:existing.map(row=>row.payload.id).sort(),
        rights:requested.map(x=>[x.action,x.purpose,x.rightClass])}),
    };
    const challenge=randomUUID()+randomUUID();
    const proof=await proveManager({request:copy(request),challenge,
      asOf:iso(at),managerPersonId,organizationId});
    const decision=evaluate(request,saved,{
      now:iso(at),challenge,proof,timeAssurance:'LOCAL_BEST_EFFORT'});
    check(decision.allowed===true&&decision.outcome==='PERMITTED',
      'T3_EMPLOYEE_WORKSPACE_MANAGER_NOT_AUTHORIZED');
    const ttlSeconds=Math.min(authority.maxTtlSeconds,86400,
      Math.floor((timestamp(enrolled.workGrant.payload.expiresAt)-at)/1000),
      Math.floor((timestamp(manager.expiresAt)-at)/1000),
      Math.floor((timestamp(issuerKey.expiresAt)-at)/1000));
    check(ttlSeconds>0,'T3_EMPLOYEE_WORKSPACE_GRANT_EXPIRY');
    const next=copy(saved),authorityId=org.issuerAuthorityId;
    const granted=[];
    for(const spec of requested){
      const grant=coreGrant(saved,{
        id:'grant:'+randomUUID(),organization:org,
        employeePersonId,roleId:'worker',
        rightClass:spec.rightClass,actions:[spec.action],
        purposes:[spec.purpose],resources:[trustedWorkspaceId],
        ttlSeconds,enrollmentId,now:at,
        credentialKeyId:enrolled.credentialPublicKeyRef,
        employeeProofDigest:'workspace-grants-manager-proof',
        evidenceRefs:[workspaceMarker(enrollmentId),
          'employee-credential:'+enrolled.credentialPublicKeyRef,
          'manager-approval:'+digest(decision)],
      });
      const signed=signRecord(grant,issuerSigner);
      verifyRecord(signed,saved.policy,at,'GRANT');
      next.grants[grant.id]=signed;
      granted.push(grant);
    }
    const prior=next.statuses[authorityId].payload,sequence=prior.sequence+1;
    const until=Math.min(at+saved.policy.offlineMaxAgeSeconds*1000,
      timestamp(issuerKey.expiresAt));
    check(until>at,'T3_EMPLOYEE_WORKSPACE_STATUS_WINDOW_INVALID');
    next.statuses[authorityId]=signRecord({...prior,
      id:'status:'+randomUUID(),sequence,
      issuedAt:iso(at),validUntil:iso(until),
      entries:[...prior.entries,...granted.map(g=>({
        grantId:g.id,state:'ACTIVE',effectiveAt:iso(at),
        evidenceRef:workspaceMarker(enrollmentId),
      }))].sort((a,b)=>a.grantId.localeCompare(b.grantId)),
    },issuerSigner);
    next.statusFloor[authorityId]=sequence;
    // The original signed-registry Kernel commit is the only write. If its
    // reply is lost, this process will refuse reissue until cold readback.
    workspaceRightsAttempted=true;
    const kernelReceipt=await registry.commitSignedState(next);
    const recovered=await readWorkspaceGrantSet({
      organizationId,employeePersonId,enrollmentId});
    check(recovered.state==='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE'&&
      recovered.statusSequence===sequence&&
      recovered.returnExportAvailable===returnExport&&
      granted.every(g=>recovered.grantIds.includes(g.id)),
      'T3_EMPLOYEE_WORKSPACE_RIGHTS_ORIGINAL_READBACK_UNKNOWN');
    workspaceRightsAttempted=false;
    return Object.freeze({...recovered,kernelReceipt});
  }

  // The first T4 pilot is an additive grant set for ONE already enrolled
  // worker. Its immutable scope was explicitly signed at organization
  // bootstrap. Use the existing issuer, proof, STATUS and Registry CAS.
  const pilot=networkPilot===null?null:(()=>{
    check(networkPilot&&typeof networkPilot.requiredNetworkActions==='function',
      'T3_EMPLOYEE_T4_PILOT_CONFIGURATION_REQUIRED');
    const scope={workspaceId:trustedWorkspaceId,
      sourceTechnicalWorkspaceId:id(networkPilot.sourceTechnicalWorkspaceId),
      recipientTechnicalWorkspaceId:id(networkPilot.recipientTechnicalWorkspaceId)};
    check(new Set(Object.values(scope)).size===3&&
      !Object.values(scope).slice(1).some(x=>x.startsWith('workspace:registry:')),
      'T3_EMPLOYEE_T4_PILOT_SCOPE_INVALID');
    const required=role=>{
      const actions=networkPilot.requiredNetworkActions({role,enableSourceEventWindowRead:true,
        enableRecipientResultRead:true});
      check(Array.isArray(actions)&&actions.length>0&&actions.length<=32&&
        new Set(actions).size===actions.length&&actions.every(x=>typeof x==='string'&&
          x.startsWith('t4.network.')&&x!=='t4.network.key.manage'),
        'T3_EMPLOYEE_T4_PILOT_ACTIONS_INVALID');
      actions.forEach(id);return Object.freeze([...actions]);
    };
    return Object.freeze({scope:Object.freeze(scope),
      marker:'t4-pilot-scope:'+digest(scope),recipientActions:required('RECIPIENT'),
      specs:Object.freeze([
        {key:'networkAccess',workspaceId:trustedWorkspaceId,rightClass:'ACTION',
          actions:required('SOURCE'),purpose:'network.synchronization'},
        {key:'technicalReadAccess',workspaceId:scope.sourceTechnicalWorkspaceId,
          rightClass:'DATA',actions:['workspace.read'],purpose:'workspace.read'},
        {key:'technicalWriteAccess',workspaceId:scope.sourceTechnicalWorkspaceId,
          rightClass:'ACTION',actions:['object.write'],purpose:'workspace.work'}
      ])});
  })();
  const t4Marker=enrollmentId=>'employee-t4-rights:'+enrollmentId;
  const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&
    new Set(a).size===a.length&&a.every(x=>b.includes(x));
  function assertPilot(saved,at){
    check(pilot!==null,'T3_EMPLOYEE_T4_PILOT_CONFIGURATION_REQUIRED');
    const org=pinnedOrganization,authority=saved.policy.authorities[org.issuerAuthorityId];
    const status=validateStatusSnapshot(org.issuerAuthorityId,saved,at);
    const checks=[
      ['grant:t4-recipient-network',pilot.scope.workspaceId,'ACTION',pilot.recipientActions,'network.synchronization'],
      ['grant:t4-recipient-technical-read',pilot.scope.recipientTechnicalWorkspaceId,'DATA',['workspace.read'],'workspace.read'],
      ['grant:t4-recipient-technical-write',pilot.scope.recipientTechnicalWorkspaceId,'ACTION',['object.write'],'workspace.work']
    ];
    for(const [grantId,ws,rightClass,actions,purpose] of checks){
      const envelope=saved.grants[grantId],g=envelope?.payload;
      check(g&&g.principalId===org.organizationId&&g.authorityId===org.issuerAuthorityId&&
        g.roleId==='reviewer'&&g.rightClass===rightClass&&
        sameSet(g.resources,[ws])&&sameSet(g.actions,actions)&&sameSet(g.purposes,[purpose])&&
        g.evidenceRefs.includes('ceremony:explicit-t4-pilot')&&g.evidenceRefs.includes(pilot.marker)&&
        envelope.keyId===issuerSigner.keyId,
        'T3_EMPLOYEE_T4_PILOT_BOOTSTRAP_MISMATCH');
      verifiedChain(grantId,saved,at);
      check(status.entries.some(e=>e.grantId===grantId&&e.state==='ACTIVE')&&
        !hasRecordedTombstone(saved,grantId),'T3_EMPLOYEE_T4_PILOT_BOOTSTRAP_INACTIVE');
    }
    check(authority&&pilot.specs.every(s=>authority.resources.includes(s.workspaceId)&&
      authority.purposes.includes(s.purpose)&&authority.rightClasses.includes(s.rightClass)&&
      s.actions.every(a=>authority.actions.includes(a)&&saved.policy.actionCatalog[a]===s.rightClass)),
      'T3_EMPLOYEE_T4_PILOT_POLICY_CEILING_REQUIRED');
    return status;
  }
  function networkGrantReadback({organizationId,employeePersonId,enrollmentId,saved,at}){
    check(organizationId===pinnedOrganization.organizationId,'T3_EMPLOYEE_T4_PILOT_SCOPE_INVALID');
    const status=assertPilot(saved,at);
    const enrolled=reconstruct({saved,employeePersonId,enrollmentId,at});
    const baseline=workspaceGrantReadback({organizationId,employeePersonId,enrollmentId,saved,at});
    check(baseline.state==='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE',
      'T3_EMPLOYEE_T4_WORKSPACE_RIGHTS_REQUIRED');
    const all=Object.values(saved.grants).filter(e=>e.payload.authorityId===pinnedOrganization.issuerAuthorityId&&
      e.payload.principalId===organizationId&&e.payload.evidenceRefs.includes(pilot.marker)&&
      e.payload.evidenceRefs.some(x=>x.startsWith('employee-t4-rights:')));
    check(all.every(e=>e.payload.holderId===employeePersonId&&e.payload.evidenceRefs.includes(t4Marker(enrollmentId))),
      'T3_EMPLOYEE_T4_OTHER_SOURCE_ALREADY_ENROLLED');
    const base={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_T4_RIGHTS/1',organizationId,employeePersonId,
      enrollmentId,scope:copy(pilot.scope),originalReadback:true,safeToReissue:false};
    if(all.length===0)return Object.freeze({...base,state:'ORIGINAL_EMPLOYEE_T4_RIGHTS_NOT_FOUND'});
    check(all.length===pilot.specs.length,'T3_EMPLOYEE_T4_SIGNED_GRANT_SET_INCOMPLETE');
    const attachments={},ids=[];
    for(const spec of pilot.specs){
      const match=all.filter(e=>sameSet(e.payload.actions,spec.actions)&&
        sameSet(e.payload.resources,[spec.workspaceId])&&sameSet(e.payload.purposes,[spec.purpose]));
      check(match.length===1,'T3_EMPLOYEE_T4_SIGNED_GRANT_SCOPE_CHANGED');
      const env=match[0],g=env.payload;
      check(g.roleId==='worker'&&g.rightClass===spec.rightClass&&env.keyId===issuerSigner.keyId&&
        g.evidenceRefs.includes('employee-credential:'+enrolled.credentialPublicKeyRef)&&
        !g.evidenceRefs.includes('employee-enrollment:'+enrollmentId)&&
        !ids.includes(g.id),'T3_EMPLOYEE_T4_SIGNED_GRANT_SCOPE_CHANGED');
      verifiedChain(g.id,saved,at);
      check(status.entries.some(e=>e.grantId===g.id&&e.state==='ACTIVE')&&
        !hasRecordedTombstone(saved,g.id),'T3_EMPLOYEE_T4_RIGHT_REVOKED_OR_UNKNOWN');
      ids.push(g.id);attachments[spec.key]=workspaceAttachment({spec,env,saved,enrolled,status,at});
    }
    return Object.freeze({...base,state:'ORIGINAL_EMPLOYEE_T4_RIGHTS_ACTIVE',
      statusSequence:status.sequence,grantIds:Object.freeze(ids),attachments:Object.freeze(attachments)});
  }
  async function readNetworkGrantSet({organizationId,employeePersonId,enrollmentId}={}){
    [organizationId,employeePersonId,enrollmentId].forEach(id);
    return networkGrantReadback({organizationId,employeePersonId,enrollmentId,saved:await state(),at:now()});
  }
  let networkRightsAttempted=false;
  async function issueNetworkGrantSet({organizationId,employeePersonId,enrollmentId,
    managerPersonId,managerGrantId,confirmed=false}={}){
    check(confirmed===true,'T3_EMPLOYEE_T4_EXPLICIT_APPROVAL_REQUIRED');
    check(!networkRightsAttempted,'T3_EMPLOYEE_T4_OUTCOME_UNKNOWN_READBACK');
    [organizationId,employeePersonId,enrollmentId,managerPersonId,managerGrantId].forEach(id);
    check(employeePersonId!==managerPersonId,'T3_EMPLOYEE_T4_INDEPENDENT_SOURCE_REQUIRED');
    const saved=await state(),at=now(),org=pinnedOrganization,authorityId=org.issuerAuthorityId;
    const args={organizationId,employeePersonId,enrollmentId};
    check(networkGrantReadback({...args,saved,at}).state==='ORIGINAL_EMPLOYEE_T4_RIGHTS_NOT_FOUND',
      'T3_EMPLOYEE_T4_RIGHTS_EXIST_USE_READBACK');
    const enrolled=reconstruct({saved,employeePersonId,enrollmentId,at});
    const authority=saved.policy.authorities[authorityId],manager=saved.grants[managerGrantId]?.payload;
    const issuerKey=saved.policy.keys[issuerSigner.keyId],credential=saved.policy.keys[enrolled.credentialPublicKeyRef];
    check(manager?.holderId===managerPersonId&&manager.principalId===organizationId&&
      manager.authorityId===authorityId&&manager.rightClass==='ADMINISTRATION'&&
      manager.actions.includes('grant.issue')&&manager.resources.includes('authority:'+authorityId)&&
      issuerKey?.status==='ACTIVE'&&issuerKey.uses.includes('GRANT')&&issuerKey.uses.includes('STATUS')&&
      credential?.status==='ACTIVE','T3_EMPLOYEE_T4_MANAGER_OR_ISSUER_REQUIRED');
    const request={id:'employee-t4-grants:'+randomUUID(),actorId:managerPersonId,
      principalId:organizationId,roleId:manager.roleId,grantId:managerGrantId,audience:manager.audience,
      resource:'authority:'+authorityId,action:'grant.issue',purpose:'access-administration',realmId:org.realmId,
      operationDigest:digest({schema:'IWXA_T3_EMPLOYEE_T4_RIGHTS_INTENT/1',...args,
        scope:pilot.scope,rights:pilot.specs,workGrantId:enrolled.grantIds.work,managerGrantId})};
    const challenge=randomUUID()+randomUUID(),proof=await proveManager({request:copy(request),challenge,
      asOf:iso(at),managerPersonId,organizationId});
    const decision=evaluate(request,saved,{now:iso(at),challenge,proof,timeAssurance:'LOCAL_BEST_EFFORT'});
    check(decision.allowed===true&&decision.outcome==='PERMITTED','T3_EMPLOYEE_T4_MANAGER_NOT_AUTHORIZED');
    const ttlSeconds=Math.min(authority.maxTtlSeconds,86400,
      ...[enrolled.workGrant.payload,manager,issuerKey,credential].map(x=>Math.floor((timestamp(x.expiresAt)-at)/1000)));
    check(ttlSeconds>0,'T3_EMPLOYEE_T4_GRANT_EXPIRY');
    const next=copy(saved),granted=[];
    for(const spec of pilot.specs){
      const g=coreGrant(saved,{id:'grant:'+randomUUID(),organization:org,employeePersonId,roleId:'worker',
        rightClass:spec.rightClass,actions:[...spec.actions],purposes:[spec.purpose],resources:[spec.workspaceId],
        ttlSeconds,enrollmentId,now:at,credentialKeyId:enrolled.credentialPublicKeyRef,
        evidenceRefs:[t4Marker(enrollmentId),pilot.marker,'employee-credential:'+enrolled.credentialPublicKeyRef,
          'manager-approval:'+digest(decision)]});
      const env=signRecord(g,issuerSigner);verifyRecord(env,saved.policy,at,'GRANT');
      next.grants[g.id]=env;granted.push(g.id);
    }
    const prior=saved.statuses[authorityId].payload,sequence=prior.sequence+1;
    const until=Math.min(at+saved.policy.offlineMaxAgeSeconds*1000,timestamp(issuerKey.expiresAt));
    check(until>at,'T3_EMPLOYEE_T4_STATUS_WINDOW_INVALID');
    next.statuses[authorityId]=signRecord({...prior,id:'status:'+randomUUID(),sequence,issuedAt:iso(at),
      validUntil:iso(until),entries:[...prior.entries,...granted.map(grantId=>({
        grantId,state:'ACTIVE',effectiveAt:iso(at),evidenceRef:t4Marker(enrollmentId)
      }))].sort((a,b)=>a.grantId.localeCompare(b.grantId))},issuerSigner);
    next.statusFloor[authorityId]=sequence;
    networkRightsAttempted=true;
    const kernelReceipt=await registry.commitSignedState(next,{expectedStateDigest:digest(saved)});
    const recovered=await readNetworkGrantSet(args);
    check(recovered.state==='ORIGINAL_EMPLOYEE_T4_RIGHTS_ACTIVE'&&recovered.statusSequence===sequence&&
      sameSet(recovered.grantIds,granted),'T3_EMPLOYEE_T4_ORIGINAL_READBACK_UNKNOWN');
    networkRightsAttempted=false;
    return Object.freeze({...recovered,kernelReceipt});
  }


  // First-device enrollment, composed over the already issued pilot grants.
  // Only public key material enters the issuer; the private key stays on
  // its device. Original Registry owns both commit and ambiguous ACK recovery.
  let pendingNetworkKey=null,networkKeyCommitUnknown=false;
  async function beginNetworkKeyEnrollment({organizationId,employeePersonId,enrollmentId,managerPersonId,
    role,keyUse,route,keyId,publicKey,confirmed=false}={}){
    check(confirmed===true,'T3_EMPLOYEE_T4_KEY_EXPLICIT_APPROVAL_REQUIRED');
    check(!networkKeyCommitUnknown,'T3_EMPLOYEE_T4_KEY_OUTCOME_UNKNOWN_READBACK');
    const at=now();
    check(!pendingNetworkKey||at>=timestamp(pendingNetworkKey.claims.issuedAt)+60000,
      'T3_EMPLOYEE_T4_KEY_CHALLENGE_PENDING');
    check(['SOURCE','RECIPIENT'].includes(role)&&['NETWORK_FRAME','NETWORK_AGREEMENT'].includes(keyUse)&&
      (role==='RECIPIENT'||keyUse==='NETWORK_FRAME')&&route&&
      Object.keys(route).sort().join()===['sourceNodeRef','recipientNodeRef','originalWriteOwnerRef','scopeRef','ownerEpoch'].sort().join()&&
      Number.isSafeInteger(route.ownerEpoch)&&route.ownerEpoch>=1&&route.sourceNodeRef!==route.recipientNodeRef&&
      typeof publicKey==='string'&&publicKey.length<=4096,'T3_EMPLOYEE_T4_KEY_ROUTE_INVALID');
    [organizationId,employeePersonId,enrollmentId,managerPersonId,keyId,route.sourceNodeRef,
      route.recipientNodeRef,route.originalWriteOwnerRef,route.scopeRef].forEach(id);
    const delivery=await registry.readRegistryDelivery(),saved=delivery.record.data,org=pinnedOrganization;
    const rights=networkGrantReadback({organizationId,employeePersonId,enrollmentId,saved,at});
    check(rights.state==='ORIGINAL_EMPLOYEE_T4_RIGHTS_ACTIVE','T3_EMPLOYEE_T4_KEY_NETWORK_RIGHTS_REQUIRED');
    const authorityId=org.issuerAuthorityId,authority=saved.policy.authorities[authorityId],
      manager=saved.grants['grant:t4-key-manage']?.payload,issuerKey=saved.policy.keys[issuerSigner.keyId],
      recipient=saved.grants['grant:t4-recipient-network']?.payload;
    check(manager&&recipient&&manager.holderId===managerPersonId&&recipient.holderId===managerPersonId&&
      managerPersonId!==employeePersonId&&manager.principalId===organizationId&&manager.authorityId===authorityId&&
      manager.rightClass==='ADMINISTRATION'&&sameSet(manager.resources,[trustedWorkspaceId])&&
      sameSet(manager.actions,[ORIGINAL_NETWORK_KEY_MANAGE])&&sameSet(manager.purposes,['access-administration'])&&
      manager.evidenceRefs.includes(pilot.marker)&&issuerKey?.status==='ACTIVE'&&
      authority.statusKeys.includes(issuerSigner.keyId),'T3_EMPLOYEE_T4_KEY_MANAGER_REQUIRED');
    verifiedChain(manager.id,saved,at);
    const status=validateStatusSnapshot(authorityId,saved,at);
    check(status.entries.some(e=>e.grantId===manager.id&&e.state==='ACTIVE')&&!hasRecordedTombstone(saved,manager.id),
      'T3_EMPLOYEE_T4_KEY_MANAGER_INACTIVE');
    const sourceGrant=saved.grants[rights.attachments.networkAccess.grantId].payload,
      selected=role==='SOURCE'?sourceGrant:recipient;
    const binding={subjectId:selected.holderId,permissionRef:selected.id,keyId,
      nodeRef:role==='SOURCE'?route.sourceNodeRef:route.recipientNodeRef,
      recipientNodeRef:role==='SOURCE'?route.recipientNodeRef:route.sourceNodeRef,
      workspaceId:trustedWorkspaceId,originalWriteOwnerRef:route.originalWriteOwnerRef,
      scopeRef:route.scopeRef,ownerEpoch:route.ownerEpoch,generation:1,keyUse};
    binding.bindingRef='binding:t4-pilot:'+digest({subjectId:binding.subjectId,permissionRef:binding.permissionRef,
      nodeRef:binding.nodeRef,recipientNodeRef:binding.recipientNodeRef,workspaceId:binding.workspaceId,
      originalWriteOwnerRef:binding.originalWriteOwnerRef,scopeRef:binding.scopeRef,ownerEpoch:binding.ownerEpoch,keyUse});
    // A first pilot has one route, one frame key per role and one recipient
    // agreement key. Never create a new route or re-enroll a retired slot.
    for(const event of delivery.events){
      const c=event.payload?.network_key_transition?.transition?.claims;
      if(!c||c.authorityId!==authorityId||c.binding.workspaceId!==trustedWorkspaceId)continue;
      const b=c.binding,source=b.subjectId===employeePersonId&&b.permissionRef===sourceGrant.id,
        target=b.subjectId===managerPersonId&&b.permissionRef===recipient.id;
      check((source||target)&&b.nodeRef===(source?route.sourceNodeRef:route.recipientNodeRef)&&
        b.recipientNodeRef===(source?route.recipientNodeRef:route.sourceNodeRef)&&
        b.originalWriteOwnerRef===route.originalWriteOwnerRef&&b.scopeRef===route.scopeRef&&b.ownerEpoch===route.ownerEpoch,
        'T3_EMPLOYEE_T4_KEY_ROUTE_ALREADY_BOUND');
      check(b.bindingRef!==binding.bindingRef,'T3_EMPLOYEE_T4_KEY_EXISTS_USE_READBACK');
    }
    check(!Object.hasOwn(saved.policy.keys,keyId),'T3_EMPLOYEE_T4_KEY_ID_EXISTS');
    const until=Math.min(at+authority.maxTtlSeconds*1000,
      ...[sourceGrant,recipient,manager,issuerKey].map(k=>timestamp(k.expiresAt)));
    check(until>at,'T3_EMPLOYEE_T4_KEY_EXPIRY');
    const claims={schema:ORIGINAL_NETWORK_KEY_TRANSITION,kind:'ENROLL',transitionRef:'transition:t4-pilot:'+randomUUID(),
      authorityId,principalId:organizationId,previousPolicyDigest:digest(saved.policy),
      registryWorkspaceId:delivery.record.workspace_id,registryObjectId:delivery.record.object_id,
      rootPolicyDigest:digest(delivery.rootPolicy),expectedStatusSequence:saved.statusFloor[authorityId],
      previousBindingDigest:null,issuedAt:iso(at),binding,keyRecord:{subjectId:binding.subjectId,
        environment:saved.policy.environment,publicKey,status:'ACTIVE',uses:[keyUse],notBefore:iso(at),expiresAt:iso(until)}};
    const agreement=keyUse==='NETWORK_AGREEMENT'?createOriginalNetworkAgreementChallenge(claims,{clock}):null;
    if(!agreement)originalNetworkKeyPossessionBytes(claims); // canonical shape and public key validation
    check(!pendingNetworkKey||now()>=timestamp(pendingNetworkKey.claims.issuedAt)+60000,
      'T3_EMPLOYEE_T4_KEY_CHALLENGE_PENDING');
    pendingNetworkKey={claims:copy(claims),agreement,managerPersonId,organizationId,
      employeePersonId,enrollmentId};
    return Object.freeze({claims:copy(claims),agreementChallenge:agreement?.challenge??null,privateKeyRequiredOnDevice:true});
  }
  async function completeNetworkKeyEnrollment({transitionRef,possessionSignature=null,agreementResponse=null,confirmed=false}={}){
    check(confirmed===true,'T3_EMPLOYEE_T4_KEY_EXPLICIT_APPROVAL_REQUIRED');
    const pending=pendingNetworkKey;
    check(pending&&pending.claims.transitionRef===transitionRef,'T3_EMPLOYEE_T4_KEY_CHALLENGE_NOT_FOUND');
    const at=now(),c=pending.claims;
    check(at>=timestamp(c.issuedAt)&&at-timestamp(c.issuedAt)<60000,'T3_EMPLOYEE_T4_KEY_CHALLENGE_EXPIRED');
    pendingNetworkKey=null;
    networkKeyCommitUnknown=true;
    let dispatched=false;
    try{
      let transition,evidence=null;
      if(pending.agreement){
        check(possessionSignature===null&&typeof agreementResponse==='string','T3_EMPLOYEE_T4_KEY_POSSESSION_REQUIRED');
        ({transition,evidence}=pending.agreement.verifyResponse(agreementResponse));
      }else{
        check(agreementResponse===null,'T3_EMPLOYEE_T4_KEY_POSSESSION_REQUIRED');
        transition=validateOriginalNetworkKeyTransition({claims:c,possessionSignature,agreementPossession:null});
      }
      const saved=await state(),org=pinnedOrganization;
      check(digest(saved.policy)===c.previousPolicyDigest&&saved.statusFloor[c.authorityId]===c.expectedStatusSequence,
        'T3_EMPLOYEE_T4_KEY_CHALLENGE_STALE');
      check(networkGrantReadback({...pending,saved,at}).state==='ORIGINAL_EMPLOYEE_T4_RIGHTS_ACTIVE',
        'T3_EMPLOYEE_T4_KEY_NETWORK_RIGHTS_REQUIRED');
      const manager=saved.grants['grant:t4-key-manage'].payload;
      const request={id:'request:'+transitionRef,actorId:pending.managerPersonId,principalId:pending.organizationId,
        roleId:manager.roleId,grantId:manager.id,audience:manager.audience,resource:trustedWorkspaceId,
        action:ORIGINAL_NETWORK_KEY_MANAGE,purpose:'access-administration',realmId:org.realmId,
        operationDigest:originalNetworkKeyOperationDigest(transition)};
      const challenge=randomUUID()+randomUUID(),proof=await proveManager({request:copy(request),challenge,
        asOf:iso(at),managerPersonId:pending.managerPersonId,organizationId:pending.organizationId});
      const decision=evaluate(request,saved,{now:iso(at),challenge,proof,timeAssurance:'LOCAL_BEST_EFFORT'});
      check(decision.allowed===true&&decision.outcome==='PERMITTED','T3_EMPLOYEE_T4_KEY_MANAGER_NOT_AUTHORIZED');
      const prior=saved.statuses[c.authorityId].payload;
      const signedStatus=signRecord({...prior,id:originalNetworkKeyStatusId(transition),
        sequence:c.expectedStatusSequence+1,issuedAt:c.issuedAt},issuerSigner);
      dispatched=true;
      const result=await registry.applyNetworkKeyTransition({transition,signedStatus,managerRequest:request,
        managerChallenge:challenge,managerProof:proof},evidence);
      networkKeyCommitUnknown=false;
      return result;
    }finally{if(!dispatched)networkKeyCommitUnknown=false;}
  }

  const corporateSeats=corporateSeatSource===null?null:createOriginalCorporateSeatOwner({
    registry,issuerSigner,proveManager,trustedOrganization:pinnedOrganization,clock,
    resolveEnrollment:reconstruct,readLicenseState:corporateSeatSource.read,
    installedTrust:corporateSeatSource.installedTrust});
  return Object.freeze({begin,complete,readEnrollment,cancelPending,
    issueTaskGrant,readTaskGrant,issueWorkspaceGrantSet,readWorkspaceGrantSet,
    ...(pilot?{issueNetworkGrantSet,readNetworkGrantSet,beginNetworkKeyEnrollment,completeNetworkKeyEnrollment}:{}),...(corporateSeats?{
      viewCorporateSeats:corporateSeats.view,changeCorporateSeat:corporateSeats.change,
      enableCorporateSeatPolicy:corporateSeats.enablePolicy,
      readCorporateSeatCommand:corporateSeats.readCommand}: {})});
}
