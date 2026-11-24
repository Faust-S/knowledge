// Original T3 product ENTITLEMENT lifecycle in the existing signed registry.
// No seat database, second authority, alternate proof or commercial signer.
// DATA/ACTION grants never count as product seats and are not revoked here.
import {randomUUID} from 'node:crypto';
import {copy,digest,evaluate,identifier,insist,iso,signRecord,timestamp,
  validateGrant,checkCeiling,verifiedChain,validateStatusSnapshot,
  hasRecordedTombstone} from './core.mjs';
import {isOriginalKernelRegistryStatePort,ORIGINAL_CORPORATE_SEAT_POLICY}
 from './original-kernel-registry-state.mjs';
import {validateProductContract,CORPORATE_SEAT_ACTION,CORPORATE_SEAT_RESOURCE,
 CORPORATE_SEAT_PURPOSE,corporateSeatPolicyReady} from './product-contracts.mjs';
import {projectCorporateSeatLicense} from './corporate-product-license.mjs';

export {CORPORATE_SEAT_ACTION,CORPORATE_SEAT_RESOURCE,CORPORATE_SEAT_PURPOSE};
const MARK='corporate-agent-seat';
const HEX=/^[a-f0-9]{64}$/;
const eq=(a,b)=>digest(a)===digest(b);
const reference=(g,prefix)=>{
 const refs=g.evidenceRefs.filter(x=>x.startsWith(prefix));
 insist(refs.length===1,'CORP_SEAT_EVIDENCE_INVALID');
 return refs[0].slice(prefix.length);
};
const statusEntry=(status,id)=>status.entries.find(row=>row.grantId===id);
const live=(g,status,state,t)=>!hasRecordedTombstone(state,g.id)&&
 timestamp(g.notBefore)<=t&&t<timestamp(g.expiresAt)&&
 statusEntry(status,g.id)?.state==='ACTIVE';
function seatRows(state,org,t){
 const status=validateStatusSnapshot(org.issuerAuthorityId,state,t);
 const rows=[];
 for(const envelope of Object.values(state.grants)){
  const g=envelope.payload;
  if(g.principalId!==org.organizationId||g.authorityId!==org.issuerAuthorityId||
     !(g.actions.includes(CORPORATE_SEAT_ACTION)||g.evidenceRefs.includes(MARK)))continue;
  insist(g.rightClass==='ENTITLEMENT'&&g.parentGrantId===null&&g.renewalOf===null&&
    g.actions.length===1&&g.actions[0]===CORPORATE_SEAT_ACTION&&
    g.resources.length===1&&g.resources[0]===CORPORATE_SEAT_RESOURCE&&
    g.purposes.length===1&&g.purposes[0]===CORPORATE_SEAT_PURPOSE&&
    g.evidenceRefs.includes(MARK),'CORP_SEAT_ORIGINAL_GRANT_SCOPE_INVALID');
  const entry=statusEntry(status,g.id);
  insist(entry,'CORP_SEAT_STATUS_UNKNOWN');
  const lineageDigest=reference(g,'seat-lineage-sha256:');
  const licenseDigest=reference(g,'seat-license-sha256:');
  const workGrantId=identifier(reference(g,'seat-work:'));
  const enrollmentId=identifier(reference(g,'seat-enrollment:'));
  const credentialKeyId=identifier(reference(g,'seat-credential:'));
  insist(HEX.test(lineageDigest)&&HEX.test(licenseDigest),'CORP_SEAT_LICENSE_BINDING_INVALID');
  const reserved=['ACTIVE','SUSPENDED'].includes(entry.state)&&
    !hasRecordedTombstone(state,g.id)&&timestamp(g.notBefore)<=t&&t<timestamp(g.expiresAt);
  if(reserved)verifiedChain(g.id,state,t);
  rows.push({grantId:g.id,personId:g.holderId,roleId:g.roleId,workGrantId,
    enrollmentId,credentialKeyId,lineageDigest,licenseDigest,
    expiresAt:g.expiresAt,status:entry.state,reserved});
 }
 const occupied=rows.filter(x=>x.reserved);
 insist(new Set(occupied.map(x=>x.personId)).size===occupied.length,
   'CORP_SEAT_DUPLICATE_PERSON_RESERVATION');
 const members=new Set(),memberCandidates=[];
 for(const env of Object.values(state.grants)){
  const g=env.payload;
  if(g.principalId===org.organizationId&&g.authorityId===org.issuerAuthorityId&&
     g.rightClass==='ACTION'&&g.actions.length===1&&g.actions[0]==='work.prepare'&&
     g.evidenceRefs.some(x=>x.startsWith('employee-enrollment:'))&&
     !hasRecordedTombstone(state,g.id)&&timestamp(g.notBefore)<=t&&t<timestamp(g.expiresAt)){
   const entry=statusEntry(status,g.id);
   insist(entry,'CORP_SEAT_EMPLOYEE_STATUS_UNKNOWN');
   if(['ACTIVE','SUSPENDED'].includes(entry.state)){
     verifiedChain(g.id,state,t);members.add(g.holderId);
     if(entry.state==='ACTIVE'){
       const refs=g.evidenceRefs.filter(x=>x.startsWith('employee-enrollment:'));
       insist(refs.length===1,'CORP_SEAT_EMPLOYEE_ENROLLMENT_EVIDENCE_INVALID');
       memberCandidates.push({personId:g.holderId,enrollmentId:identifier(refs[0].slice('employee-enrollment:'.length))});
     }
   }
  }
 }
 return {status,rows,occupied,employeeCount:members.size,memberCandidates};
}
function memberForSeat(state,org,row,status,t){
 const g=state.grants[row.workGrantId]?.payload;
 const credential=state.policy.keys[row.credentialKeyId];
 insist(g&&g.holderId===row.personId&&g.principalId===org.organizationId&&
   g.authorityId===org.issuerAuthorityId&&g.rightClass==='ACTION'&&
   g.actions.length===1&&g.actions[0]==='work.prepare'&&
   g.evidenceRefs.includes('employee-enrollment:'+row.enrollmentId)&&
   g.evidenceRefs.includes('employee-credential:'+row.credentialKeyId)&&
   live(g,status,state,t)&&credential?.subjectId===row.personId&&
   credential.status==='ACTIVE'&&credential.uses.length===1&&credential.uses[0]==='PROOF'&&
   timestamp(credential.notBefore)<=t&&t<timestamp(credential.expiresAt),
   'CORP_SEAT_ORIGINAL_EMPLOYEE_INACTIVE');
 verifiedChain(g.id,state,t);
 return {grant:g,credential};
}
const capacityView=(project,snapshot)=>{
 const c=project?.candidate,occupied=snapshot.occupied.length;
 const applicable=!!c?.entitlement&&snapshot.occupied.every(x=>x.lineageDigest===c.lineageDigest);
 const within=applicable&&occupied<=c.seatLimit&&snapshot.employeeCount<=c.employeeLimit;
 return {licenseState:project?.state??'LICENSE_SOURCE_UNAVAILABLE',
   licenseEvidenceDigest:project?.evidenceDigest??null,candidate:c??null,
   reservedSeats:occupied,independentlyEnrolledEmployees:snapshot.employeeCount,
   seatLimit:c?.seatLimit??null,employeeLimit:c?.employeeLimit??null,
   availableSeats:within?Math.max(0,c.seatLimit-occupied):0,
   overSeatLimit:c?Math.max(0,occupied-c.seatLimit):null,
   overEmployeeLimit:c?Math.max(0,snapshot.employeeCount-c.employeeLimit):null,
   existingLineageMatches:applicable,withinLimits:within};
};
export function createOriginalCorporateSeatOwner({registry,issuerSigner,proveManager,
 trustedOrganization,resolveEnrollment,readLicenseState,installedTrust,clock=Date.now}={}){
 insist(isOriginalKernelRegistryStatePort(registry)&&issuerSigner?.keyId&&
  typeof issuerSigner.sign==='function'&&typeof proveManager==='function'&&
  typeof resolveEnrollment==='function'&&typeof readLicenseState==='function'&&
  typeof clock==='function','CORP_SEAT_ORIGINAL_HOST_REQUIRED');
 const org=validateProductContract('OrganizationIdentity',trustedOrganization);
 const pinnedTrust=installedTrust===undefined?null:copy(installedTrust);
 if(pinnedTrust!==null)insist(pinnedTrust?.trustOrigin==='HOST_PREINSTALLED_PUBLIC_POLICY'&&
   pinnedTrust?.policy?.environment==='PRODUCTION','CORP_SEAT_PREINSTALLED_TRUST_REQUIRED');
 const time=()=>{const t=clock();insist(Number.isSafeInteger(t)&&t>0,'CORP_SEAT_CLOCK_INVALID');return t;};
 const commercial=async t=>{
  try{
   const source=await readLicenseState();
   return projectCorporateSeatLicense({entries:source.entries,revision:source.revision,
     installedTrust:pinnedTrust??source.installedTrust,organizationId:org.organizationId,now:t});
  }catch{return null;}
 };
 const read=async t=>{
  const state=await registry.readState(),auth=state.policy.authorities[org.issuerAuthorityId];
  insist(state.policy.environment==='PRODUCTION'&&state.policy.realmId===org.realmId&&
    auth?.principalId===org.organizationId&&auth.membershipEpoch===org.membershipEpoch&&
    auth.issuerKeys.includes(issuerSigner.keyId)&&auth.statusKeys.includes(issuerSigner.keyId)&&
    org.issuerPublicKeyRefs.includes(issuerSigner.keyId),
    'CORP_SEAT_ORGANIZATION_AUTHORITY_REQUIRED');
  return {state,snapshot:seatRows(state,org,t)};
 };
 const projectView=async(state,snapshot,license,t)=>{
   const ready=corporateSeatPolicyReady(state.policy,org.issuerAuthorityId);
   const capacity=capacityView(license,snapshot);
   const employees=[],seen=new Set();
   for(const target of snapshot.memberCandidates){
     let m;
     try{
       m=await resolveEnrollment({saved:state,employeePersonId:target.personId,
         enrollmentId:target.enrollmentId,at:t,signEnrollment:false});
       insist(m?.originalSigned===true&&m.organizationId===org.organizationId&&
         m.employeePersonId===target.personId&&m.enrollmentId===target.enrollmentId,
         'CORP_SEAT_ORIGINAL_ENROLLMENT_REQUIRED');
       memberForSeat(state,org,{...target,workGrantId:m.grantIds.work,
         credentialKeyId:m.credentialPublicKeyRef},snapshot.status,t);
     }catch{continue;}
     insist(!seen.has(target.personId),'CORP_SEAT_EMPLOYEE_ENROLLMENT_CONFLICT');
     seen.add(target.personId);
     employees.push({...target,reserved:snapshot.occupied.some(x=>x.personId===target.personId)});
   }
   employees.sort((a,b)=>a.personId.localeCompare(b.personId));
   return Object.freeze({organizationId:org.organizationId,registryDigest:digest(state),
     ...capacity,seatPolicyReady:ready,availableSeats:ready?capacity.availableSeats:0,
     assignments:copy(snapshot.rows),eligibleEmployees:employees,
     // This is an original allocation, not admission of an installed Agent.
     productionActivation:false});
 };
 async function enablePolicy({managerPersonId,managerGrantId,expectedRegistryDigest}={}){
   identifier(managerPersonId);identifier(managerGrantId);
   const t=time(),{state,snapshot}=await read(t);
   if(corporateSeatPolicyReady(state.policy,org.issuerAuthorityId))
     return Object.freeze({outcome:'ALREADY_ENABLED',view:await projectView(state,snapshot,await commercial(t),t)});
   insist(digest(state)===expectedRegistryDigest,'CORP_SEAT_REGISTRY_CHANGED');
   const manager=state.grants[managerGrantId]?.payload;
   insist(manager?.holderId===managerPersonId&&manager.authorityId===org.issuerAuthorityId&&
     manager.rightClass==='ADMINISTRATION','CORP_SEAT_MANAGER_AUTHORITY_REQUIRED');
   const request={id:'seat-policy:'+randomUUID(),actorId:managerPersonId,
     principalId:org.organizationId,roleId:manager.roleId,grantId:managerGrantId,
     audience:manager.audience,resource:'authority:'+org.issuerAuthorityId,
     action:'grant.issue',purpose:'access-administration',realmId:org.realmId,
     operationDigest:digest({schema:ORIGINAL_CORPORATE_SEAT_POLICY,
       authorityId:org.issuerAuthorityId,organizationId:org.organizationId,
       oldPolicyDigest:digest(state.policy)})};
   const challenge=randomUUID()+randomUUID();
   const proof=await proveManager({request,challenge,asOf:iso(t),managerPersonId,
     organizationId:org.organizationId});
   const receipt=await registry.enableCorporateSeatPolicy({authorityId:org.issuerAuthorityId,
     organizationId:org.organizationId,issuerSigner,managerRequest:request,
     managerChallenge:challenge,managerProof:proof,expectedStateDigest:expectedRegistryDigest});
   return Object.freeze({outcome:'ENABLED',receipt,view:await view()});
 }
 async function view(){
  const t=time(),{state,snapshot}=await read(t);
  return await projectView(state,snapshot,await commercial(t),t);
 }
 function commandDetails(input){
  insist(input&&Object.getPrototypeOf(input)===Object.prototype&&
   Object.keys(input).sort().join()===['kind','commandId','expectedRegistryDigest',
    'expectedLicenseDigest','managerPersonId','managerGrantId',
    'employeePersonId','enrollmentId','fromGrantId'].sort().join()&&
   ['ASSIGN','RELEASE','TRANSFER'].includes(input.kind),
   'CORP_SEAT_COMMAND_INVALID');
  input=copy(input);
  for(const id of [input.commandId,input.managerPersonId,input.managerGrantId])identifier(id);
  insist(HEX.test(input.expectedRegistryDigest)&&
    (input.expectedLicenseDigest===null||HEX.test(input.expectedLicenseDigest)),
    'CORP_SEAT_EXPECTED_SOURCE_REQUIRED');
  const assign=input.kind!=='RELEASE',release=input.kind!=='ASSIGN';
  if(assign){identifier(input.employeePersonId);identifier(input.enrollmentId);}
  else insist(input.employeePersonId===null&&input.enrollmentId===null,'CORP_SEAT_RELEASE_TARGET_INVALID');
  if(release)identifier(input.fromGrantId);
  else insist(input.fromGrantId===null,'CORP_SEAT_ASSIGN_SOURCE_INVALID');
  const commandPrefix='seat-command:'+digest(input.commandId)+':';
  const commandRef=commandPrefix+digest(input);
  const grantId='grant:seat:'+digest([org.organizationId,input.commandId]);
  return {input,assign,release,commandPrefix,commandRef,grantId};
 }
 function committedCommand(state,snapshot,command){
  const {input,assign,release,commandPrefix,commandRef,grantId}=command;
  const old=state.grants[grantId]?.payload;
  const seen=snapshot.status.entries.filter(e=>e.evidenceRef.startsWith(commandPrefix));
  const known=old?.evidenceRefs?.find(e=>e.startsWith(commandPrefix));
  const tombstones=Object.entries(state.tombstones??{}).filter(([,e])=>
    typeof e?.reason==='string'&&e.reason.startsWith(commandPrefix));
  if(known||seen.length||tombstones.length){
   insist((!known||known===commandRef)&&seen.every(e=>e.evidenceRef===commandRef)&&
     tombstones.every(([,e])=>e.reason===commandRef),
     'CORP_SEAT_COMMAND_REUSE_CONFLICT');
   insist((!assign||known===commandRef)&&(!release||
     (tombstones.some(([id])=>id===input.fromGrantId)&&
       statusEntry(snapshot.status,input.fromGrantId)?.state==='REVOKED')),
     'CORP_SEAT_COMMIT_READBACK_INCOMPLETE');
   return {outcome:'ALREADY_COMMITTED',commandId:input.commandId,
     grantId:assign?grantId:null,releasedGrantId:release?input.fromGrantId:null};
  }
  return null;
 }
 // A lost ACK can be inspected without calling change(), proving a manager
 // again or writing another signature. Unknown remains explicitly unknown.
 async function readCommand(raw){
   const command=commandDetails(raw),{input}=command;
   const t=time(),{state,snapshot}=await read(t);
   const known=committedCommand(state,snapshot,command);
   const result=known??{outcome:digest(state)===input.expectedRegistryDigest?
     'NOT_COMMITTED':'OUTCOME_UNKNOWN',commandId:input.commandId,
     grantId:null,releasedGrantId:null};
   return Object.freeze({...result,originalReadback:true,automaticRetryAllowed:false,
     view:await projectView(state,snapshot,await commercial(t),t)});
 }
 async function change(raw){
  const command=commandDetails(raw),{input,assign,release,commandRef,grantId}=command;
  const t=time(),{state,snapshot}=await read(t);
  const known=committedCommand(state,snapshot,command);
  if(known)return Object.freeze({...known,view:await projectView(state,snapshot,await commercial(t),t)});
  insist(digest(state)===input.expectedRegistryDigest,'CORP_SEAT_REGISTRY_CHANGED');
  const license=await commercial(t),c=license?.candidate;
  if(assign){
   insist(corporateSeatPolicyReady(state.policy,org.issuerAuthorityId),'CORP_SEAT_POLICY_ENABLE_REQUIRED');
   insist(license?.evidenceDigest===input.expectedLicenseDigest&&c?.entitlement,
    'CORP_SEAT_CURRENT_SIGNED_LICENSE_REQUIRED');
  }
  const from=release?snapshot.occupied.find(x=>x.grantId===input.fromGrantId):null;
  if(release)insist(from,'CORP_SEAT_RELEASE_OR_TRANSFER_SOURCE_NOT_RESERVED');
  let target=null,work=null,credential=null;
  if(assign){
   insist(input.employeePersonId!==input.managerPersonId&&
     !snapshot.occupied.some(x=>x.personId===input.employeePersonId),
     'CORP_SEAT_PERSON_ALREADY_RESERVED_OR_MANAGER');
   const remaining=snapshot.occupied.filter(x=>x.grantId!==input.fromGrantId);
   insist(remaining.every(x=>x.lineageDigest===c.lineageDigest)&&
     remaining.length+1<=c.seatLimit&&snapshot.employeeCount<=c.employeeLimit,
     'CORP_SEAT_CAPACITY_EXCEEDED_OR_LINEAGE_CHANGED');
   // Same original employee owner reconstructs and verifies both signed
   // ACTION/DATA grants and independent credential in this exact state.
   const member=await resolveEnrollment({saved:state,employeePersonId:input.employeePersonId,
     enrollmentId:input.enrollmentId,at:t,signEnrollment:false});
   insist(member?.organizationId===org.organizationId&&member.employeePersonId===input.employeePersonId&&
     member.originalSigned===true,'CORP_SEAT_ORIGINAL_ENROLLMENT_REQUIRED');
   target={personId:input.employeePersonId,enrollmentId:input.enrollmentId,
     workGrantId:member.grantIds.work,credentialKeyId:member.credentialPublicKeyRef};
   ({grant:work,credential}=memberForSeat(state,org,target,snapshot.status,t));
  }
  const manager=state.grants[input.managerGrantId]?.payload;
  insist(manager?.holderId===input.managerPersonId&&
   manager.authorityId===org.issuerAuthorityId&&manager.rightClass==='ADMINISTRATION',
   'CORP_SEAT_MANAGER_AUTHORITY_REQUIRED');
  const operationDigest=digest({command:input,registry:digest(state),
    license:assign?license.evidenceDigest:null});
  const managerProofs=[];
  for(const action of [...(release?['grant.revoke']:[]),...(assign?['grant.issue']:[])]){
   const request={id:'seat-manager:'+randomUUID(),actorId:input.managerPersonId,
    principalId:org.organizationId,roleId:manager.roleId,grantId:manager.id,
    audience:manager.audience,resource:'authority:'+org.issuerAuthorityId,
    action,purpose:'access-administration',realmId:org.realmId,operationDigest};
   const challenge=randomUUID()+randomUUID();
   const proof=await proveManager({request,challenge,asOf:iso(t),
    managerPersonId:input.managerPersonId,organizationId:org.organizationId});
   const decision=evaluate(request,state,{now:iso(t),challenge,proof,
     timeAssurance:'LOCAL_BEST_EFFORT'});
   insist(decision.allowed===true&&decision.outcome==='PERMITTED','CORP_SEAT_MANAGER_PROOF_DENIED');
   managerProofs.push({request,challenge,proof});
  }
  // Recheck the commercial Store just before dispatch; a changed/expired
  // license never authorizes a new assignment. CAS protects the shared
  // original registry from competing seat, membership and grant writes.
  const at=time();
  insist(at-t<state.policy.proofMaxAgeSeconds*1000,'CORP_SEAT_MANAGER_PROOF_EXPIRED');
  if(assign){
   const fresh=await commercial(at);
   insist(fresh?.evidenceDigest===license.evidenceDigest&&fresh.candidate?.licenseId===c.licenseId,
    'CORP_SEAT_LICENSE_CHANGED_BEFORE_COMMIT');
   memberForSeat(state,org,target,snapshot.status,at);
  }
  const commitAt=time();
  for(const p of managerProofs){
   const decision=evaluate(p.request,state,{now:iso(commitAt),challenge:p.challenge,
     proof:p.proof,timeAssurance:'LOCAL_BEST_EFFORT'});
   insist(decision.allowed===true&&decision.outcome==='PERMITTED','CORP_SEAT_MANAGER_PROOF_EXPIRED');
  }
  const next=copy(state),authorityId=org.issuerAuthorityId,auth=state.policy.authorities[authorityId];
  const signingKey=state.policy.keys[issuerSigner.keyId];
  const entries=copy(snapshot.status.entries);
  if(release){
   const row=entries.find(x=>x.grantId===from.grantId);
   Object.assign(row,{state:'REVOKED',effectiveAt:iso(at),evidenceRef:commandRef});
   // Existing STATUS delivery requires terminal revocation evidence. Keep
   // the original append-only tombstone so the released seat cannot return
   // even when a later signed STATUS changes the descriptive evidenceRef.
   next.tombstones[from.grantId]={effectiveAt:iso(at),reason:commandRef};
  }
  if(assign){
   const expiresAt=Math.min(timestamp(work.expiresAt),timestamp(credential.expiresAt),
    timestamp(signingKey.expiresAt),at+auth.maxTtlSeconds*1000);
   insist(expiresAt>at,'CORP_SEAT_EMPLOYEE_LEASE_EXPIRED');
   const grant={kind:'GRANT',id:grantId,lineageId:grantId,renewalOf:null,parentGrantId:null,
    authorityId,principalId:org.organizationId,holderId:target.personId,roleId:work.roleId,
    rightClass:'ENTITLEMENT',realmId:org.realmId,environment:state.policy.environment,
    audience:auth.audiences[0],resources:[CORPORATE_SEAT_RESOURCE],
    actions:[CORPORATE_SEAT_ACTION],purposes:[CORPORATE_SEAT_PURPOSE],
    issuedAt:iso(at),notBefore:iso(at),expiresAt:iso(expiresAt),remainingDepth:0,
    membershipEpoch:org.membershipEpoch,policyId:state.policy.id,policyVersion:state.policy.version,
    evidenceRefs:[MARK,commandRef,'seat-enrollment:'+target.enrollmentId,
     'seat-work:'+target.workGrantId,'seat-credential:'+target.credentialKeyId,
     'seat-lineage-sha256:'+c.lineageDigest,'seat-license-sha256:'+c.licenseDigest]};
   validateGrant(grant);checkCeiling(grant,auth,state.policy);
   next.grants[grantId]=signRecord(grant,issuerSigner);
   entries.push({grantId,state:'ACTIVE',effectiveAt:iso(at),evidenceRef:commandRef});
  }
  const sequence=snapshot.status.sequence+1;
  // Do not accidentally extend unrelated DATA/ACTION freshness by a
  // commercial seat operation. Preserve the previous signed expiry.
  const validUntil=Math.min(timestamp(snapshot.status.validUntil),timestamp(signingKey.expiresAt));
  insist(validUntil>at,'CORP_SEAT_ORGANIZATION_STATUS_STALE');
  const prior=state.statuses[authorityId].payload;
  next.statuses[authorityId]=signRecord({...prior,id:'status:'+randomUUID(),
    sequence,issuedAt:iso(at),validUntil:iso(validUntil),
    entries:entries.sort((a,b)=>a.grantId.localeCompare(b.grantId))},issuerSigner);
  next.statusFloor[authorityId]=sequence;
  const receipt=await registry.commitSignedState(next,{expectedStateDigest:digest(state)});
  const saved=await read(time());
  insist(saved.state.statusFloor[authorityId]===sequence&&
   (!assign||eq(saved.state.grants[grantId],next.grants[grantId]))&&
   (!release||(statusEntry(saved.snapshot.status,from.grantId)?.state==='REVOKED'&&
     eq(saved.state.tombstones[from.grantId],next.tombstones[from.grantId]))),
   'CORP_SEAT_ORIGINAL_COMMIT_READBACK_REQUIRED');
  return Object.freeze({outcome:'COMMITTED',commandId:input.commandId,
    grantId:assign?grantId:null,releasedGrantId:release?from.grantId:null,
    receipt,view:await projectView(saved.state,saved.snapshot,await commercial(time()),time())});
 }
 return Object.freeze({view,change,enablePolicy,readCommand});
}

// Read-only, subject-scoped observation of the same signed seat lifecycle.
// It must NEVER stand in for authorizeOriginalCorporateSeatUse: there is no
// Task binding, challenge, new proof, persisted decision or authority here.
// The installed native employee owner supplies its own trusted identity,
// existing work grant and verified local Consumer history, not UI selectors.
export function observeOriginalCorporateEmployeeSeat({state,organization,licenseState,
 installedTrust,actorId,credentialKeyId,workGrantId,now=Date.now()}={}){
 const org=validateProductContract('OrganizationIdentity',organization);
 identifier(actorId);identifier(credentialKeyId);identifier(workGrantId);
 const auth=state.policy.authorities[org.issuerAuthorityId];
 insist(Number.isSafeInteger(now)&&now>0&&state.policy.environment==='PRODUCTION'&&
   state.policy.realmId===org.realmId&&auth?.principalId===org.organizationId&&
   auth.membershipEpoch===org.membershipEpoch,
   'CORP_SEAT_OBSERVATION_SCOPE_INVALID');
 const snapshot=seatRows(state,org,now),work=state.grants[workGrantId]?.payload;
 insist(work&&work.id===workGrantId,'CORP_SEAT_OBSERVATION_WORK_GRANT_REQUIRED');
 const enrollmentId=identifier(reference(work,'employee-enrollment:'));
 const {grant:membership,credential}=memberForSeat(state,org,{
   personId:actorId,workGrantId,enrollmentId,credentialKeyId
 },snapshot.status,now);
 const commercial=projectCorporateSeatLicense({...licenseState,installedTrust,
   organizationId:org.organizationId,now});
 const capacity=capacityView(commercial,snapshot);
 const row=snapshot.occupied.find(x=>x.personId===actorId)??null;
 if(row)insist(row.workGrantId===workGrantId&&row.enrollmentId===enrollmentId&&
   row.credentialKeyId===credentialKeyId,'CORP_SEAT_OBSERVATION_BINDING_CHANGED');
 const policyReady=corporateSeatPolicyReady(state.policy,org.issuerAuthorityId);
 const stateName=!policyReady?'POLICY_NOT_ENABLED':!row?'NOT_ASSIGNED':
   row.status==='SUSPENDED'?'ASSIGNMENT_SUSPENDED':
   !commercial.candidate?.entitlement?'ASSIGNMENT_LICENSE_UNAVAILABLE':
   !capacity.withinLimits?'ASSIGNMENT_CAPACITY_HELD':'ASSIGNMENT_CURRENT';
 // Keep only the employee's own seat and the minimum timing evidence.
 // A historical revocation must not be advertised as a current reservation.
 const validUntil=stateName==='ASSIGNMENT_CURRENT'?iso(Math.min(
   timestamp(snapshot.status.validUntil),
   timestamp(snapshot.status.issuedAt)+state.policy.offlineMaxAgeSeconds*1000,
   timestamp(membership.expiresAt),timestamp(credential.expiresAt),
   timestamp(row.expiresAt),timestamp(commercial.candidate.expiresAt),
   timestamp(commercial.candidate.statusValidUntil))):null;
 if(validUntil!==null)insist(timestamp(validUntil)>now,
   'CORP_SEAT_OBSERVATION_STALE');
 return Object.freeze({schema:'IWXA_T3_CORPORATE_EMPLOYEE_SEAT_OBSERVATION/1',
   organizationId:org.organizationId,subjectId:actorId,
   state:stateName,grantId:row?.grantId??null,
   licenseId:commercial.candidate?.licenseId??null,
   licenseRevision:licenseState.revision,statusSequence:snapshot.status.sequence,
   observedAt:iso(now),validUntil,observationOnly:true,executionAuthorized:false,
   dataAuthority:false,actionAuthority:false,productionActivation:false});
}

// Agent's product-specific JIT gate. The trusted Host must supply the
// original current signed registry and complete durable Consumer history.
// It grants ONLY the product feature, never DATA/ACTION access.
export function evaluateOriginalCorporateSeatUse({state,organization,licenseState,
 installedTrust,request,proof,challenge,now=Date.now()}={}){
 try{
  const org=validateProductContract('OrganizationIdentity',organization);
  insist(state.policy.environment==='PRODUCTION'&&
    state.policy.realmId===org.realmId&&request.principalId===org.organizationId&&
    request.action===CORPORATE_SEAT_ACTION&&request.resource===CORPORATE_SEAT_RESOURCE&&
    request.purpose===CORPORATE_SEAT_PURPOSE,'CORP_SEAT_USE_SCOPE_INVALID');
  const projection=projectCorporateSeatLicense({...licenseState,installedTrust,
    organizationId:org.organizationId,now});
  const snapshot=seatRows(state,org,now),c=capacityView(projection,snapshot);
  insist(c.withinLimits,'CORP_SEAT_CURRENT_LICENSE_OR_CAPACITY_REQUIRED');
  const row=snapshot.occupied.find(x=>x.grantId===request.grantId&&x.personId===request.actorId);
  insist(row&&row.status==='ACTIVE'&&proof?.keyId===row.credentialKeyId,
    'CORP_SEAT_ACTOR_BINDING_REQUIRED');
  const {grant,credential}=memberForSeat(state,org,row,snapshot.status,now);
  const decision=evaluate(request,state,{now:iso(now),challenge,proof,timeAssurance:'LOCAL_BEST_EFFORT'});
  insist(decision.allowed===true&&decision.outcome==='PERMITTED','CORP_SEAT_ORIGINAL_ACCESS_DENIED');
  return Object.freeze({allowed:true,outcome:'PERMITTED',grantId:row.grantId,
    licenseId:projection.candidate.licenseId,subjectId:row.personId,
    validUntil:iso(Math.min(timestamp(decision.validUntil),timestamp(grant.expiresAt),
     timestamp(credential.expiresAt),timestamp(projection.candidate.expiresAt),
     timestamp(projection.candidate.statusValidUntil))),authorityClass:'ENTITLEMENT',
    dataAuthority:false,actionAuthority:false});
 }catch(error){return Object.freeze({allowed:false,outcome:'DENIED',
  reason:error?.code??'CORP_SEAT_USE_INVALID',dataAuthority:false,actionAuthority:false});}
}

// Trusted installed employee Host: bind a single concrete product operation
// to the original signed seat and an independent employee PROOF. The caller
// cannot pick a grant, actor role, resource, purpose, or replay a previous
// challenge. This is a read-only JIT decision, not a new entitlement issuer.
export function authorizeOriginalCorporateSeatUse({state,organization,licenseState,
 installedTrust,actorId,credentialKeyId,operationDigest,prove,now=Date.now()}={}){
 try{
  const org=validateProductContract('OrganizationIdentity',organization);
  identifier(actorId);identifier(credentialKeyId);
  insist(typeof operationDigest==='string'&&HEX.test(operationDigest)&&
    typeof prove==='function'&&Number.isSafeInteger(now)&&now>0&&
    state.policy.environment==='PRODUCTION'&&state.policy.realmId===org.realmId,
    'CORP_SEAT_USE_INTENT_INVALID');
  const projection=projectCorporateSeatLicense({...licenseState,installedTrust,
    organizationId:org.organizationId,now});
  const snapshot=seatRows(state,org,now);
  insist(capacityView(projection,snapshot).withinLimits,
    'CORP_SEAT_CURRENT_LICENSE_OR_CAPACITY_REQUIRED');
  const row=snapshot.occupied.find(x=>x.personId===actorId);
  insist(row?.status==='ACTIVE'&&row.credentialKeyId===credentialKeyId,
    'CORP_SEAT_ACTOR_BINDING_REQUIRED');
  memberForSeat(state,org,row,snapshot.status,now);
  const seat=state.grants[row.grantId].payload;
  const request=Object.freeze({id:'seat-use:'+randomUUID(),
    actorId,principalId:org.organizationId,roleId:seat.roleId,grantId:seat.id,
    audience:seat.audience,resource:CORPORATE_SEAT_RESOURCE,
    action:CORPORATE_SEAT_ACTION,purpose:CORPORATE_SEAT_PURPOSE,
    realmId:org.realmId,operationDigest});
  const challenge='seat-use:'+randomUUID();
  const proof=prove({request,challenge,credentialKeyId,now});
  const checked=evaluateOriginalCorporateSeatUse({state,organization:org,
    licenseState,installedTrust,request,challenge,proof,now});
  return Object.freeze({...checked,operationDigest,productionActivation:false});
 }catch(error){return Object.freeze({allowed:false,outcome:'DENIED',
  reason:error?.code??'CORP_SEAT_USE_INVALID',dataAuthority:false,
  actionAuthority:false,productionActivation:false});}
}
