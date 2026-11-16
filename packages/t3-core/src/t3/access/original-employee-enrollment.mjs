// Original T3 D3 independent employee enrollment, TRUSTED HOST ONLY.
// No new registry, vault, Store, signing algorithm or .iwxa serializer.
// Only the existing T2 Kernel signed-registry port can persist authority.
// A second employee must own an independently pinned Ed25519 proof credential.
import {randomUUID} from 'node:crypto';
import {
  copy,digest,evaluate,iso,identifier,makeProof,signRecord,timestamp,
  validateGrant,validateStatusSnapshot,verifyRecord,checkCeiling,
  hasRecordedTombstone
} from './core.mjs';
import {isOriginalKernelRegistryStatePort} from './original-kernel-registry-state.mjs';
import {signOrganizationEnrollment,verifyOrganizationEnrollment}
  from './organizational-operation.mjs';
import {PRODUCT_CONTRACT_IDS,validateProductContract} from './product-contracts.mjs';

const refuse=code=>{const e=new Error(code);e.name='T3OriginalEmployeeEnrollmentError';e.code=code;throw e;};
const check=(ok,code)=>{if(!ok)refuse(code);};
const id=value=>{try{return identifier(value);}catch{refuse('T3_EMPLOYEE_ID_INVALID');}};
const hex=/^[a-f0-9]{64}$/;
const original=(kind,data)=>validateProductContract(kind,
  {kind,schema:PRODUCT_CONTRACT_IDS[kind],...data});
const receiptFields=['work','export'];
const prefix='T3_EMPLOYEE_ENROLLMENT_';
const audienceResource=({organizationId,workspaceId})=>[
  'workspace:'+workspaceId,'subject:'+organizationId,
  'recipient:'+organizationId,'field:result','operation:UPSERT'
];
const coreGrant=(state,{id:grantId,organization,employeePersonId,roleId,
  resources,actions,purposes,rightClass,ttlSeconds,enrollmentId,now})=>{
  const authority=state.policy.authorities[organization.issuerAuthorityId];
  const grant={
    kind:'GRANT',id:grantId,lineageId:grantId,renewalOf:null,
    parentGrantId:null,authorityId:organization.issuerAuthorityId,
    principalId:organization.organizationId,holderId:employeePersonId,
    roleId,rightClass,realmId:organization.realmId,
    environment:state.policy.environment,audience:authority.audiences[0],
    resources,actions,purposes,issuedAt:iso(now),notBefore:iso(now),
    expiresAt:iso(now+ttlSeconds*1000),remainingDepth:0,
    membershipEpoch:organization.membershipEpoch,policyId:state.policy.id,
    policyVersion:state.policy.version,
    evidenceRefs:['employee-enrollment:'+enrollmentId]
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
  registry,issuerSigner,proveManager,clock=Date.now
}={}){
  check(isOriginalKernelRegistryStatePort(registry)&&
    issuerSigner&&typeof issuerSigner.sign==='function'&&
    typeof issuerSigner.keyId==='string'&&typeof proveManager==='function'&&
    typeof clock==='function',
    'T3_EMPLOYEE_ORIGINAL_OWNER_REQUIRED');
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
      credential.status==='ACTIVE'&&credential.uses.includes('PROOF')&&
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
    const ttl=p.input.ttlSeconds,work=coreGrant(before,{
      id:p.grantIds.work,organization,employeePersonId:p.input.employeePersonId,
      roleId:'worker',ttlSeconds:ttl,enrollmentId,now:at,...required[0]});
    const exportGrant=coreGrant(before,{
      id:p.grantIds.export,organization,employeePersonId:p.input.employeePersonId,
      roleId:'worker',ttlSeconds:ttl,enrollmentId,now:at,...required[1]});
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
    const membershipId='member:'+enrollmentId;
    const credential=original('AdminIssuedCredential',{
      credentialId:'credential:'+p.input.credentialKeyId,
      organizationId:organization.organizationId,membershipId,
      issuerAuthorityId:authorityId,holderPersonId:p.input.employeePersonId,
      publicKeyRef:p.input.credentialKeyId,custody:'HOLDER_ORG_SCOPED',
      personalKeySource:false,notBefore:work.notBefore,expiresAt:work.expiresAt,
      status:'ACTIVE'});
    const membership=original('StaffMembership',{
      membershipId,organizationId:organization.organizationId,
      personId:p.input.employeePersonId,workspaceId:p.input.workspaceId,
      roleId:'worker',grantId:work.id,issuerAuthorityId:authorityId,
      membershipEpoch:organization.membershipEpoch,
      notBefore:work.notBefore,expiresAt:work.expiresAt,
      status:'ACTIVE',statusObservedAt:issuedAt,statusValidUntil:iso(expiry)});
    const binding=original('OrganizationGrant',{
      organizationId:organization.organizationId,membershipId,
      grantId:work.id,authorityId,realmId:organization.realmId,
      holderPersonId:p.input.employeePersonId,roleId:'worker',
      membershipEpoch:organization.membershipEpoch,
      resources:work.resources,actions:work.actions,purposes:work.purposes,
      notBefore:work.notBefore,expiresAt:work.expiresAt,
      signedEnvelopeDigest:digest(workSigned)});
    const enrollment=signOrganizationEnrollment({
      schema:'IWXA_T3_ORGANIZATION_ENROLLMENT_CLAIMS/1',
      organizationId:organization.organizationId,realmId:organization.realmId,
      issuerAuthorityId:authorityId,personId:p.input.employeePersonId,
      workspaceId:p.input.workspaceId,membershipId,
      credentialId:credential.credentialId,
      credentialPublicKeyRef:p.input.credentialKeyId,
      grantId:work.id,signedGrantDigest:digest(workSigned),
      organizationDataRootId:organization.organizationDataRootId,
      membershipEpoch:organization.membershipEpoch,
      issuedAt,notBefore:work.notBefore,expiresAt:work.expiresAt,
    },issuerSigner);
    verifyOrganizationEnrollment(enrollment,readback,organization,at);
    pending=null;
    return Object.freeze({
      state:'SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED',
      enrollmentId,organizationId:organization.organizationId,
      employeePersonId:p.input.employeePersonId,workspaceId:p.input.workspaceId,
      credentialPublicKeyRef:p.input.credentialKeyId,
      grantIds:{...p.grantIds},statusSequence:sequence,
      membership,credential,binding,enrollment,
      exportGrant:exportSigned,workGrant:workSigned,
      kernelReceipt:saved,
      originalSigned:true,invitationDelivered:false,
      automaticTransfer:false,productionActivation:false
    });
  }
  async function readEnrollment({organizationId,employeePersonId,enrollmentId}={}){
    id(organizationId);id(employeePersonId);id(enrollmentId);
    const at=now(),saved=await state(),matches=Object.entries(saved.grants)
      .filter(([,entry])=>entry.payload.authorityId &&
        entry.payload.principalId===organizationId&&
        entry.payload.holderId===employeePersonId&&
        entry.payload.evidenceRefs.includes('employee-enrollment:'+enrollmentId));
    check(matches.length===2,'T3_EMPLOYEE_ENROLLMENT_READBACK_NOT_FOUND');
    for(const [,record] of matches)
      verifyRecord(record,saved.policy,at,'GRANT');
    const active=matches.every(([grantId,entry])=>{
      const status=validateStatusSnapshot(entry.payload.authorityId,saved,at);
      return status.entries.some(x=>x.grantId===grantId&&x.state==='ACTIVE')&&
        !hasRecordedTombstone(saved,grantId);
    });
    return {state:active?'ORIGINAL_GRANTS_ACTIVE':'ORIGINAL_GRANTS_REVOKED_OR_EXPIRED',
      enrollmentId,organizationId,employeePersonId,
      grants:matches.map(([grantId])=>grantId).sort(),originalReadback:true,
      safeToReissue:false,invitationDelivered:false};
  }
  return Object.freeze({begin,complete,readEnrollment});
}
