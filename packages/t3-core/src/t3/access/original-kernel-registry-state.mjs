// Durable signed AccessRegistry STATE in the already inherited T2 Kernel Store.
// Not a new Store, database, IAM or signer. The trusted Host supplies the same
// original KernelFacade (getObject/putObject/listEventsSince) and a pinned,
// independently trusted policy. No private key, passphrase or issuer is saved.
// Access decisions continue to use the canonical IWXA T3 evaluate() algorithm.
import {
  canonical,digest,snapshot,copy,fields,validatePolicy,validateGrant,verifyRecord,
  validateStatusSnapshot,assertStatusTransitionHistory,iso,signRecord,evaluate,timestamp
} from "./core.mjs";
import {deriveOriginalNetworkKeyTransition,validateOriginalNetworkKeyTransition,
  originalNetworkKeyOperationDigest,ORIGINAL_NETWORK_KEY_MANAGE}
  from "./original-network-key-lifecycle.mjs";

export const ORIGINAL_REGISTRY_SCHEMA="iwxa.t3.access.signed-registry";
export const ORIGINAL_REGISTRY_EVENT="t3.access.signed_registry.persisted";
// A product gate must be bound to the actual pinned original Kernel registry,
// not to a caller-supplied object pretending to provide readState().
const originalPorts=new WeakSet();
export function isOriginalKernelRegistryStatePort(value) {
  return !!value&&typeof value==="object"&&originalPorts.has(value);
}
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const no=code=>{const e=new Error(code);e.name="T3OriginalKernelRegistryError";
  e.code=code;e.outcome="DENIED";throw e;};
const check=(condition,code)=>{if(!condition)no(code);};
const same=(a,b)=>canonical(a)===canonical(b);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const dictionary=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
function assertNames(value,code) {
  check(dictionary(value),code);
  for(const id of Object.keys(value))check(ID.test(id),code);
}
// The pinned original trust root is never replaced by caller-provided keys.
export const ORIGINAL_PROOF_KEY_ADMISSION="IWXA_T3_ORIGINAL_PROOF_KEY_ADMISSION/1";
function addProofOnlyKey(policy,keyId,record){
  check(ID.test(keyId) && !own(policy.keys,keyId),
    "T3_ACCESS_PROOF_KEY_ALREADY_PRESENT");
  check(dictionary(record)&&Object.keys(record).sort().join()===
    ["subjectId","environment","publicKey","status","uses","notBefore","expiresAt"].sort().join()&&
    ID.test(record.subjectId)&&record.environment===policy.environment&&
    record.status==="ACTIVE"&&Array.isArray(record.uses)&&
    record.uses.length===1&&record.uses[0]==="PROOF"&&
    !Object.values(policy.keys).some(other=>other.publicKey===record.publicKey),
    "T3_ACCESS_PROOF_KEY_SCOPE_INVALID");
  const next=copy(policy);next.keys[keyId]=copy(record);
  try{validatePolicy(next);}catch{no("T3_ACCESS_PROOF_KEY_METADATA_INVALID");}
  return next;
}
// Add exactly one independently proven employee recipient to the pinned
// organizational authority ceiling. This is evidenced by the original
// manager+employee PROOF admission and replay-verified Kernel Event, not
// a wildcard, unsigned browser input or a new policy owner.
function scopedEmployeeRecipientPolicy(policy,authorityId,employeePersonId){
  const next=copy(policy),resource="recipient:"+employeePersonId;
  check(next.authorities[authorityId]&&ID.test(employeePersonId),
    "T3_ACCESS_PROOF_RECIPIENT_AUTHORITY_INVALID");
  const resources=next.authorities[authorityId].resources;
  if(!resources.includes(resource))resources.push(resource);
  try{validatePolicy(next);}
  catch{no("T3_ACCESS_PROOF_RECIPIENT_SCOPE_INVALID");}
  return next;
}
const admissionDigest=trust=>digest({
  old_policy_digest:trust.old_policy_digest,
  key_id:trust.key_id,key_record:trust.key_record,
  manager_decision_digest:trust.manager_decision_digest,
  employee_proof_digest:trust.employee_proof_digest,
  recipient_resource:trust.recipient_resource,
  authority_id:trust.authority_id,
});
const signedAdmissionStatusId=trust=>"status:proof-key:"+admissionDigest(trust);
function verifyProofKeyAdmission(trust,current,event){
  check(dictionary(trust)&&trust.schema===ORIGINAL_PROOF_KEY_ADMISSION&&
    typeof trust.old_policy_digest==="string"&&HEX.test(trust.old_policy_digest)&&
    typeof trust.manager_decision_digest==="string"&&HEX.test(trust.manager_decision_digest)&&
    typeof trust.employee_proof_digest==="string"&&HEX.test(trust.employee_proof_digest)&&
    trust.old_policy_digest===digest(current)&&
    ID.test(trust.authority_id??"")&&ID.test(trust.key_id??""),
    "T3_ACCESS_PROOF_KEY_ADMISSION_INVALID");
  const authority=current.authorities[trust.authority_id];
  check(authority&&authority.principalId!==trust.key_record?.subjectId,
    "T3_ACCESS_PROOF_KEY_ISSUER_CONFLICT");
  check(trust.recipient_resource==="recipient:"+trust.key_record?.subjectId,
    "T3_ACCESS_PROOF_RECIPIENT_SCOPE_INVALID");
  const next=scopedEmployeeRecipientPolicy(
    addProofOnlyKey(current,trust.key_id,trust.key_record),
    trust.authority_id,trust.key_record.subjectId);
  check(digest(next)===event.payload.policy_digest,
    "T3_ACCESS_PROOF_KEY_POLICY_DIGEST_INVALID");
  const statement=trust.signed_status;
  const at=Date.parse(statement?.payload?.issuedAt??"");
  check(Number.isSafeInteger(at)&&at>0&&
    statement.payload.id===signedAdmissionStatusId(trust)&&
    statement.payload.authorityId===trust.authority_id&&
    statement.payload.realmId===current.realmId&&
    statement.payload.membershipEpoch===authority.membershipEpoch&&
    statement.payload.sequence===event.payload.status_sequences[trust.authority_id]&&
    authority.statusKeys.includes(statement.keyId),
    "T3_ACCESS_PROOF_KEY_SIGNED_STATUS_INVALID");
  try{verifyRecord(statement,current,at,"STATUS");}
  catch{no("T3_ACCESS_PROOF_KEY_ISSUER_SIGNATURE_INVALID");}
  return next;
}

function validClock(clock){
  const value=clock();
  check(Number.isSafeInteger(value)&&value>0,"T3_ACCESS_REGISTRY_CLOCK_INVALID");
  return value;
}
function stateAt(raw,policy,now) {
  let state;
  try {
    state=snapshot(raw);
    check(dictionary(state),"T3_ACCESS_REGISTRY_STATE_INVALID");
    check(same(state.policy,policy),"T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH");
    validatePolicy(state.policy);
    for(const name of ["grants","statuses","statusFloor","tombstones"])
      assertNames(state[name],"T3_ACCESS_REGISTRY_STATE_INVALID");
    if(state.lastObservedAt!==undefined) {
      check(typeof state.lastObservedAt==="string" &&
        state.lastObservedAt===iso(Date.parse(state.lastObservedAt)),
        "T3_ACCESS_REGISTRY_OBSERVED_CLOCK_INVALID");
      check(now>=Date.parse(state.lastObservedAt),
        "T3_ACCESS_REGISTRY_CLOCK_ROLLBACK");
    }
    const keys=Object.keys(policy.authorities);
    check(keys.length>0 &&
      Object.keys(state.statuses).length===keys.length &&
      Object.keys(state.statusFloor).length===keys.length,
      "T3_ACCESS_REGISTRY_AUTHORITY_SET_INVALID");
    for(const authorityId of keys) {
      check(own(state.statuses,authorityId) && own(state.statusFloor,authorityId),
        "T3_ACCESS_REGISTRY_STATUS_MISSING");
      const status=validateStatusSnapshot(authorityId,state,now);
      check(status.sequence===state.statusFloor[authorityId],
        "T3_ACCESS_REGISTRY_FLOOR_MISMATCH");
    }
    for(const [grantId,env] of Object.entries(state.grants)){
      const grant=validateGrant(env.payload);
      check(grant.id===grantId && own(policy.authorities,grant.authorityId),
        "T3_ACCESS_REGISTRY_GRANT_INVALID");
      verifyRecord(env,policy,now,"GRANT");
    }
    return state;
  }catch(error) {
    if(error?.name==="T3OriginalKernelRegistryError")throw error;
    no("T3_ACCESS_REGISTRY_SIGNED_STATE_INVALID");
  }
}
function assertForward(previous,next) {
  check(same(previous.policy,next.policy),
    "T3_ACCESS_REGISTRY_POLICY_CHANGE_REQUIRES_TRUST_REISSUE");
  for(const [id,grant] of Object.entries(previous.grants)){
    check(own(next.grants,id)&&same(next.grants[id],grant),
      "T3_ACCESS_REGISTRY_GRANT_HISTORY_ROLLBACK");
  }
  for(const [id,tombstone] of Object.entries(previous.tombstones)){
    check(own(next.tombstones,id)&&same(next.tombstones[id],tombstone),
      "T3_ACCESS_REGISTRY_TOMBSTONE_ROLLBACK");
  }
  for(const [id,envelope] of Object.entries(previous.statuses)){
    const prior=envelope.payload,nextStatus=next.statuses[id].payload;
    check(nextStatus.sequence>=prior.sequence,
      "T3_ACCESS_REGISTRY_SEQUENCE_ROLLBACK");
    if(nextStatus.sequence===prior.sequence)
      check(same(envelope,next.statuses[id]),"T3_ACCESS_REGISTRY_SAME_SEQUENCE_CHANGED");
    else assertStatusTransitionHistory(prior,nextStatus,"ACCESS_REGISTRY");
    check(next.statusFloor[id]>=previous.statusFloor[id],
      "T3_ACCESS_REGISTRY_FLOOR_ROLLBACK");
  }
  if(previous.lastObservedAt)
    check(Date.parse(next.lastObservedAt)>=Date.parse(previous.lastObservedAt),
      "T3_ACCESS_REGISTRY_CLOCK_ROLLBACK");
}

/**
 * No implicit issuance or fallback. First write needs explicit signed state
 * and a trusted policy pinned outside the user-writable Kernel object.
 * All revisions and chronological evidence remain in the ORIGINAL T2 Store.
 * The Host can construct a fresh port after process/browser restart using
 * the existing pinned policy and existing KernelFacade.
 */
export function createOriginalKernelRegistryStatePort({
  kernel,workspaceId,objectId="t3.access.signed-registry",
  trustedPolicy,clock=Date.now
}={}){
  const direct=typeof kernel?.putObject==="function"&&
    kernel.hasOperation?.("t1.putObject")===true;
  const graph=typeof kernel?.commitObjectGraph==="function"&&
    kernel.hasOperation?.("t1.commitObjectGraph")===true;
  check(ID.test(workspaceId??"")&&ID.test(objectId??"") &&
    kernel?.sessionInfo?.contract_version==="1.3.0" &&
    ["getObject","listEventsSince"].every(k=>
      typeof kernel?.[k]==="function") &&
    typeof kernel.hasOperation==="function"&&(direct||graph)&&
    ["t1.getObject","t1.listEventsSince"].every(op=>
      kernel.hasOperation(op))&&typeof clock==="function",
    "T3_ACCESS_REGISTRY_ORIGINAL_KERNEL_REQUIRED");
  let pinned;
  try{pinned=snapshot(trustedPolicy);validatePolicy(pinned);}
  catch{no("T3_ACCESS_REGISTRY_TRUST_ANCHOR_REQUIRED");}
  const trustedHash=digest(pinned),registryIdentity=Object.freeze({workspaceId,objectId,rootPolicyDigest:trustedHash});
  // Installed original Admin D3 exposes the original atomic T2 graph,
  // while prior original Host contracts expose putObject. Both preserve
  // the same signed registry Object/Event and readback. No second Store.
  const persistOriginal=async command=>{
    if(direct)return kernel.putObject(command);
    return kernel.commitObjectGraph({
      workspace_id:command.workspace_id,
      idempotency_key:digest({
        schema:"IWXA_T3_SIGNED_REGISTRY_ORIGINAL_GRAPH_COMMIT/1",
        workspaceId:command.workspace_id,objectId:command.object_id,
        baseRevision:command.base_revision,record:command.data,
        event:command.event,
      }),
      object:{
        object_id:command.object_id,schema_id:command.schema_id,
        schema_version:command.schema_version,
        base_revision:command.base_revision,data:command.data,
        extensions:command.extensions??{},
      },
      event:command.event,
    });
  };
  const read=async({allowAbsent=false}={})=>{
    const now=validClock(clock);
    const result=await kernel.getObject(workspaceId,objectId);
    if(!result){
      if(allowAbsent)return null;
      no("T3_ACCESS_REGISTRY_STATE_UNAVAILABLE");
    }
    const record=result.object;
    check(record?.workspace_id===workspaceId &&
      record.object_id===objectId &&
      record.schema_id===ORIGINAL_REGISTRY_SCHEMA &&
      record.schema_version==="1.0.0" &&
      Number.isSafeInteger(record.revision)&&record.revision>0,
      "T3_ACCESS_REGISTRY_ORIGINAL_RECEIPT_INVALID");
    const events=await kernel.listEventsSince(workspaceId);
    check(Array.isArray(events),"T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_UNAVAILABLE");
    const journal=events.filter(e=>e?.event_type===ORIGINAL_REGISTRY_EVENT &&
      e?.payload?.object_id===objectId);
    check(journal.length>0,"T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_MISSING");
    // The ORIGINAL T2 event journal is the monotonic evidence. A caller
    // cannot silently replay an earlier signed STATUS by rewriting only the
    // latest Object revision while its higher-sequence event remains.
    // Historical original Kernel Events are the signed policy progression.
    // An admitted employee proof key cannot become a new issuer or admin.
    let observedPolicy=copy(pinned),currentHash=trustedHash;
    let priorFloors=null,expectedRevision=0;
    const networkBindings=new Map(),networkTransitions=new Map();
    for(const event of journal){
      expectedRevision++;
      check(event.workspace_id===workspaceId &&
        event.payload?.object_id===objectId&&
        event.payload.revision===expectedRevision &&
        dictionary(event.payload.status_sequences) &&
        Object.keys(event.payload.status_sequences).length===
          Object.keys(pinned.authorities).length,
        "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
      const trust=event.payload.proof_credential_admission,network=event.payload.network_key_transition;
      check(trust===undefined||network===undefined,"T3_ACCESS_REGISTRY_MULTIPLE_POLICY_TRANSITIONS");
      if(network!==undefined){
        check(expectedRevision>1&&priorFloors&&dictionary(network)&&ID.test(event.event_id??""),
          "T3_ACCESS_NETWORK_KEY_HISTORY_INVALID");
        let derived;
        try{derived=deriveOriginalNetworkKeyTransition({transition:network.transition,signedStatus:network.signed_status,
          policy:observedPolicy,bindings:networkBindings,priorFloors,registryIdentity});}
        catch(error){no(error?.code??"T3_ACCESS_NETWORK_KEY_HISTORY_INVALID");}
        const c=derived.transition.claims;
        check(!networkTransitions.has(c.transitionRef)&&event.payload.policy_digest===digest(derived.policy),
          "T3_ACCESS_NETWORK_KEY_HISTORY_CONFLICT");
        for(const authorityId of Object.keys(pinned.authorities))check(event.payload.status_sequences[authorityId]===
          priorFloors[authorityId]+(authorityId===c.authorityId?1:0),"T3_ACCESS_NETWORK_KEY_SEQUENCE_INVALID");
        observedPolicy=derived.policy;currentHash=digest(observedPolicy);
        networkBindings.set(derived.binding.bindingRef,derived.binding);
        networkTransitions.set(c.transitionRef,{transition:derived.transition,signedStatus:copy(network.signed_status),
          revision:expectedRevision,eventId:event.event_id,binding:derived.binding});
      }else if(trust!==undefined){
        check(expectedRevision>1&&priorFloors,
          "T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH");
        observedPolicy=verifyProofKeyAdmission(trust,observedPolicy,event);
        currentHash=digest(observedPolicy);
        for(const authorityId of Object.keys(pinned.authorities)){
          const delta=authorityId===trust.authority_id?1:0;
          check(event.payload.status_sequences[authorityId]===
            priorFloors[authorityId]+delta,
            "T3_ACCESS_PROOF_KEY_STATUS_SEQUENCE_INVALID");
        }
      }else{
        check(event.payload.policy_digest===currentHash,
          expectedRevision===1?"T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH":
            "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
      }
      for(const authorityId of Object.keys(pinned.authorities)){
        const observed=event.payload.status_sequences[authorityId];
        check(Number.isSafeInteger(observed)&&observed>=0&&
          (priorFloors===null||observed>=priorFloors[authorityId]),
          "T3_ACCESS_REGISTRY_ORIGINAL_SEQUENCE_ROLLBACK");
      }
      priorFloors=event.payload.status_sequences;
    }
    check(same(observedPolicy,record.data?.policy),
      "T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH");
    const state=stateAt(record.data,observedPolicy,now);
    for(const authorityId of Object.keys(pinned.authorities)){
      check(priorFloors[authorityId]===state.statusFloor[authorityId],
        "T3_ACCESS_REGISTRY_ORIGINAL_SEQUENCE_ROLLBACK");
    }
    const last=journal.at(-1);
    check(last.workspace_id===workspaceId &&
      last.payload.revision===record.revision &&
      last.payload.policy_digest===digest(state.policy) &&
      last.payload.state_digest===digest(state),
      "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
    return Object.freeze({revision:record.revision,state:copy(state),networkBindings,networkTransitions});
  };
  const commit=async(signedState)=>{
    const before=await read({allowAbsent:true});
    const now=validClock(clock);
    const draft=copy(signedState);
    draft.lastObservedAt=iso(now);
    const next=stateAt(draft,before?.state.policy??pinned,now);
    if(before) assertForward(before.state,next);
    const revision=(before?.revision??0)+1;
    const digestState=digest(next);
    const receipt=await persistOriginal({
      workspace_id:workspaceId,object_id:objectId,
      schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:"1.0.0",
      base_revision:before?.revision??0,data:next,extensions:{},
      event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{
        object_id:objectId,revision,policy_digest:digest(next.policy),
        state_digest:digestState,status_sequences:copy(next.statusFloor),
      }},
    });
    check(receipt?.object?.workspace_id===workspaceId &&
      receipt.object.object_id===objectId &&
      receipt.object.revision===revision &&
      receipt.event?.workspace_id===workspaceId,
      "T3_ACCESS_REGISTRY_ORIGINAL_COMMIT_INVALID");
    // Never treat an unverified receipt as a committed authority change.
    const committed=await read();
    check(committed.revision===revision&&same(committed.state,next),
      "T3_ACCESS_REGISTRY_READBACK_MISMATCH");
    return Object.freeze({revision,policy_digest:digest(next.policy),
      state_digest:digestState,event_id:receipt.event.event_id});
  };
  // Only a trusted issuer Host holding the existing original signer can
  // authorize a proof-only key. Both human manager and independent employee
  // sign bound original Access proofs BEFORE the original Kernel commits.
  const admitProofCredential=async({
    authorityId,organizationId,employeeWorkspaceId,credentialKeyId,keyRecord,
    issuerSigner,managerRequest,managerChallenge,managerProof,
    employeeRequest,employeeChallenge,employeeProof
  }={})=>{
    const before=await read(),now=validClock(clock);
    const state=before.state,auth=state.policy.authorities[authorityId];
    check(auth&&auth.principalId===organizationId&&
      state.policy.realmId===managerRequest?.realmId&&
      ID.test(employeeWorkspaceId??"")&&auth.resources.includes(employeeWorkspaceId)&&
      issuerSigner&&auth.issuerKeys.includes(issuerSigner.keyId)&&
      auth.statusKeys.includes(issuerSigner.keyId),
      "T3_ACCESS_PROOF_KEY_TRUSTED_ISSUER_REQUIRED");
    check(ID.test(credentialKeyId??"")&&ID.test(keyRecord?.subjectId??"")&&
      keyRecord.subjectId!==organizationId &&
      timestamp(keyRecord.notBefore)<=now&&now<timestamp(keyRecord.expiresAt),
      "T3_ACCESS_PROOF_KEY_PERSON_INVALID");
    const newPolicy=scopedEmployeeRecipientPolicy(
      addProofOnlyKey(state.policy,credentialKeyId,keyRecord),
      authorityId,keyRecord.subjectId);
    const operationDigest=digest({schema:ORIGINAL_PROOF_KEY_ADMISSION,
      authorityId,organizationId,employeeWorkspaceId,credentialKeyId,keyRecord});
    check(managerRequest?.principalId===organizationId&&
      managerRequest.action==="grant.issue"&&
      managerRequest.resource==="authority:"+authorityId&&
      managerRequest.purpose==="access-administration"&&
      managerRequest.operationDigest===operationDigest&&
      typeof managerChallenge==="string"&&managerChallenge.length>=16,
      "T3_ACCESS_PROOF_KEY_MANAGER_SCOPE_INVALID");
    const decision=evaluate(managerRequest,state,{
      now:iso(now),challenge:managerChallenge,proof:managerProof,
      timeAssurance:"LOCAL_BEST_EFFORT"});
    check(decision.outcome==="PERMITTED"&&decision.allowed===true,
      "T3_ACCESS_PROOF_KEY_MANAGER_NOT_AUTHORIZED");
    // Admitting a second proof key for an existing administrator could make
    // an employee appear as that manager under previously issued grants.
    check(keyRecord.subjectId!==managerRequest.actorId&&
      !Object.values(state.grants).some(env=>
        env.payload.holderId===keyRecord.subjectId&&
        env.payload.rightClass==="ADMINISTRATION"),
      "T3_ACCESS_PROOF_KEY_EMPLOYEE_MUST_BE_INDEPENDENT");
    check(employeeRequest?.actorId===keyRecord.subjectId&&
      employeeRequest.principalId===organizationId&&
      employeeRequest.realmId===state.policy.realmId&&
      employeeRequest.resource===employeeWorkspaceId&&
      employeeRequest.action==="work.prepare"&&
      employeeRequest.operationDigest===operationDigest&&
      typeof employeeChallenge==="string"&&employeeChallenge.length>=16&&
      employeeProof?.keyId===credentialKeyId,
      "T3_ACCESS_PROOF_KEY_EMPLOYEE_BINDING_INVALID");
    try {verifyRecord(employeeProof,newPolicy,now,"PROOF");}
    catch {no("T3_ACCESS_PROOF_KEY_EMPLOYEE_SIGNATURE_INVALID");}
    const p=employeeProof.payload;
    check(p.challenge===employeeChallenge&&
      p.requestDigest===digest(employeeRequest)&&
      timestamp(p.issuedAt)<=now&&now<timestamp(p.expiresAt)&&
      now-timestamp(p.issuedAt)<state.policy.proofMaxAgeSeconds*1000&&
      timestamp(p.expiresAt)-timestamp(p.issuedAt)<=
        state.policy.proofMaxAgeSeconds*1000,
      "T3_ACCESS_PROOF_KEY_EMPLOYEE_PROOF_INVALID");
    const next=copy(state);
    next.policy=newPolicy;
    const previous=state.statuses[authorityId].payload;
    const keyExpires=timestamp(state.policy.keys[issuerSigner.keyId].expiresAt);
    const validUntil=Math.min(now+state.policy.offlineMaxAgeSeconds*1000,
      keyExpires,timestamp(keyRecord.expiresAt));
    check(validUntil>now,"T3_ACCESS_PROOF_KEY_STATUS_WINDOW_INVALID");
    const trust={schema:ORIGINAL_PROOF_KEY_ADMISSION,
      old_policy_digest:digest(state.policy),key_id:credentialKeyId,
      key_record:copy(keyRecord),authority_id:authorityId,
      manager_decision_digest:digest(decision),
      employee_proof_digest:digest(employeeProof),
      recipient_resource:"recipient:"+keyRecord.subjectId};
    const nextStatus=signRecord({...previous,
      id:signedAdmissionStatusId(trust),
      sequence:previous.sequence+1,issuedAt:iso(now),validUntil:iso(validUntil)
    },issuerSigner);
    try{verifyRecord(nextStatus,state.policy,now,"STATUS");}
    catch{no("T3_ACCESS_PROOF_KEY_SIGNER_REJECTED");}
    next.statuses[authorityId]=nextStatus;
    next.statusFloor[authorityId]=previous.sequence+1;
    trust.signed_status=copy(nextStatus);
    next.lastObservedAt=iso(now);
    const checked=stateAt(next,next.policy,now);
    const expectedRevision=before.revision+1;
    const receipt=await persistOriginal({
      workspace_id:workspaceId,object_id:objectId,
      schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:"1.0.0",
      base_revision:before.revision,data:checked,extensions:{},
      event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{
        object_id:objectId,revision:expectedRevision,
        policy_digest:digest(checked.policy),state_digest:digest(checked),
        status_sequences:copy(checked.statusFloor),
        proof_credential_admission:trust,
      }}
    });
    check(receipt?.object?.revision===expectedRevision&&
      receipt.event?.workspace_id===workspaceId,
      "T3_ACCESS_PROOF_KEY_ORIGINAL_KERNEL_RECEIPT_INVALID");
    const verified=await read();
    check(verified.revision===expectedRevision&&
      same(verified.state,checked),
      "T3_ACCESS_PROOF_KEY_ORIGINAL_READBACK_UNKNOWN");
    return Object.freeze({schema:ORIGINAL_PROOF_KEY_ADMISSION,
      state:"ORIGINAL_PROOF_CREDENTIAL_ADMITTED",
      organizationId,authorityId,credentialKeyId,
      employeePersonId:keyRecord.subjectId,
      recipientResource:"recipient:"+keyRecord.subjectId,
      policyDigest:digest(checked.policy),
      rootPolicyDigest:trustedHash,statusSequence:checked.statusFloor[authorityId],
      kernelRevision:expectedRevision,originalKernelEventId:receipt.event.event_id,
      exactReadback:true,signatureVerified:true,productionActivation:false});
  };
  const readProofCredential=async({credentialKeyId,employeePersonId,authorityId}={})=>{
    check(ID.test(credentialKeyId??"")&&ID.test(employeePersonId??"")&&
      ID.test(authorityId??""),
      "T3_ACCESS_PROOF_CREDENTIAL_READ_ARGUMENT_INVALID");
    const latest=await read(),state=latest.state;
    const policyKey=state.policy.keys[credentialKeyId];
    if(!policyKey)return Object.freeze({state:"ORIGINAL_PROOF_CREDENTIAL_ABSENT",
      credentialKeyId,employeePersonId,originalReadback:true,safeToRetry:false});
    check(policyKey.subjectId===employeePersonId&&
      state.policy.authorities[authorityId]&&
      policyKey.uses.length===1&&policyKey.uses[0]==="PROOF",
      "T3_ACCESS_PROOF_CREDENTIAL_SUBJECT_MISMATCH");
    const journal=await kernel.listEventsSince(workspaceId);
    const event=journal.find(x=>
      x.event_type===ORIGINAL_REGISTRY_EVENT&&
      x.payload?.proof_credential_admission?.key_id===credentialKeyId&&
      x.payload.proof_credential_admission.authority_id===authorityId);
    check(event,"T3_ACCESS_PROOF_CREDENTIAL_ADMISSION_NOT_AUTHENTICATED");
    return Object.freeze({state:"ORIGINAL_PROOF_CREDENTIAL_ADMITTED",
      credentialKeyId,employeePersonId,authorityId,
      policyDigest:digest(state.policy),originalReadback:true,
      signedStatusDigest:digest(event.payload.proof_credential_admission.signed_status),
      safeToRetry:false});
  };
  // Network key lifecycle commits through the SAME original Registry Object
  // and Event CAS. It accepts an existing authority's signed STATUS and
  // current administrator proof; it does not issue either of them.
  const applyNetworkKeyTransition=async(input={})=>{
    const args=copy(input);
    fields(args,['transition','signedStatus','managerRequest','managerChallenge','managerProof'],['confirmations']);
    const transition=validateOriginalNetworkKeyTransition(args.transition),c=transition.claims,signedStatus=args.signedStatus;
    const committedResult=(latest,outcome)=>{
      const entry=latest.networkTransitions.get(c.transitionRef);
      if(!entry)return null;
      check(same(entry.transition,transition)&&same(entry.signedStatus,signedStatus),
        "T3_ACCESS_NETWORK_KEY_TRANSITION_REF_CONFLICT");
      const current=latest.networkBindings.get(c.binding.bindingRef),key=latest.state.policy.keys[entry.binding.keyId],now=validClock(clock);
      return Object.freeze({state:outcome,transitionRef:c.transitionRef,bindingRef:c.binding.bindingRef,
        committedKeyId:entry.binding.keyId,kernelRevision:entry.revision,originalKernelEventId:entry.eventId,
        currentBinding:copy(current),keyCurrentlyActive:current.active&&current.keyId===entry.binding.keyId&&
          key?.status==='ACTIVE'&&timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt),
        originalReadback:true,safeToRetry:false,createsGrant:false});
    };
    const before=await read(),already=committedResult(before,"ORIGINAL_NETWORK_KEY_ALREADY_COMMITTED");
    if(already)return already;
    const now=validClock(clock),state=before.state,authority=state.policy.authorities[c.authorityId];
    const derived=deriveOriginalNetworkKeyTransition({transition,signedStatus,policy:state.policy,
      bindings:before.networkBindings,priorFloors:state.statusFloor,registryIdentity});
    check(timestamp(c.issuedAt)<=now&&now-timestamp(c.issuedAt)<state.policy.proofMaxAgeSeconds*1000,
      "T3_ACCESS_NETWORK_KEY_TRANSITION_EXPIRED");
    const request=args.managerRequest;
    check(request?.principalId===c.principalId&&request.resource===c.binding.workspaceId&&
      request.realmId===state.policy.realmId&&request.action===ORIGINAL_NETWORK_KEY_MANAGE&&
      request.purpose==="access-administration"&&request.operationDigest===originalNetworkKeyOperationDigest(transition),
      "T3_ACCESS_NETWORK_KEY_MANAGER_SCOPE_INVALID");
    const decision=evaluate(request,state,{now:iso(now),challenge:args.managerChallenge,
      proof:args.managerProof,confirmations:args.confirmations??[],timeAssurance:"LOCAL_BEST_EFFORT"});
    check(decision.allowed===true&&decision.outcome==="PERMITTED"&&decision.authorityPath.at(-1)?.authorityId===c.authorityId,
      "T3_ACCESS_NETWORK_KEY_MANAGER_DENIED");
    const priorStatus=state.statuses[c.authorityId].payload;
    check(authority&&same(priorStatus.entries,signedStatus.payload.entries),
      "T3_ACCESS_NETWORK_KEY_CANNOT_CHANGE_GRANT_STATUS");
    assertStatusTransitionHistory(priorStatus,signedStatus.payload,"NETWORK_KEY_STATUS");
    const next=copy(state);next.policy=derived.policy;
    next.statuses[c.authorityId]=copy(signedStatus);next.statusFloor[c.authorityId]=c.expectedStatusSequence+1;
    next.lastObservedAt=iso(now);
    const checked=stateAt(next,next.policy,now),revision=before.revision+1;
    const command={workspace_id:workspaceId,object_id:objectId,
      schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:"1.0.0",base_revision:before.revision,
      data:checked,extensions:{},event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{
        object_id:objectId,revision,policy_digest:digest(checked.policy),state_digest:digest(checked),
        status_sequences:copy(checked.statusFloor),network_key_transition:{transition,signed_status:copy(signedStatus)}
      }}};
    let receipt=null,uncertain=false;
    try{receipt=await persistOriginal(command);}
    catch{uncertain=true;}
    // Never repeat an ambiguous original mutation. Recover the exact
    // signed Event from the current original history, even if a later
    // authorized transition has already changed the current key.
    let latest;
    try{latest=await read();}catch{no("T3_ACCESS_NETWORK_KEY_ORIGINAL_OUTCOME_UNKNOWN");}
    const result=committedResult(latest,uncertain?"ORIGINAL_NETWORK_KEY_COMMIT_RECOVERED":"ORIGINAL_NETWORK_KEY_COMMITTED");
    check(result&&result.kernelRevision===revision,"T3_ACCESS_NETWORK_KEY_ORIGINAL_OUTCOME_UNKNOWN");
    if(!uncertain)check(receipt?.object?.workspace_id===workspaceId&&receipt.object.object_id===objectId&&
      receipt.object.revision===revision&&receipt.event?.event_id===result.originalKernelEventId,
      "T3_ACCESS_NETWORK_KEY_ORIGINAL_RECEIPT_INVALID");
    return result;
  };
  const readNetworkKeyEvidence=async(query={})=>{
    const q=copy(query),required=["keyId","nodeRef","recipientNodeRef","workspaceId","originalWriteOwnerRef","scopeRef"];
    fields(q,[...required,'ownerEpoch']);
    check(required.every(k=>ID.test(q[k]??""))&&Number.isSafeInteger(q.ownerEpoch)&&q.ownerEpoch>=1,
      "T3_ACCESS_NETWORK_KEY_QUERY_INVALID");
    const latest=await read(),matching=[...latest.networkBindings.values()].filter(b=>b.active&&
      required.every(k=>b[k]===q[k])&&b.ownerEpoch===q.ownerEpoch);
    check(matching.length<=1,"T3_ACCESS_NETWORK_KEY_BINDING_AMBIGUOUS");
    if(!matching.length)return null;
    const binding=matching[0],key=latest.state.policy.keys[binding.keyId],now=validClock(clock);
    if(!key||key.status!=="ACTIVE"||key.subjectId!==binding.subjectId||
      key.uses.length!==1||key.uses[0]!=="NETWORK_FRAME"||
      !(timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt)))return null;
    return Object.freeze({binding:copy(binding),key:copy(key),policyDigest:digest(latest.state.policy),
      originalRegistryRevision:latest.revision,originalReadback:true});
  };
  const port=Object.freeze({
    readState:async()=>copy((await read()).state),
    applyNetworkKeyTransition,readNetworkKeyEvidence,
    commitSignedState:commit,
    admitProofCredential,readProofCredential,
    getStatus:async()=>{const state=(await read()).state;
      return Object.freeze({sequences:copy(state.statusFloor),
        policy_digest:digest(state.policy),root_policy_digest:trustedHash});},
  });
  originalPorts.add(port);
  return port;
}
