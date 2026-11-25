// Durable signed AccessRegistry STATE in the already inherited T2 Kernel Store.
// Not a new Store, database, IAM or signer. The trusted Host supplies the same
// original KernelFacade (getObject/putObject/listEventsSince) and a pinned,
// independently trusted policy. No private key, passphrase or issuer is saved.
// Access decisions continue to use the canonical IWXA T3 evaluate() algorithm.
import {
  canonical,digest,snapshot,copy,validatePolicy,validateGrant,verifyRecord,
  validateStatusSnapshot,assertStatusTransitionHistory,iso,signRecord,evaluate,timestamp
} from "./core.mjs";

import {CORPORATE_SEAT_ACTION,CORPORATE_SEAT_RESOURCE,CORPORATE_SEAT_PURPOSE,
  corporateSeatPolicyReady} from './product-contracts.mjs';

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

// An existing organization may predate the commercial seat feature. Extend
// ONLY this fixed product ceiling, under its already pinned original issuer.
// No grant, membership, publisher key or second policy owner is created.
export const ORIGINAL_CORPORATE_SEAT_POLICY='IWXA_T3_ORIGINAL_CORPORATE_SEAT_POLICY/1';
function corporateSeatPolicy(policy,authorityId,organizationId){
  const next=copy(policy),a=next.authorities[authorityId];
  check(next.environment==='PRODUCTION'&&a?.principalId===organizationId&&
    (next.actionCatalog[CORPORATE_SEAT_ACTION]===undefined||
     next.actionCatalog[CORPORATE_SEAT_ACTION]==='ENTITLEMENT'),
    'T3_ACCESS_CORPORATE_SEAT_POLICY_SCOPE_INVALID');
  next.actionCatalog[CORPORATE_SEAT_ACTION]='ENTITLEMENT';
  for(const [name,value] of [['actions',CORPORATE_SEAT_ACTION],
    ['resources',CORPORATE_SEAT_RESOURCE],['purposes',CORPORATE_SEAT_PURPOSE],
    ['rightClasses','ENTITLEMENT']]){
    if(!a[name].includes(value))a[name].push(value);
  }
  try{validatePolicy(next);}catch{no('T3_ACCESS_CORPORATE_SEAT_POLICY_INVALID');}
  return next;
}
const seatPolicyDigest=({old_policy_digest,authority_id,organization_id,manager_decision_digest})=>
  digest({schema:ORIGINAL_CORPORATE_SEAT_POLICY,old_policy_digest,
    authority_id,organization_id,manager_decision_digest});
function verifyCorporateSeatPolicyAdmission(trust,current,event){
  check(dictionary(trust)&&trust.schema===ORIGINAL_CORPORATE_SEAT_POLICY&&
    trust.old_policy_digest===digest(current)&&
    ID.test(trust.authority_id??'')&&ID.test(trust.organization_id??'')&&
    HEX.test(trust.manager_decision_digest??'')&&
    !corporateSeatPolicyReady(current,trust.authority_id),
    'T3_ACCESS_CORPORATE_SEAT_POLICY_ADMISSION_INVALID');
  const next=corporateSeatPolicy(current,trust.authority_id,trust.organization_id);
  const signed=trust.signed_status,p=signed?.payload;
  const at=Date.parse(p?.issuedAt??'');
  check(Number.isSafeInteger(at)&&at>0&&
    p.id==='status:seat-policy:'+seatPolicyDigest(trust)&&
    p.authorityId===trust.authority_id&&p.realmId===current.realmId&&
    p.membershipEpoch===current.authorities[trust.authority_id].membershipEpoch&&
    p.sequence===event.payload.status_sequences[trust.authority_id]&&
    current.authorities[trust.authority_id].statusKeys.includes(signed.keyId)&&
    digest(next)===event.payload.policy_digest,
    'T3_ACCESS_CORPORATE_SEAT_POLICY_SIGNED_EVIDENCE_INVALID');
  try{verifyRecord(signed,current,at,'STATUS');}
  catch{no('T3_ACCESS_CORPORATE_SEAT_POLICY_SIGNATURE_INVALID');}
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

// Shared original readback verifier. The receiving Host replays the same
// signed policy admissions, rather than accepting an invitation's arbitrary
// policy as an independently trusted root.
function verifiedRegistryReadback({record,events,pinned,workspaceId,objectId,now,checkpointPolicy=null}){
    const trustedHash=digest(pinned);
    let checkpointSeen=checkpointPolicy===null;
    check(record?.workspace_id===workspaceId &&
      record.object_id===objectId &&
      record.schema_id===ORIGINAL_REGISTRY_SCHEMA &&
      record.schema_version==="1.0.0" &&
      Number.isSafeInteger(record.revision)&&record.revision>0,
      "T3_ACCESS_REGISTRY_ORIGINAL_RECEIPT_INVALID");
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
    for(const event of journal){
      expectedRevision++;
      check(event.workspace_id===workspaceId &&
        event.payload?.object_id===objectId&&
        event.payload.revision===expectedRevision &&
        dictionary(event.payload.status_sequences) &&
        Object.keys(event.payload.status_sequences).length===
          Object.keys(pinned.authorities).length,
        "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
      const trust=event.payload.proof_credential_admission;
      const seatPolicy=event.payload.corporate_seat_policy_admission;
      check(trust===undefined||seatPolicy===undefined,'T3_ACCESS_REGISTRY_POLICY_ADMISSION_CONFLICT');
      if(seatPolicy!==undefined){
        check(expectedRevision>1&&priorFloors,'T3_ACCESS_REGISTRY_TRUST_ANCHOR_MISMATCH');
        observedPolicy=verifyCorporateSeatPolicyAdmission(seatPolicy,observedPolicy,event);
        currentHash=digest(observedPolicy);
        for(const authorityId of Object.keys(pinned.authorities)){
          const delta=authorityId===seatPolicy.authority_id?1:0;
          check(event.payload.status_sequences[authorityId]===priorFloors[authorityId]+delta,
            'T3_ACCESS_CORPORATE_SEAT_POLICY_SEQUENCE_INVALID');
        }
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
      if(!checkpointSeen&&same(observedPolicy,checkpointPolicy))checkpointSeen=true;
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

    check(checkpointSeen,"T3_ACCESS_REGISTRY_REFRESH_PINNED_POLICY_NOT_IN_HISTORY");
    return Object.freeze({revision:record.revision,state:copy(state)});
}

// The signed business scope and the private management record have different
// Workspace identities inside the SAME original Kernel/Store. Grant resources,
// enrollment and the business Workspace ID are never rewritten.
export function originalEmployeeRegistryWorkspaceId({organizationId,authorityId,workspaceId}={}){
  check([organizationId,authorityId,workspaceId].every(x=>typeof x==="string"&&ID.test(x)),
    "T3_ACCESS_REGISTRY_STORAGE_SCOPE_INVALID");
  return "workspace:registry:"+digest({
    schema:"IWXA_T3_ORIGINAL_EMPLOYEE_REGISTRY_STORAGE/1",
    organizationId,authorityId,workspaceId
  });
}

// Native Admin only. Resolve actual original Workspace placement before
// delegating to the existing registry port. No data copying, new state
// format, new signer, or second Store. Legacy data is still authoritative
// and never silently migrated or overwritten.
function corporateRegistryPort({kernel,workspaceId,objectId,trustedPolicy,clock,corporateScope}){
  const scope={organizationId:corporateScope?.organizationId,
    authorityId:corporateScope?.authorityId,workspaceId};
  const storageId=originalEmployeeRegistryWorkspaceId(scope);
  check(storageId!==workspaceId&&trustedPolicy?.environment==="PRODUCTION"&&
    trustedPolicy.authorities?.[scope.authorityId]?.principalId===scope.organizationId&&
    typeof kernel.getWorkspace==="function"&&kernel.hasOperation("t1.getWorkspace"),
    "T3_ACCESS_REGISTRY_STORAGE_SCOPE_INVALID");
  let selected=null,lookup=null,creation=null,attempted=false;
  const absent=error=>error?.code==="WORKSPACE_NOT_FOUND";
  const readWorkspace=async id=>{
    let ws;
    try{ws=await kernel.getWorkspace(id);}
    catch(error){if(absent(error))return null;throw error;}
    if(ws==null)return null;
    check(ws.workspace_id===id&&ws.deleted_at==null,
      "T3_ACCESS_REGISTRY_STORAGE_WORKSPACE_INVALID");
    return ws;
  };
  const select=(id,mode)=>{
    const port=createOriginalKernelRegistryStatePort({
      kernel,workspaceId:id,objectId,trustedPolicy,clock});
    selected=Object.freeze({mode,workspaceId:id,port});
    return selected;
  };
  const locate=async()=>{
    if(selected)return selected;
    if(lookup)return lookup;
    lookup=(async()=>{
      const dedicated=await readWorkspace(storageId);
      if(dedicated){
        check(dedicated.profile==="generic",
          "T3_ACCESS_REGISTRY_STORAGE_WORKSPACE_INVALID");
        // An empty private Workspace must not reset an existing legacy
        // registry. Once the private registry actually exists, a registry-
        // shaped business object can never replace its authority.
        const current=await kernel.getObject(storageId,objectId);
        if(current==null&&await kernel.getObject(workspaceId,objectId)!=null)
          no("T3_ACCESS_REGISTRY_STORAGE_LEGACY_CONFLICT");
        return select(storageId,"SEPARATE");
      }
      const business=await readWorkspace(workspaceId);
      if(!business)return null;
      const old=await kernel.getObject(workspaceId,objectId);
      if(old!=null)return select(workspaceId,"LEGACY");
      return null;
    })();
    try{return await lookup;}finally{lookup=null;}
  };
  const placement=entry=>Object.freeze({
    mode:entry?.mode??"NOT_CREATED",
    workspaceId:entry?.workspaceId??null,
    businessWorkspaceId:workspaceId,
    originalReadback:true,
    registrySeparated:entry?.mode==="SEPARATE",
  });
  const initializeStorage=async({confirmed=false}={})=>{
    check(confirmed===true,"T3_ACCESS_REGISTRY_STORAGE_HUMAN_REQUIRED");
    const prior=await locate();
    if(prior)return placement(prior);
    if(creation)return creation;
    check(!attempted,"T3_ACCESS_REGISTRY_STORAGE_CREATE_READBACK_REQUIRED");
    attempted=true;
    creation=(async()=>{
      const business=await readWorkspace(workspaceId);
      check(business&&business.read_only!==true,
        "T3_ACCESS_REGISTRY_STORAGE_BUSINESS_WORKSPACE_REQUIRED");
      check(typeof kernel.createWorkspace==="function"&&kernel.hasOperation("t1.createWorkspace"),
        "T3_ACCESS_REGISTRY_STORAGE_CREATE_UNAVAILABLE");
      // Exactly one dispatch. If the response is lost, read the original
      // deterministic Workspace, rather than issuing another create.
      let failure=null;
      try{await kernel.createWorkspace({workspace_id:storageId,profile:"generic"});}
      catch(error){failure=error;}
      const observed=await locate();
      if(observed?.mode==="SEPARATE")return placement(observed);
      if(failure)throw failure;
      no("T3_ACCESS_REGISTRY_STORAGE_CREATE_OUTCOME_UNKNOWN");
    })();
    try{return await creation;}finally{creation=null;}
  };
  const bound=async()=>{
    const entry=await locate();
    check(entry!==null,"T3_ACCESS_REGISTRY_STATE_UNAVAILABLE");
    return entry.port;
  };
  const api=Object.freeze({
    // Deterministic expected address, not proof of creation or registry state.
    expectedStorageWorkspaceId:storageId,
    readStoragePlacement:async()=>placement(await locate()),
    initializeStorage,
    readState:async()=> (await bound()).readState(),
    readRegistryDelivery:async()=> (await bound()).readRegistryDelivery(),
    commitSignedState:async(...args)=> (await bound()).commitSignedState(...args),
    admitProofCredential:async(...args)=> (await bound()).admitProofCredential(...args),
    readProofCredential:async(...args)=> (await bound()).readProofCredential(...args),
    enableCorporateSeatPolicy:async(...args)=> (await bound()).enableCorporateSeatPolicy(...args),
    getStatus:async()=> (await bound()).getStatus(),
  });
  originalPorts.add(api);
  return api;
}

/**
 * Trusted recipient-side preparation, AFTER authenticating the existing
 * signed invitation carrier with the already independently pinned issuer.
 * No persistence, signing, new authority, package format or membership.
 * Root policy from the delivery must replay to the recipient's EXISTING
 * pinned policy before the new signed state can be considered.
 */
export function prepareOriginalEmployeeRegistryRefresh({
  previousState,delivery,organizationId,authorityId,workspaceId,
  objectId="t3.access.signed-registry",now=Date.now()
}={}){
  check(ID.test(organizationId??"")&&ID.test(authorityId??"")&&
    ID.test(workspaceId??"")&&ID.test(objectId??"")&&
    Number.isSafeInteger(now)&&now>0,"T3_ACCESS_REGISTRY_REFRESH_SCOPE_INVALID");
  let previous,pinned;
  try{
    previous=snapshot(previousState);validatePolicy(previous.policy);
    pinned=snapshot(delivery.rootPolicy);validatePolicy(pinned);
  }catch{no("T3_ACCESS_REGISTRY_REFRESH_PINNED_POLICY_REQUIRED");}
  check(previous.policy.environment==="PRODUCTION"&&pinned.environment==="PRODUCTION"&&
    previous.policy.realmId===pinned.realmId&&previous.policy.id===pinned.id&&
    previous.policy.authorities[authorityId]?.principalId===organizationId&&
    pinned.authorities[authorityId]?.principalId===organizationId,
    "T3_ACCESS_REGISTRY_REFRESH_SCOPE_INVALID");
  if(previous.lastObservedAt!==undefined)check(now>=timestamp(previous.lastObservedAt),
    "T3_ACCESS_REGISTRY_CLOCK_ROLLBACK");
  const storageWorkspaceId=delivery.record?.workspace_id;
  const partition=originalEmployeeRegistryWorkspaceId({organizationId,authorityId,workspaceId});
  check(storageWorkspaceId===workspaceId||storageWorkspaceId===partition,
    "T3_ACCESS_REGISTRY_REFRESH_STORAGE_SCOPE_INVALID");
  const verified=verifiedRegistryReadback({record:delivery.record,events:delivery.events,
    pinned,workspaceId:storageWorkspaceId,objectId,now,checkpointPolicy:previous.policy});
  const authorityFields=["policy","grants","statuses","statusFloor","tombstones"];
  const next=copy(previous);
  for(const key of authorityFields)next[key]=copy(verified.state[key]);
  next.lastObservedAt=iso(now);
  // Prior policy may change ONLY through the original signed journal replay
  // above. Existing grant bytes, status floors and terminal tombstones
  // still obey the exact SAME forward-only registry rules.
  assertForward({...previous,policy:next.policy},next);
  const changed=authorityFields.some(key=>!same(previous[key],next[key]));
  return Object.freeze({outcome:changed?"VERIFIED_REFRESH":"ALREADY_CURRENT",
    state:changed?next:copy(previous),originalRevision:verified.revision,
    priorDigest:digest(previous),stateDigest:digest(changed?next:previous),
    originalReadback:true,productionActivation:false});
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
  trustedPolicy,clock=Date.now,corporateScope=null
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
  const trustedHash=digest(pinned);
  if(corporateScope!==null)return corporateRegistryPort({
    kernel,workspaceId,objectId,trustedPolicy:pinned,clock,corporateScope});
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
  const read=async({allowAbsent=false,includeDelivery=false}={})=>{
    const now=validClock(clock);
    const result=await kernel.getObject(workspaceId,objectId);
    if(!result){
      if(allowAbsent)return null;
      no("T3_ACCESS_REGISTRY_STATE_UNAVAILABLE");
    }
    const record=result.object,events=await kernel.listEventsSince(workspaceId);
    const verified=verifiedRegistryReadback({record,events,pinned,workspaceId,objectId,now});
    // The delivery is a detached view of the very SAME authenticated read.
    // The existing invitation carrier must sign this field, not a UI copy.
    if(!includeDelivery)return verified;
    const journal=events.filter(e=>e?.event_type===ORIGINAL_REGISTRY_EVENT&&e?.payload?.object_id===objectId);
    return Object.freeze({...verified,delivery:{rootPolicy:copy(pinned),record:copy(record),events:copy(journal)}});
  };
  const commit=async(signedState,{expectedStateDigest=null}={})=>{
    const before=await read({allowAbsent:true});
    if(expectedStateDigest!==null)check(before&&HEX.test(expectedStateDigest)&&
      digest(before.state)===expectedStateDigest,'T3_ACCESS_REGISTRY_EXPECTED_STATE_CHANGED');
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
  const enableCorporateSeatPolicy=async({
    authorityId,organizationId,issuerSigner,managerRequest,managerChallenge,
    managerProof,expectedStateDigest
  }={})=>{
    const before=await read(),now=validClock(clock),state=before.state;
    const auth=state.policy.authorities[authorityId],g=state.grants[managerRequest?.grantId]?.payload;
    check(HEX.test(expectedStateDigest??'')&&digest(state)===expectedStateDigest,
      'T3_ACCESS_REGISTRY_EXPECTED_STATE_CHANGED');
    check(auth?.principalId===organizationId&&
      auth.issuerKeys.includes(issuerSigner?.keyId)&&auth.statusKeys.includes(issuerSigner?.keyId)&&
      !corporateSeatPolicyReady(state.policy,authorityId)&&
      g?.rightClass==='ADMINISTRATION'&&g.authorityId===authorityId&&
      g.actions.includes('grant.revoke')&&
      managerRequest?.principalId===organizationId&&managerRequest.action==='grant.issue'&&
      managerRequest.resource==='authority:'+authorityId&&
      managerRequest.purpose==='access-administration'&&
      managerRequest.operationDigest===digest({schema:ORIGINAL_CORPORATE_SEAT_POLICY,
        authorityId,organizationId,oldPolicyDigest:digest(state.policy)}),
      'T3_ACCESS_CORPORATE_SEAT_POLICY_MANAGER_SCOPE_INVALID');
    const decision=evaluate(managerRequest,state,{now:iso(now),challenge:managerChallenge,
      proof:managerProof,timeAssurance:'LOCAL_BEST_EFFORT'});
    check(decision.allowed===true&&decision.outcome==='PERMITTED',
      'T3_ACCESS_CORPORATE_SEAT_POLICY_MANAGER_DENIED');
    const next=copy(state);next.policy=corporateSeatPolicy(state.policy,authorityId,organizationId);
    const prior=state.statuses[authorityId].payload;
    const expiry=Math.min(timestamp(prior.validUntil),timestamp(state.policy.keys[issuerSigner.keyId].expiresAt));
    check(expiry>now,'T3_ACCESS_CORPORATE_SEAT_POLICY_STATUS_STALE');
    const trust={schema:ORIGINAL_CORPORATE_SEAT_POLICY,old_policy_digest:digest(state.policy),
      authority_id:authorityId,organization_id:organizationId,manager_decision_digest:digest(decision)};
    const signed=signRecord({...prior,id:'status:seat-policy:'+seatPolicyDigest(trust),
      sequence:prior.sequence+1,issuedAt:iso(now),validUntil:iso(expiry)},issuerSigner);
    verifyRecord(signed,state.policy,now,'STATUS');
    next.statuses[authorityId]=signed;next.statusFloor[authorityId]=signed.payload.sequence;
    next.lastObservedAt=iso(now);trust.signed_status=copy(signed);
    const checked=stateAt(next,next.policy,now),revision=before.revision+1;
    const receipt=await persistOriginal({workspace_id:workspaceId,object_id:objectId,
      schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:'1.0.0',
      base_revision:before.revision,data:checked,extensions:{},
      event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{object_id:objectId,
        revision,policy_digest:digest(checked.policy),state_digest:digest(checked),
        status_sequences:copy(checked.statusFloor),corporate_seat_policy_admission:trust}}});
    check(receipt?.object?.revision===revision&&receipt.event?.workspace_id===workspaceId,
      'T3_ACCESS_CORPORATE_SEAT_POLICY_ORIGINAL_COMMIT_UNKNOWN');
    const verified=await read();
    check(verified.revision===revision&&same(verified.state,checked),
      'T3_ACCESS_CORPORATE_SEAT_POLICY_READBACK_UNKNOWN');
    return Object.freeze({state:'ORIGINAL_CORPORATE_SEAT_POLICY_ENABLED',organizationId,
      originalReadback:true,registryRevision:revision,grantCount:Object.keys(checked.grants).length,
      productionActivation:false});
  };
  const port=Object.freeze({
    readState:async()=>copy((await read()).state),
    readRegistryDelivery:async()=>(await read({includeDelivery:true})).delivery,
    commitSignedState:commit,
    admitProofCredential,readProofCredential,enableCorporateSeatPolicy,
    getStatus:async()=>{const state=(await read()).state;
      return Object.freeze({sequences:copy(state.statusFloor),
        policy_digest:digest(state.policy),root_policy_digest:trustedHash});},
  });
  originalPorts.add(port);
  return port;
}
