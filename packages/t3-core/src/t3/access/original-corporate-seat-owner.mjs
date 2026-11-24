// Original T3 product ENTITLEMENT lifecycle in the existing signed registry.
// No seat database, second authority, alternate proof or commercial signer.
// DATA/ACTION grants never count as product seats and are not revoked here.
import {randomUUID} from 'node:crypto';
import {copy,digest,evaluate,identifier,insist,iso,signRecord,timestamp,
  validateGrant,checkCeiling,verifiedChain,validateStatusSnapshot,
  hasRecordedTombstone} from './core.mjs';
import {isOriginalKernelRegistryStatePort} from './original-kernel-registry-state.mjs';
import {validateProductContract} from './product-contracts.mjs';
import {projectCorporateSeatLicense} from './corporate-product-license.mjs';

export const CORPORATE_SEAT_ACTION='product.personal-agent.corporate.use';
export const CORPORATE_SEAT_RESOURCE='product:IWXA_ADMIN_CENTER';
export const CORPORATE_SEAT_PURPOSE='corporate-product';
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
 const members=new Set();
 for(const env of Object.values(state.grants)){
  const g=env.payload;
  if(g.principalId===org.organizationId&&g.authorityId===org.issuerAuthorityId&&
     g.rightClass==='ACTION'&&g.actions.length===1&&g.actions[0]==='work.prepare'&&
     g.evidenceRefs.some(x=>x.startsWith('employee-enrollment:'))&&live(g,status,state,t)){
   verifiedChain(g.id,state,t);members.add(g.holderId);
  }
 }
 return {status,rows,occupied,employeeCount:members.size};
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
 const trust=copy(installedTrust);
 insist(trust?.trustOrigin==='HOST_PREINSTALLED_PUBLIC_POLICY'&&
   trust?.policy?.environment==='PRODUCTION','CORP_SEAT_PREINSTALLED_TRUST_REQUIRED');
 const time=()=>{const t=clock();insist(Number.isSafeInteger(t)&&t>0,'CORP_SEAT_CLOCK_INVALID');return t;};
 const commercial=async t=>{
  try{
   const source=await readLicenseState();
   return projectCorporateSeatLicense({entries:source.entries,revision:source.revision,
     installedTrust:trust,organizationId:org.organizationId,now:t});
  }catch{return null;}
 };
 const read=async t=>{
  const state=await registry.readState(),auth=state.policy.authorities[org.issuerAuthorityId];
  insist(state.policy.environment==='PRODUCTION'&&state.policy.realmId===org.realmId&&
    auth?.principalId===org.organizationId&&auth.membershipEpoch===org.membershipEpoch&&
    auth.issuerKeys.includes(issuerSigner.keyId)&&auth.statusKeys.includes(issuerSigner.keyId),
    'CORP_SEAT_ORGANIZATION_AUTHORITY_REQUIRED');
  return {state,snapshot:seatRows(state,org,t)};
 };
 const projectView=(state,snapshot,license)=>Object.freeze({
   organizationId:org.organizationId,registryDigest:digest(state),
   ...capacityView(license,snapshot),assignments:copy(snapshot.rows),
   // This is an original allocation, not admission of an installed Agent.
   productionActivation:false});
 async function view(){
  const t=time(),{state,snapshot}=await read(t);
  return projectView(state,snapshot,await commercial(t));
 }
 async function change(input){
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
  const t=time(),{state,snapshot}=await read(t);
  const old=state.grants[grantId]?.payload;
  const seen=snapshot.status.entries.filter(e=>e.evidenceRef.startsWith(commandPrefix));
  const known=old?.evidenceRefs?.find(e=>e.startsWith(commandPrefix));
  if(known||seen.length){
   insist((!known||known===commandRef)&&seen.every(e=>e.evidenceRef===commandRef),
     'CORP_SEAT_COMMAND_REUSE_CONFLICT');
   insist((!assign||known===commandRef)&&(!release||
     seen.some(e=>e.grantId===input.fromGrantId&&e.state==='REVOKED')),
     'CORP_SEAT_COMMIT_READBACK_INCOMPLETE');
   return Object.freeze({outcome:'ALREADY_COMMITTED',commandId:input.commandId,
     grantId:assign?grantId:null,releasedGrantId:release?input.fromGrantId:null,
     view:projectView(state,snapshot,await commercial(t))});
  }
  insist(digest(state)===input.expectedRegistryDigest,'CORP_SEAT_REGISTRY_CHANGED');
  const license=await commercial(t),c=license?.candidate;
  if(assign)insist(license?.evidenceDigest===input.expectedLicenseDigest&&c?.entitlement,
    'CORP_SEAT_CURRENT_SIGNED_LICENSE_REQUIRED');
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
     enrollmentId:input.enrollmentId,at:t});
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
  const next=copy(state),authorityId=org.issuerAuthorityId,auth=state.policy.authorities[authorityId];
  const signingKey=state.policy.keys[issuerSigner.keyId];
  const entries=copy(snapshot.status.entries);
  if(release){
   const row=entries.find(x=>x.grantId===from.grantId);
   Object.assign(row,{state:'REVOKED',effectiveAt:iso(at),evidenceRef:commandRef});
   // Preserve the terminal signed STATUS; the original registry owns it.
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
   (!release||statusEntry(saved.snapshot.status,from.grantId)?.state==='REVOKED'),
   'CORP_SEAT_ORIGINAL_COMMIT_READBACK_REQUIRED');
  return Object.freeze({outcome:'COMMITTED',commandId:input.commandId,
    grantId:assign?grantId:null,releasedGrantId:release?from.grantId:null,
    receipt,view:projectView(saved.state,saved.snapshot,await commercial(time()))});
 }
 return Object.freeze({view,change});
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
