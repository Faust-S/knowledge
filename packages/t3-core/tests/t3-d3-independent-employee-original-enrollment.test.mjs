// Genuine original Ed25519 issuer, actor proofs, STATUS, inherited T2 Kernel
// Object/Event persistence. This is not the installed independent Windows
// employee credential ceremony or full Admin -> Agent -> Admin D3 acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {keyObjectSigner,makeProof,signRecord,iso,digest,evaluate}
  from '../src/t3/access/core.mjs';
import {createOriginalEmployeeEnrollmentOwner}
  from '../src/t3/access/original-employee-enrollment.mjs';
import {createOriginalKernelRegistryStatePort,ORIGINAL_PROOF_KEY_ADMISSION}
  from '../src/t3/access/original-kernel-registry-state.mjs';
import {verifyOrganizationEnrollment,createOrganizationalOperationGate}
  from '../src/t3/access/organizational-operation.mjs';
import {NOW,model,originalKernelFixture}
  from './support/t3-two-corp-original-authority.mjs';

const time=()=>NOW;
const employee=(id,person)=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 return {signer:keyObjectSigner(id,privateKey),record:{
  subjectId:person,environment:'TEST',
  publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),
  status:'ACTIVE',uses:['PROOF'],notBefore:iso(NOW-3600000),
  expiresAt:iso(NOW+3600000)
 }};
};
function setup({wrongManager=false,lostAck=false,pretrustEmployees=true}={}){
 const fixture=model(),north=fixture.all.north,
   auth=fixture.policy.authorities['issuer:north'];
 const alice=employee('key:buyer-alice','person:alice'),
   bob=employee('key:buyer-bob','person:bob');
 if(pretrustEmployees){
  fixture.policy.keys[alice.signer.keyId]=alice.record;
  fixture.policy.keys[bob.signer.keyId]=bob.record;
 }
 auth.roles.push('worker','role:manager');
 auth.rightClasses.push('ADMINISTRATION','DATA');
 auth.resources.push('authority:issuer:north','workspace:ws:north',
  'subject:org:north','recipient:org:north','field:result','operation:UPSERT');
 auth.actions.push('grant.issue','work.prepare','package.export');
 auth.purposes.push('access-administration','work','handoff');
 Object.assign(fixture.policy.actionCatalog,{
  'grant.issue':'ADMINISTRATION','work.prepare':'ACTION','package.export':'DATA'
 });
 const admin={...fixture.state.grants['grant:north'].payload,
  id:'grant:admin-north',lineageId:'grant:admin-north',
  roleId:'role:manager',rightClass:'ADMINISTRATION',
  resources:['authority:issuer:north'],actions:['grant.issue'],
  purposes:['access-administration'],evidenceRefs:['evidence:manager-custody']
 };
 fixture.state.grants[admin.id]=signRecord(admin,north.issuerSigner);
 const old=fixture.state.statuses['issuer:north'].payload;
 fixture.state.statuses['issuer:north']=signRecord({...old,
  entries:[...old.entries,{grantId:admin.id,state:'ACTIVE',
    effectiveAt:iso(NOW-2500),evidenceRef:'evidence:manager-custody'}]},
  north.issuerSigner);
 const kernel=originalKernelFixture(),original=kernel.api;
 let dropNext=false;
 const wrapped={...original,async putObject(cmd){
  const saved=await original.putObject(cmd);
  if(dropNext){dropNext=false;throw Error('SIMULATED_LOST_ACK_AFTER_KERNEL_COMMIT');}
  return saved;
 }};
 const opts={kernel:wrapped,workspaceId:'ws:host-registry',
  trustedPolicy:fixture.policy,clock:time};
 const registry=createOriginalKernelRegistryStatePort(opts);
 const managerSigner=wrongManager?bob.signer:north.credentialSigner;
 const owner=createOriginalEmployeeEnrollmentOwner({
  registry,issuerSigner:north.issuerSigner,clock:time,
  trustedOrganization:north.descriptors.organizations[0],
  trustedWorkspaceId:'ws:north',
  proveManager:async({request,challenge})=>
   makeProof(request,challenge,NOW,managerSigner,'TEST')
 });
 const input=target=>({
  organization:north.descriptors.organizations[0],
  workspaceId:'ws:north',employeePersonId:target.record.subjectId,
  credentialKeyId:target.signer.keyId,
  managerPersonId:'person:operator',
  managerGrantId:admin.id,ttlSeconds:600
 });
 return {fixture,north,alice,bob,registry,kernel,owner,input,
  init:()=>registry.commitSignedState(fixture.state),
  loseNext:()=>{dropNext=true;}};
}
test('independent employee grants have genuine Ed25519 proof and one original Kernel commit',async()=>{
 const s=setup();await s.init();
 const started=await s.owner.begin(s.input(s.alice));
 assert.equal(started.signed,false);
 const proof=makeProof(started.request,started.challenge,NOW,s.alice.signer,'TEST');
 const issued=await s.owner.complete({enrollmentId:started.enrollmentId,
  employeeProof:proof});
 assert.equal(issued.state,'SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED');
 assert.equal(issued.originalSigned,true);
 assert.equal(issued.invitationDelivered,false);
 assert.equal(issued.credential.holderPersonId,'person:alice');
 assert.equal(issued.credential.publicKeyRef,s.alice.signer.keyId);
 assert.notEqual(issued.credential.holderPersonId,'person:operator');
 assert.equal(issued.grantIds.work!==issued.grantIds.export,true);
 assert.deepEqual(issued.workGrant.payload.actions,['work.prepare']);
 assert.deepEqual(issued.exportGrant.payload.actions,['package.export']);
 assert.deepEqual(issued.exportGrant.payload.resources,[
  'workspace:ws:north','subject:org:north','recipient:org:north',
  'field:result','operation:UPSERT'
 ]);
 assert.equal(s.kernel.calls.length,2);
 const signed=await s.registry.readState();
 assert.equal(signed.statusFloor['issuer:north'],2);
 assert.equal(signed.statusFloor['issuer:south'],1);
 assert.equal(verifyOrganizationEnrollment(issued.enrollment,signed,
  s.input(s.alice).organization,NOW).personId,'person:alice');
 const recovered=await s.owner.readEnrollment({
  organizationId:'org:north',employeePersonId:'person:alice',
  enrollmentId:started.enrollmentId});
 assert.equal(recovered.state,'ORIGINAL_GRANTS_ACTIVE');
 assert.equal(recovered.safeToReissue,false);
 await assert.rejects(s.owner.begin(s.input(s.alice)),
  {code:'T3_EMPLOYEE_ALREADY_ENROLLED_READBACK_REQUIRED'});
 const second=await s.owner.begin(s.input(s.bob));
 const proof2=makeProof(second.request,second.challenge,NOW,s.bob.signer,'TEST');
 const issued2=await s.owner.complete({enrollmentId:second.enrollmentId,
   employeeProof:proof2});
 assert.equal(issued2.employeePersonId,'person:bob');
 assert.equal(issued2.statusSequence,3);
 assert.equal(s.kernel.calls.length,3);
 const current=await s.registry.readState();
 assert.equal(current.statusFloor['issuer:north'],3);
 assert.equal(current.statusFloor['issuer:south'],1);
});
test('unsigned employee challenge can be cancelled without Kernel writes or grant issuance',async()=>{
 const s=setup();await s.init();
 const first=await s.owner.begin(s.input(s.alice));
 const initialCalls=s.kernel.calls.length;
 assert.equal(typeof s.owner.cancelPending,'function');
 assert.throws(()=>s.owner.cancelPending({
  enrollmentId:first.enrollmentId,employeePersonId:'person:bob'}),
  {code:'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN'});
 assert.throws(()=>s.owner.cancelPending({
  enrollmentId:'different-enrollment',employeePersonId:'person:alice'}),
  {code:'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN'});
 const cancelled=s.owner.cancelPending({
  enrollmentId:first.enrollmentId,employeePersonId:'person:alice'});
 assert.equal(cancelled.state,'UNSUBMITTED_EMPLOYEE_CHALLENGE_CANCELLED');
 assert.equal(cancelled.enrollmentId,first.enrollmentId);
 assert.equal(cancelled.employeePersonId,'person:alice');
 assert.equal(cancelled.originalKernelWriteAttempted,false);
 assert.equal(s.kernel.calls.length,initialCalls);
 assert.throws(()=>s.owner.cancelPending({
  enrollmentId:first.enrollmentId,employeePersonId:'person:alice'}),
  {code:'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN'});
 await assert.rejects(s.owner.complete({
  enrollmentId:first.enrollmentId,
  employeeProof:makeProof(first.request,first.challenge,NOW,s.alice.signer,'TEST')
 }),{code:'T3_EMPLOYEE_ENROLLMENT_CHALLENGE_STALE'});
 const state=await s.registry.readState();
 assert.equal(Object.keys(state.grants).length,
  Object.keys(s.fixture.state.grants).length);
 const second=await s.owner.begin(s.input(s.alice));
 assert.notEqual(second.enrollmentId,first.enrollmentId);
 const issued=await s.owner.complete({
  enrollmentId:second.enrollmentId,
  employeeProof:makeProof(second.request,second.challenge,NOW,s.alice.signer,'TEST')});
 assert.equal(issued.state,'SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED');
 assert.equal(s.kernel.calls.length,initialCalls+1);
});
test('original employee proof challenge cannot be cancelled after failed dispatch or lost ACK',async()=>{
 const s=setup({lostAck:true});await s.init();
 const first=await s.owner.begin(s.input(s.alice));
 s.loseNext();
 await assert.rejects(s.owner.complete({
  enrollmentId:first.enrollmentId,
  employeeProof:makeProof(first.request,first.challenge,NOW,s.alice.signer,'TEST')
 }),/SIMULATED_LOST_ACK_AFTER_KERNEL_COMMIT/);
 assert.throws(()=>s.owner.cancelPending({
  enrollmentId:first.enrollmentId,employeePersonId:'person:alice'
 }),{code:'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN'});
 const restored=await s.owner.readEnrollment({
  organizationId:'org:north',employeePersonId:'person:alice',
  enrollmentId:first.enrollmentId});
 assert.equal(restored.state,'ORIGINAL_GRANTS_ACTIVE');
 assert.equal(restored.safeToReissue,false);
 assert.equal(s.kernel.calls.length,2);
 assert.throws(()=>s.owner.cancelPending({
  enrollmentId:first.enrollmentId,employeePersonId:'person:alice'
 }),{code:'T3_EMPLOYEE_CANCEL_AFTER_DISPATCH_FORBIDDEN'});
});
test('independent signer cannot be substituted by another employee, unknown trust is denied',async()=>{
 const s=setup();await s.init();
 const start=await s.owner.begin(s.input(s.alice));
 await assert.rejects(s.owner.complete({enrollmentId:start.enrollmentId,
  employeeProof:makeProof(start.request,start.challenge,NOW,s.bob.signer,'TEST')}),
 {code:'T3_EMPLOYEE_PROOF_WRONG_CREDENTIAL'});
 assert.equal(s.kernel.calls.length,1);
 const t=setup();await t.init();
 await assert.rejects(t.owner.begin({...t.input(t.alice),
  credentialKeyId:'key:untrusted'}),{code:'T3_EMPLOYEE_CREDENTIAL_NOT_PRETRUSTED'});
 await assert.rejects(t.owner.begin({...t.input(t.alice),
  workspaceId:'ws:south'}),
  {code:'T3_EMPLOYEE_TRUSTED_ORGANIZATION_CONTEXT_CHANGED'});
 await assert.rejects(t.owner.begin({...t.input(t.alice),
  organization:t.fixture.all.south.descriptors.organizations.find(x=>x.organizationId==='org:south')}),
  {code:'T3_EMPLOYEE_TRUSTED_ORGANIZATION_CONTEXT_CHANGED'});
});
test('manager without original signed administration proof cannot add a worker',async()=>{
 const s=setup({wrongManager:true});await s.init();
 const start=await s.owner.begin(s.input(s.alice));
 await assert.rejects(s.owner.complete({enrollmentId:start.enrollmentId,
  employeeProof:makeProof(start.request,start.challenge,NOW,s.alice.signer,'TEST')}),
 {code:'T3_EMPLOYEE_MANAGER_NOT_AUTHORIZED'});
 assert.equal(s.kernel.calls.length,1);
});
test('original Kernel committed but ACK lost: readback finds it and issuance does not replay',async()=>{
 const s=setup();await s.init();
 const start=await s.owner.begin(s.input(s.alice));
 s.loseNext();
 await assert.rejects(s.owner.complete({enrollmentId:start.enrollmentId,
  employeeProof:makeProof(start.request,start.challenge,NOW,s.alice.signer,'TEST')}),
  /SIMULATED_LOST_ACK_AFTER_KERNEL_COMMIT/);
 const read=await s.owner.readEnrollment({organizationId:'org:north',
  employeePersonId:'person:alice',enrollmentId:start.enrollmentId});
 assert.equal(read.state,'ORIGINAL_GRANTS_ACTIVE');
 assert.equal(read.safeToReissue,false);
 assert.equal(read.originalSigned,true);
 assert.equal(read.credential.publicKeyRef,s.alice.signer.keyId);
 assert.equal(read.membership.personId,'person:alice');
 assert.equal(read.originalEnrollment.payload.membershipId,
   'member:'+start.enrollmentId);
 assert.equal(s.kernel.calls.length,2);
 await assert.rejects(s.owner.begin(s.input(s.alice)),
  {code:'T3_EMPLOYEE_ALREADY_ENROLLED_READBACK_REQUIRED'});
 // Only a different employee may begin once original committed state has
 // been explicitly reconciled. The lost enrollment is never re-issued.
 const second=await s.owner.begin(s.input(s.bob));
 assert.equal(second.signed,false);
});

test('signed employee grant revocation survives original Kernel readback',async()=>{
 const s=setup();await s.init();
 const started=await s.owner.begin(s.input(s.alice));
 const issued=await s.owner.complete({enrollmentId:started.enrollmentId,
  employeeProof:makeProof(started.request,started.challenge,NOW,s.alice.signer,'TEST')});
 const before=await s.registry.readState(),grantId=issued.grantIds.export;
 const authorityId='issuer:north',old=before.statuses[authorityId].payload;
 const next=structuredClone(before);
 next.tombstones[grantId]={effectiveAt:iso(NOW),reason:'intent:employee-revoke'};
 next.statuses[authorityId]=signRecord({...old,
  id:'status:employee-revoked',sequence:old.sequence+1,
  issuedAt:iso(NOW),entries:old.entries.map(row=>
    row.grantId===grantId?{...row,state:'REVOKED',effectiveAt:iso(NOW)}:row)
 },s.north.issuerSigner);
 next.statusFloor[authorityId]=old.sequence+1;
 await s.registry.commitSignedState(next);
 const current=await s.owner.readEnrollment({
  organizationId:'org:north',employeePersonId:'person:alice',
  enrollmentId:started.enrollmentId});
 assert.equal(current.state,'ORIGINAL_GRANTS_REVOKED_OR_EXPIRED');
 assert.equal(current.safeToReissue,false);
 assert.equal((await s.registry.readState()).statusFloor[authorityId],old.sequence+1);
});


test('independent employee uses ORIGINAL signed organization JIT gate as Personal Agent',async()=>{
 const s=setup();await s.init();
 const started=await s.owner.begin(s.input(s.alice));
 const issued=await s.owner.complete({enrollmentId:started.enrollmentId,
   employeeProof:makeProof(started.request,started.challenge,NOW,s.alice.signer,'TEST')});
 const cold=await s.owner.readEnrollment({organizationId:'org:north',
   employeePersonId:'person:alice',enrollmentId:started.enrollmentId});
 assert.equal(digest(cold.originalEnrollment),digest(issued.enrollment));
 const workspace=s.north.descriptors.workspaces.find(w=>w.workspaceId==='ws:north');
 const organization=s.north.descriptors.organizations.find(o=>o.organizationId==='org:north');
 const profile={...s.north.profile,
  personId:'person:alice',personalDataRootId:'root:personal:alice',
  personalPublicKeyRefs:['key:personal-alice']};
 const selection={...s.north.selection,
  personId:'person:alice',selectionId:'selection:alice',
  membershipId:issued.membership.membershipId,grantId:issued.grantIds.work,
  selectedAt:iso(NOW-1000)};
 const descriptors={organizations:[organization],workspaces:[workspace],
  memberships:[cold.membership],grants:[cold.binding]};
 const gate=createOrganizationalOperationGate({registry:s.registry});
 const inputs={profile,selection,descriptors,
  credential:cold.credential,enrollment:cold.originalEnrollment,
  operation:{operationId:'task:alice:work',
   productId:'IWXA_PERSONAL_AGENT',audience:'host:t3',
   resource:'ws:north',action:'work.prepare',purpose:'work',
   payloadDigest:'a'.repeat(64)},asOf:iso(NOW)};
 const preview=await gate.preview(inputs);
 assert.equal(preview.credentialKeyId,s.alice.signer.keyId);
 const challenge='real-original-enrollment-actor-challenge';
 const auth={now:iso(NOW),challenge,
  proof:makeProof(preview.request,challenge,NOW,s.alice.signer,'TEST')};
 const accepted=await gate.authorize(inputs,auth);
 assert.equal(accepted.outcome,'PERMITTED');
 assert.equal(accepted.actorId,'person:alice');
 assert.equal(accepted.grantId,issued.grantIds.work);
 assert.equal(accepted.organizationId,'org:north');
 // A separate DATA grant is evaluated by the SAME original T3 Access owner,
 // not inferred from work membership or silently promoted from ACTION.
 const exportRequest={id:'operation:alice:export',
  actorId:'person:alice',principalId:'org:north',roleId:'worker',
  grantId:issued.grantIds.export,audience:'host:t3',
  resource:'workspace:ws:north',action:'package.export',purpose:'handoff',
  realmId:'realm:iwxa',operationDigest:'b'.repeat(64)};
 const exportChallenge='real-original-employee-export-challenge';
 const exportedRight=evaluate(exportRequest,await s.registry.readState(),{
  now:iso(NOW),challenge:exportChallenge,
  proof:makeProof(exportRequest,exportChallenge,NOW,s.alice.signer,'TEST'),
  timeAssurance:'LOCAL_BEST_EFFORT'});
 assert.equal(exportedRight.allowed,true);
 assert.equal(exportedRight.statusSequence,2);
 const forbiddenExport=evaluate({...exportRequest,resource:'workspace:ws:south'},
  await s.registry.readState(),{
   now:iso(NOW),challenge:exportChallenge,
   proof:makeProof({...exportRequest,resource:'workspace:ws:south'},
     exportChallenge,NOW,s.alice.signer,'TEST'),
   timeAssurance:'LOCAL_BEST_EFFORT'});
 assert.equal(forbiddenExport.allowed,false);

 const replaced=await gate.authorize(inputs,{...auth,
  proof:makeProof(preview.request,challenge,NOW,s.bob.signer,'TEST')});
 assert.equal(replaced.allowed,false);
 assert.equal(replaced.outcome,'DENIED');
 // A signed work right cannot silently turn into export or administration.
 const escalation={...inputs,operation:{...inputs.operation,action:'grant.issue'}};
 const refused=await gate.authorize(escalation,auth);
 assert.equal(refused.allowed,false);
 assert.equal(s.kernel.calls.length,2);
});


function trustProof(s,{employee=s.alice,manager=s.north.credentialSigner,
  proofSigner=employee.signer}={}){
 const authorityId='issuer:north',organizationId='org:north',
  employeeWorkspaceId='ws:north',credentialKeyId=employee.signer.keyId,
  keyRecord=employee.record;
 const operationDigest=digest({schema:ORIGINAL_PROOF_KEY_ADMISSION,
  authorityId,organizationId,employeeWorkspaceId,credentialKeyId,keyRecord});
 const managerRequest={id:'proof-key:manager',actorId:'person:operator',
  principalId:organizationId,roleId:'role:manager',grantId:'grant:admin-north',
  audience:'host:t3',resource:'authority:'+authorityId,
  action:'grant.issue',purpose:'access-administration',
  realmId:'realm:iwxa',operationDigest};
 const employeeRequest={id:'proof-key:employee',actorId:employee.record.subjectId,
  principalId:organizationId,roleId:'worker',grantId:'proof-key:prospective',
  audience:'t3.employee.enrollment',resource:employeeWorkspaceId,
  action:'work.prepare',purpose:'work',
  realmId:'realm:iwxa',operationDigest};
 const managerChallenge='manager-original-admission-challenge';
 const employeeChallenge='employee-original-proof-challenge';
 return {authorityId,organizationId,employeeWorkspaceId,
  credentialKeyId,keyRecord,issuerSigner:s.north.issuerSigner,
  managerRequest,managerChallenge,
  managerProof:makeProof(managerRequest,managerChallenge,NOW,manager,'TEST'),
  employeeRequest,employeeChallenge,
  employeeProof:makeProof(employeeRequest,employeeChallenge,NOW,proofSigner,'TEST')};
}
test('new independent employee proof credential is admitted by original signed STATUS with one Kernel Object/Event',async()=>{
 const s=setup({pretrustEmployees:false});await s.init();
 await assert.rejects(s.owner.begin(s.input(s.alice)),
  {code:'T3_EMPLOYEE_CREDENTIAL_NOT_PRETRUSTED'});
 const args=trustProof(s);
 const admitted=await s.registry.admitProofCredential(args);
 assert.equal(admitted.state,'ORIGINAL_PROOF_CREDENTIAL_ADMITTED');
 assert.equal(admitted.kernelRevision,2);
 assert.equal(admitted.statusSequence,2);
 assert.equal(s.kernel.calls.length,2);
 const observed=await s.registry.readProofCredential({
  credentialKeyId:args.credentialKeyId,
  employeePersonId:'person:alice',authorityId:'issuer:north'});
 assert.equal(observed.state,'ORIGINAL_PROOF_CREDENTIAL_ADMITTED');
 assert.equal(observed.safeToRetry,false);
 const cold=createOriginalKernelRegistryStatePort({
  kernel:s.kernel.api,workspaceId:'ws:host-registry',
  trustedPolicy:s.fixture.policy,clock:time
 });
 const newState=await cold.readState();
 assert.equal(newState.policy.keys[args.credentialKeyId].subjectId,'person:alice');
 assert.equal(newState.statusFloor['issuer:north'],2);
 assert.equal(digest(newState.policy),admitted.policyDigest);
 await assert.rejects(cold.admitProofCredential(args),
  {code:'T3_ACCESS_PROOF_KEY_ALREADY_PRESENT'});
 const started=await s.owner.begin(s.input(s.alice));
 const issued=await s.owner.complete({enrollmentId:started.enrollmentId,
  employeeProof:makeProof(started.request,started.challenge,NOW,s.alice.signer,'TEST')});
 assert.equal(issued.employeePersonId,'person:alice');
 assert.equal(issued.statusSequence,3);
 assert.equal(s.kernel.calls.length,3);
 const restored=await cold.readState();
 assert.equal(restored.grants[issued.grantIds.work].payload.holderId,'person:alice');
 assert.equal(restored.statusFloor['issuer:north'],3);
});
test('proof-key admission refuses unauthorized manager, wrong employee key and cross-scope change before Kernel commit',async()=>{
 for(const variant of ['manager','employee','organization']){
  const s=setup({pretrustEmployees:false});await s.init();
  const args=trustProof(s);
  if(variant==='manager')
   args.managerProof=makeProof(args.managerRequest,args.managerChallenge,NOW,
     s.bob.signer,'TEST');
  if(variant==='employee')
   args.employeeProof=makeProof(args.employeeRequest,args.employeeChallenge,NOW,
     s.bob.signer,'TEST');
  if(variant==='organization')args.organizationId='org:south';
  const old=await s.registry.readState();
  await assert.rejects(s.registry.admitProofCredential(args));
  const after=await s.registry.readState();
  assert.equal(digest(after),digest(old));
  assert.equal(s.kernel.calls.length,1);
 }
});


test('original proof-key trust refuses a second manager credential even with a valid signature',async()=>{
 const s=setup({pretrustEmployees:false});await s.init();
 const twin=employee('key:operator-double','person:operator');
 const args=trustProof(s,{employee:twin,proofSigner:twin.signer});
 await assert.rejects(s.registry.admitProofCredential(args),
  {code:'T3_ACCESS_PROOF_KEY_EMPLOYEE_MUST_BE_INDEPENDENT'});
 assert.equal(s.kernel.calls.length,1);
});
test('lost ACK after signed credential trust writes exactly one original Kernel event',async()=>{
 const s=setup({pretrustEmployees:false});await s.init();
 const args=trustProof(s);s.loseNext();
 await assert.rejects(s.registry.admitProofCredential(args),
  /SIMULATED_LOST_ACK_AFTER_KERNEL_COMMIT/);
 const recovered=await s.registry.readProofCredential({
  authorityId:args.authorityId,credentialKeyId:args.credentialKeyId,
  employeePersonId:'person:alice'});
 assert.equal(recovered.state,'ORIGINAL_PROOF_CREDENTIAL_ADMITTED');
 assert.equal(recovered.safeToRetry,false);
 assert.equal(s.kernel.calls.length,2);
 await assert.rejects(s.registry.admitProofCredential(args),
  {code:'T3_ACCESS_PROOF_KEY_ALREADY_PRESENT'});
 assert.equal(s.kernel.calls.length,2);
});
test('unsigned proof-key injection into Kernel Object/Event cannot update initial trusted issuer policy',async()=>{
 const s=setup({pretrustEmployees:false});await s.init();
 const {api}=s.kernel;
 const prior=(await api.getObject('ws:host-registry','t3.access.signed-registry')).object;
 const poisoned=structuredClone(prior.data);
 poisoned.policy.keys['key:rogue-employee']=s.alice.record;
 poisoned.policy.keys['key:rogue-employee'].subjectId='person:rogue';
 const revised=prior.revision+1;
 await api.putObject({workspace_id:'ws:host-registry',
  object_id:'t3.access.signed-registry',
  schema_id:'iwxa.t3.access.signed-registry',schema_version:'1.0.0',
  base_revision:prior.revision,data:poisoned,extensions:{},
  event:{event_type:'t3.access.signed_registry.persisted',payload:{
    object_id:'t3.access.signed-registry',revision:revised,
    policy_digest:digest(poisoned.policy),
    state_digest:digest(poisoned),status_sequences:poisoned.statusFloor
  }}});
 await assert.rejects(s.registry.readState(),
  {code:'T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT'});
});
