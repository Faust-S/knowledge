// Durable signed AccessRegistry STATE in the already inherited T2 Kernel Store.
// Not a new Store, database, IAM or signer. The trusted Host supplies the same
// original KernelFacade (getObject/putObject/listEventsSince) and a pinned,
// independently trusted policy. No private key, passphrase or issuer is saved.
// Access decisions continue to use the canonical IWXA T3 evaluate() algorithm.
import {createHash} from "node:crypto";
import {
  canonical,digest,snapshot,copy,fields,validatePolicy,validateGrant,verifyRecord,
  validateStatusSnapshot,assertStatusTransitionHistory,iso,signRecord,evaluate,timestamp
} from "./core.mjs";

import {deriveOriginalNetworkKeyTransition,validateOriginalNetworkKeyTransition,
  originalNetworkKeyOperationDigest,ORIGINAL_NETWORK_KEY_MANAGE,isVerifiedOriginalNetworkAgreementPossession}
  from "./original-network-key-lifecycle.mjs";

import {CORPORATE_SEAT_ACTION,CORPORATE_SEAT_RESOURCE,CORPORATE_SEAT_PURPOSE,
  corporateSeatPolicyReady} from './product-contracts.mjs';

export const ORIGINAL_REGISTRY_SCHEMA="iwxa.t3.access.signed-registry";
export const ORIGINAL_REGISTRY_EVENT="t3.access.signed_registry.persisted";
// A product gate must be bound to the actual pinned original Kernel registry,
// not to a caller-supplied object pretending to provide readState().
const originalPorts=new WeakMap();

export function isOriginalKernelRegistryStatePort(value) {
  return !!value&&typeof value==="object"&&originalPorts.has(value);
}
// Native product composition must prove the exact existing Kernel port and
// technical Object, not merely the same policy or similarly shaped registry.
export function isOriginalKernelRegistryStatePortForKernel(value,kernel,{workspaceId,objectId="t3.access.signed-registry"}={}){
  const binding=originalPorts.get(value);
  return !!binding&&typeof workspaceId==="string"&&ID.test(workspaceId)&&binding.kernel===kernel&&
    (binding.currentWorkspaceId?.()??binding.workspaceId)===workspaceId&&binding.objectId===objectId;
}
// Resolve a cold corporate wrapper only at its independently pinned
// physical address. A foreign Kernel, unexpected object or legacy business
// location never becomes an eligible network Registry. This is read-only;
// the pre-existing original corporate locate() still owns all placement.
export async function resolveOriginalKernelRegistryStatePortForKernel(value,kernel,scope={}){
  if(isOriginalKernelRegistryStatePortForKernel(value,kernel,scope))return true;
  const binding=originalPorts.get(value);
  if(!binding||binding.kernel!==kernel||
    binding.objectId!==(scope.objectId??'t3.access.signed-registry')||
    !ID.test(scope.workspaceId??'')||binding.expectedStorageWorkspaceId!==scope.workspaceId||
    typeof binding.locatePlacement!=='function')return false;
  await binding.locatePlacement();
  return isOriginalKernelRegistryStatePortForKernel(value,kernel,scope);
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
    const trustedHash=digest(pinned),registryIdentity=Object.freeze({workspaceId,objectId,rootPolicyDigest:trustedHash});
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
      const trust=event.payload.proof_credential_admission;
      const seatPolicy=event.payload.corporate_seat_policy_admission;
      const network=event.payload.network_key_transition;
      check([trust,seatPolicy,network].filter(value=>value!==undefined).length<=1,'T3_ACCESS_REGISTRY_POLICY_ADMISSION_CONFLICT');
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
      }else if(seatPolicy!==undefined){
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
    return Object.freeze({revision:record.revision,state:copy(state),networkBindings,networkTransitions});
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


/**
 * Portable replica of the ONE original Registry. This uses original T2
 * Exchange, not a reconstruction of Object revisions or Event identities.
 * Native owner supplies the already authenticated signed invitation and the
 * trusted original Kernel port. No new grant, issuer, Store or .iwxa format.
 */
const REGISTRY_ARCHIVE_MAX=16*1024*1024;
const archiveHash=bytes=>createHash("sha256").update(bytes).digest("hex");
const exactWorkspace=(list,workspaceId)=>Array.isArray(list)&&list.length===1&&list[0]===workspaceId;
const zeroCounts=counts=>dictionary(counts)&&Object.values(counts).every(value=>value===0);
function registryArchiveManifest(manifest,workspaceId,eventCount){
  check(manifest?.format==="iwxa.package"&&["1.0","1.1"].includes(manifest.format_version)&&
    exactWorkspace(manifest.workspaces,workspaceId)&&manifest.options?.include_history===true&&
    manifest.options.include_assets===false&&manifest.options.include_relations===false&&
    manifest.counts?.workspaces===1&&manifest.counts.objects===1&&manifest.counts.events===eventCount&&
    manifest.counts.assets===0&&manifest.counts.relations===0&&
    HEX.test(manifest.package_digest??"")&&HEX.test(manifest.semantic_digest??""),
    "T3_ACCESS_REGISTRY_EXCHANGE_PACKAGE_SCOPE_INVALID");
}
function registryPortableRecord(record){
  return Object.fromEntries(["workspace_id","object_id","schema_id","schema_version","revision","data"]
    .map(key=>[key,record?.[key]]));
}
function sameRegistryRecord(a,b){
  return !!a&&!!b&&same(registryPortableRecord(a),registryPortableRecord(b));
}
function createRegistryWorkspaceExchange({kernel,workspaceId,objectId,trustedPolicy,clock,readDelivery}){
  const checkDelivery=delivery=>{
    check(delivery&&same(delivery.rootPolicy,trustedPolicy)&&Array.isArray(delivery.events)&&
      delivery.events.every(event=>event.event_type===ORIGINAL_REGISTRY_EVENT&&event.payload?.object_id===objectId),
      "T3_ACCESS_REGISTRY_EXCHANGE_DELIVERY_INVALID");
    return verifiedRegistryReadback({record:delivery.record,events:delivery.events,pinned:trustedPolicy,
      workspaceId,objectId,now:validClock(clock)});
  };
  const requireOperations=operations=>check(operations.every(op=>
    typeof kernel[op.slice(3)]==="function"&&kernel.hasOperation(op)),
    "T3_ACCESS_REGISTRY_EXCHANGE_ORIGINAL_KERNEL_REQUIRED");
  const readWorkspace=async()=>{
    try{return await kernel.getWorkspace(workspaceId);}
    catch(error){if(error?.code==="WORKSPACE_NOT_FOUND")return null;throw error;}
  };
  const readReplica=async()=>{
    const ws=await readWorkspace();
    if(ws==null)return {workspace:false,record:null,events:[]};
    check(ws.workspace_id===workspaceId&&ws.profile==="generic"&&ws.deleted_at==null,
      "T3_ACCESS_REGISTRY_STORAGE_WORKSPACE_INVALID");
    let result;
    try{result=await kernel.getObject(workspaceId,objectId);}
    catch(error){if(error?.code!=="OBJECT_NOT_FOUND")throw error;result=null;}
    const all=await kernel.listEventsSince(workspaceId);
    check(Array.isArray(all),"T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_UNAVAILABLE");
    const events=all.filter(event=>event.event_type===ORIGINAL_REGISTRY_EVENT&&event.payload?.object_id===objectId);
    // A clean first-pilot management partition may contain its Workspace
    // creation event. It must not contain other management objects' history.
    check(all.every(event=>event.workspace_id===workspaceId&&
      (events.includes(event)||event.event_type==="workspace.created"&&
        event.object_id==null&&event.payload?.object_id==null)),
      "T3_ACCESS_REGISTRY_EXCHANGE_UNRELATED_HISTORY");
    return {workspace:true,record:result?.object??null,events,allCount:all.length};
  };
  const exact=(observed,delivery)=>sameRegistryRecord(observed.record,delivery.record)&&
    same(observed.events,delivery.events);
  function requirePrefix(observed,delivery){
    check(observed.events.length<=delivery.events.length&&
      observed.events.every((event,index)=>same(event,delivery.events[index])),
      "T3_ACCESS_REGISTRY_EXCHANGE_HISTORY_DIVERGED");
    if(observed.record===null){
      check(observed.events.length===0,"T3_ACCESS_REGISTRY_EXCHANGE_HISTORY_DIVERGED");return;
    }
    const last=observed.events.at(-1),record=observed.record;
    check(last&&record.workspace_id===workspaceId&&record.object_id===objectId&&
      record.schema_id===ORIGINAL_REGISTRY_SCHEMA&&record.schema_version==="1.0.0"&&
      record.revision===observed.events.length&&last.payload.revision===record.revision&&
      last.payload.state_digest===digest(record.data),
      "T3_ACCESS_REGISTRY_EXCHANGE_HISTORY_DIVERGED");
    check(record.revision<delivery.record.revision,"T3_ACCESS_REGISTRY_EXCHANGE_HISTORY_DIVERGED");
  }
  async function exportWorkspace({confirmed=false}={}){
    check(confirmed===true,"T3_ACCESS_REGISTRY_EXCHANGE_HUMAN_REQUIRED");
    requireOperations(["t2.exportPackage"]);
    const delivery=await readDelivery();checkDelivery(delivery);
    const before=await readReplica();
    check(exact(before,delivery),"T3_ACCESS_REGISTRY_EXCHANGE_SOURCE_CHANGED");
    const artifact=await kernel.exportPackage({workspaces:[workspaceId],include_history:true,
      include_assets:false,include_relations:false,include_schemas:false,scope:{mode:"workspace"}});
    registryArchiveManifest(artifact?.manifest,workspaceId,before.allCount);
    const bytes=artifact?.bytes;
    check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=REGISTRY_ARCHIVE_MAX&&
      artifact.size===bytes.byteLength&&artifact.validation?.ok===true&&
      artifact.package_digest===artifact.manifest.package_digest&&
      artifact.semantic_digest===artifact.manifest.semantic_digest&&zeroCounts(artifact.summary?.excluded_by_permission),
      "T3_ACCESS_REGISTRY_EXCHANGE_PACKAGE_INVALID");
    const after=await readReplica();
    check(exact(after,delivery)&&after.allCount===before.allCount,"T3_ACCESS_REGISTRY_EXCHANGE_SOURCE_CHANGED");
    return Object.freeze({delivery:copy(delivery),registryArchive:Object.freeze({
      bytesBase64url:Buffer.from(bytes).toString("base64url"),sha256:archiveHash(bytes),
      packageDigest:artifact.package_digest,semanticDigest:artifact.semantic_digest,
      eventCount:before.allCount})});
  }
  let inProgress=false;
  async function importWorkspace({delivery,registryArchive,confirmed=false}={}){
    check(confirmed===true,"T3_ACCESS_REGISTRY_EXCHANGE_HUMAN_REQUIRED");
    check(!inProgress,"T3_ACCESS_REGISTRY_EXCHANGE_IN_PROGRESS");
    inProgress=true;
    try{
      const supplied=copy(delivery),archive=copy(registryArchive);
      const verified=checkDelivery(supplied);
      check(dictionary(archive)&&Object.keys(archive).length===5&&
        ["bytesBase64url","sha256","packageDigest","semanticDigest","eventCount"].every(k=>own(archive,k))&&
        [archive.sha256,archive.packageDigest,archive.semanticDigest].every(x=>HEX.test(x??""))&&
        Number.isSafeInteger(archive.eventCount)&&archive.eventCount>=supplied.events.length&&
        typeof archive.bytesBase64url==="string"&&archive.bytesBase64url.length<=Math.ceil(REGISTRY_ARCHIVE_MAX/3)*4,
        "T3_ACCESS_REGISTRY_EXCHANGE_PACKAGE_INVALID");
      const bytes=Buffer.from(archive.bytesBase64url,"base64url");
      check(bytes.length>0&&bytes.length<=REGISTRY_ARCHIVE_MAX&&bytes.toString("base64url")===archive.bytesBase64url&&
        archiveHash(bytes)===archive.sha256,"T3_ACCESS_REGISTRY_EXCHANGE_PACKAGE_INVALID");
      const before=await readReplica();
      const result=state=>Object.freeze({state,originalRevision:verified.revision,workspaceId,
        stateDigest:digest(verified.state),originalReadback:true,safeToReissue:false});
      if(exact(before,supplied))return result("ALREADY_CURRENT");
      requirePrefix(before,supplied);
      requireOperations(["t2.importPreview","t2.importCommit","t2.importCancel"]);
      const handle=await kernel.importPreview(bytes);
      let dispatched=false;
      try{
        const p=handle?.preview,mode=before.workspace?"merge":"full";
        registryArchiveManifest(p?.manifest,workspaceId,archive.eventCount);
        check(handle.package_digest===archive.packageDigest&&handle.semantic_digest===archive.semanticDigest&&
          p.package_digest===archive.packageDigest&&p.semantic_digest===archive.semanticDigest&&
          p.manifest.package_digest===archive.packageDigest&&p.manifest.semantic_digest===archive.semanticDigest&&
          typeof handle.preview_token==="string"&&handle.preview_token.length>0&&
          handle.allowed_modes?.includes(mode)&&p.scope_mode==="workspace"&&
          p.workspaces?.length===1&&p.workspaces[0].workspace_id===workspaceId&&
          p.workspaces[0].exists_locally===before.workspace&&p.objects?.length===1&&
          p.objects[0].workspace_id===workspaceId&&p.objects[0].object_id===objectId&&
          p.objects[0].schema_id===ORIGINAL_REGISTRY_SCHEMA&&p.objects[0].schema_version==="1.0.0"&&
          p.objects[0].incoming_revision===verified.revision&&
          p.objects[0].local_revision===(before.record?.revision??null)&&
          p.totals?.objects===1&&p.totals.workspaces===1&&p.totals.events===archive.eventCount&&
          p.included?.objects===1&&p.included.events===archive.eventCount&&
          Array.isArray(p.unsupported)&&p.unsupported.length===0&&zeroCounts(p.invalid)&&zeroCounts(p.excluded_by_permission),
          "T3_ACCESS_REGISTRY_EXCHANGE_PREVIEW_INVALID");
        const current=await readReplica();
        check(current.workspace===before.workspace&&same(current.events,before.events)&&
          (before.record===null?current.record===null:sameRegistryRecord(before.record,current.record)),
          "T3_ACCESS_REGISTRY_EXCHANGE_TARGET_CHANGED");
        dispatched=true;
        let receipt=null;
        try{receipt=await kernel.importCommit({preview_token:handle.preview_token,package_digest:handle.package_digest,
          plan:{mode,conflict:before.record===null?"fail":"overwrite",include_workspaces:[workspaceId],
            ...(mode==="merge"?{target_workspace:workspaceId}:{}),
            include_history:true,include_assets:false,include_relations:false}});}
        catch{/* The original import may have committed. Never repeat blindly. */}
        let after;
        try{after=await readReplica();}
        catch{no("T3_ACCESS_REGISTRY_EXCHANGE_IMPORT_OUTCOME_UNKNOWN");}
        check(exact(after,supplied),"T3_ACCESS_REGISTRY_EXCHANGE_IMPORT_OUTCOME_UNKNOWN");
        checkDelivery({...supplied,record:after.record,events:after.events});
        return result(receipt?.package_digest===archive.packageDigest&&receipt?.semantic_digest===archive.semanticDigest&&
          receipt.mode===mode&&receipt.cancelled!==true?"ORIGINAL_REGISTRY_IMPORTED":"ORIGINAL_REGISTRY_IMPORT_RECOVERED");
      }finally{
        if(!dispatched&&typeof handle?.preview_token==="string")
          try{await kernel.importCancel(handle.preview_token);}catch{/* no commit was dispatched */}
      }
    }finally{inProgress=false;}
  }
  return Object.freeze({exportWorkspace,importWorkspace});
}

// Native Admin only. Resolve actual original Workspace placement before
// delegating to the existing registry port. No data copying, new state
// format, new signer, or second Store. Legacy data is still authoritative
// and never silently migrated or overwritten.
function corporateRegistryPort({kernel,workspaceId,objectId,trustedPolicy,clock,corporateScope}){
  const scope={organizationId:corporateScope?.organizationId,
    authorityId:corporateScope?.authorityId,workspaceId};
  const storageId=originalEmployeeRegistryWorkspaceId(scope);
  // Installed network admission uses the SAME corporate wrapper and
  // deterministic address, but its scoped relay is not an onboarding port.
  // Never probe or adopt the legacy business Registry in this mode.
  const existingOnly=corporateScope.existingSeparateStorageOnly??false;
  check(typeof existingOnly==="boolean"&&storageId!==workspaceId&&trustedPolicy?.environment==="PRODUCTION"&&
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
      kernel,workspaceId:id,objectId,trustedPolicy,clock,requireExistingState:existingOnly});
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
        let current;
        try{current=await kernel.getObject(storageId,objectId);}
        catch(error){
          if(existingOnly&&error?.code==="OBJECT_NOT_FOUND")return null;
          throw error;
        }
        // Existence of the Workspace alone is not existence of the
        // Registry. An empty scoped partition cannot become an initializer.
        if(existingOnly)return current==null?null:select(storageId,"SEPARATE");
        if(current==null&&await kernel.getObject(workspaceId,objectId)!=null)
          no("T3_ACCESS_REGISTRY_STORAGE_LEGACY_CONFLICT");
        return select(storageId,"SEPARATE");
      }
      if(existingOnly)return null;
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
    check(!existingOnly,"T3_ACCESS_REGISTRY_EXISTING_STORAGE_REQUIRED");
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
  const exchange=createRegistryWorkspaceExchange({kernel,workspaceId:storageId,objectId,trustedPolicy,clock,
    readDelivery:async()=> (await bound()).readRegistryDelivery()});
  const api=Object.freeze({
    exportRegistryWorkspace:exchange.exportWorkspace,
    importRegistryWorkspace:exchange.importWorkspace,
    // Deterministic expected address, not proof of creation or registry state.
    expectedStorageWorkspaceId:storageId,
    readStoragePlacement:async()=>placement(await locate()),
    initializeStorage,
    readState:async()=> (await bound()).readState(),
    readRegistryDelivery:async()=> (await bound()).readRegistryDelivery(),
    applyNetworkKeyTransition:async(...args)=> (await bound()).applyNetworkKeyTransition(...args),
    readNetworkKeyEvidence:async(...args)=> (await bound()).readNetworkKeyEvidence(...args),
    readNetworkRouteKeys:async(...args)=> (await bound()).readNetworkRouteKeys(...args),
    readNetworkKeyHistoryEvidence:async(...args)=> (await bound()).readNetworkKeyHistoryEvidence(...args),
    commitSignedState:async(...args)=> (await bound()).commitSignedState(...args),
    admitProofCredential:async(...args)=> (await bound()).admitProofCredential(...args),
    readProofCredential:async(...args)=> (await bound()).readProofCredential(...args),
    enableCorporateSeatPolicy:async(...args)=> (await bound()).enableCorporateSeatPolicy(...args),
    getStatus:async()=> (await bound()).getStatus(),
  });
  // Provenance is confirmed physical placement, never the expected address.
  originalPorts.set(api,Object.freeze({kernel,objectId,currentWorkspaceId:()=>selected?.workspaceId,
    expectedStorageWorkspaceId:storageId,locatePlacement:locate}));
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
  trustedPolicy,clock=Date.now,corporateScope=null,requireExistingState=false
}={}){
  check(typeof requireExistingState==="boolean"&&(!requireExistingState||corporateScope===null),
    "T3_ACCESS_REGISTRY_STORAGE_SCOPE_INVALID");
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
    // Even after placement has been cached, a network-bound Registry must
    // never turn loss of the authority record into first issuance.
    const before=await read({allowAbsent:!requireExistingState});
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
  // Network key lifecycle commits through the SAME original Registry Object
  // and Event CAS. It accepts an existing authority's signed STATUS and
  // current administrator proof; it does not issue either of them.
  const applyNetworkKeyTransition=async(input={},agreementEvidence=null)=>{
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
    const agreementRequired=c.binding.keyUse==='NETWORK_AGREEMENT'&&c.kind!=='REVOKE';
    check(agreementRequired?isVerifiedOriginalNetworkAgreementPossession(agreementEvidence,transition,now):agreementEvidence===null,
      'T3_ACCESS_NETWORK_AGREEMENT_POSSESSION_REQUIRED');
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
  const networkKeyQuery=query=>{
    const q=copy(query),required=["keyId","nodeRef","recipientNodeRef","workspaceId","originalWriteOwnerRef","scopeRef","keyUse"];
    fields(q,[...required,'ownerEpoch']);
    check(required.every(k=>ID.test(q[k]??""))&&['NETWORK_FRAME','NETWORK_AGREEMENT'].includes(q.keyUse)&&
      Number.isSafeInteger(q.ownerEpoch)&&q.ownerEpoch>=1,
      "T3_ACCESS_NETWORK_KEY_QUERY_INVALID");
    return {q,matches:b=>required.every(k=>b[k]===q[k])&&b.ownerEpoch===q.ownerEpoch};
  };
  const currentNetworkKey=(latest,matches,now)=>{
    const matching=[...latest.networkBindings.values()].filter(b=>b.active&&matches(b));
    check(matching.length<=1,"T3_ACCESS_NETWORK_KEY_BINDING_AMBIGUOUS");
    if(!matching.length)return null;
    const binding=matching[0],key=latest.state.policy.keys[binding.keyId];
    if(!key||key.status!=="ACTIVE"||key.subjectId!==binding.subjectId||
      key.uses.length!==1||key.uses[0]!==binding.keyUse||
      !(timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt)))return null;
    return {binding,key};
  };
  const readNetworkKeyEvidence=async(query={})=>{
    const {matches}=networkKeyQuery(query),latest=await read();
    const current=currentNetworkKey(latest,matches,validClock(clock));
    if(current===null)return null;
    return Object.freeze({binding:copy(current.binding),key:copy(current.key),policyDigest:digest(latest.state.policy),
      originalRegistryRevision:latest.revision,originalReadback:true});
  };
  // Select the three existing keys from ONE replay-verified Registry
  // snapshot. Signature/seal/open still require exact live evidence and
  // original signed JIT; this selection is not a grant or cached proof.
  const readNetworkRouteKeys=async(query={})=>{
    const q=copy(query),names=["sourceNodeRef","recipientNodeRef","workspaceId","originalWriteOwnerRef","scopeRef"];
    fields(q,[...names,"ownerEpoch","role"]);
    check(names.every(k=>ID.test(q[k]??""))&&q.sourceNodeRef!==q.recipientNodeRef&&
      ["SOURCE","RECIPIENT"].includes(q.role)&&Number.isSafeInteger(q.ownerEpoch)&&q.ownerEpoch>=1,
      "T3_ACCESS_NETWORK_ROUTE_KEY_QUERY_INVALID");
    const latest=await read(),now=validClock(clock);
    const select=(nodeRef,recipientNodeRef,keyUse)=>currentNetworkKey(latest,b=>
      b.nodeRef===nodeRef&&b.recipientNodeRef===recipientNodeRef&&b.keyUse===keyUse&&
      ["workspaceId","originalWriteOwnerRef","scopeRef","ownerEpoch"].every(k=>b[k]===q[k]),now);
    const source=select(q.sourceNodeRef,q.recipientNodeRef,"NETWORK_FRAME"),
      recipient=select(q.recipientNodeRef,q.sourceNodeRef,"NETWORK_FRAME"),
      agreement=select(q.recipientNodeRef,q.sourceNodeRef,"NETWORK_AGREEMENT");
    if(source===null||recipient===null||agreement===null)return null;
    check(["principalId","authorityId"].every(k=>source.binding[k]===recipient.binding[k]&&
      recipient.binding[k]===agreement.binding[k])&&recipient.binding.subjectId===agreement.binding.subjectId&&
      new Set([source.binding.keyId,recipient.binding.keyId,agreement.binding.keyId]).size===3,
      "T3_ACCESS_NETWORK_ROUTE_KEY_SCOPE_MISMATCH");
    return Object.freeze({localKeyRef:(q.role==="SOURCE"?source:recipient).binding.keyId,
      remoteKeyRef:(q.role==="SOURCE"?recipient:source).binding.keyId,
      recipientKeyRef:agreement.binding.keyId});
  };
  // Historical material is reconstructed from the same signed original
  // Event history. A retired key is NEVER returned by readNetworkKeyEvidence.
  // A signature has no trusted signing timestamp; consumers must separately
  // prove the exact previously accepted/published frame in the original ledger.
  const readNetworkKeyHistoryEvidence=async(query={})=>{
    const {matches}=networkKeyQuery(query),latest=await read(),now=validClock(clock);
    const transitions=[...latest.networkTransitions.values()];
    const admitted=transitions.filter(e=>e.transition.claims.kind!=='REVOKE'&&matches(e.binding));
    check(admitted.length<=1,'T3_ACCESS_NETWORK_KEY_HISTORY_AMBIGUOUS');
    if(!admitted.length)return null;
    const admission=admitted[0],binding=admission.binding,key=admission.transition.claims.keyRecord;
    const next=transitions.filter(e=>e.binding.bindingRef===binding.bindingRef&&
      e.binding.generation===binding.generation+1&&e.revision>admission.revision);
    check(next.length<=1,'T3_ACCESS_NETWORK_KEY_HISTORY_AMBIGUOUS');
    const retired=next[0]??null,currentKey=latest.state.policy.keys[binding.keyId];
    check(key&&currentKey&&same({...currentKey,status:'ACTIVE'},key)&&
      (retired===null?currentKey.status==='ACTIVE':
        currentKey.status==='REVOKED'&&['ROTATE','REVOKE'].includes(retired.transition.claims.kind)&&
        retired.transition.claims.previousBindingDigest===digest(binding)),
      'T3_ACCESS_NETWORK_KEY_HISTORY_CONFLICT');
    const statement=e=>({transitionRef:e.transition.claims.transitionRef,
      eventId:e.eventId,revision:e.revision,issuedAt:e.transition.claims.issuedAt,
      kind:e.transition.claims.kind,transitionDigest:digest(e.transition)});
    const active=retired===null&&timestamp(key.notBefore)<=now&&now<timestamp(key.expiresAt);
    return Object.freeze({schema:'IWXA_T3_ORIGINAL_NETWORK_KEY_HISTORY_V1',
      binding:copy(binding),key:copy(key),admission:statement(admission),
      retirement:retired===null?null:statement(retired),currentKeyStatus:currentKey.status,
      keyCurrentlyActive:active,policyDigest:digest(latest.state.policy),
      originalRegistryRevision:latest.revision,originalSignedHistoryVerified:true,
      originalHistoricalEvidenceOnly:true,liveNetworkAuthorityGranted:false});
  };
  const port=Object.freeze({
    readState:async()=>copy((await read()).state),
    readRegistryDelivery:async()=>(await read({includeDelivery:true})).delivery,
    applyNetworkKeyTransition,readNetworkKeyEvidence,readNetworkRouteKeys,readNetworkKeyHistoryEvidence,
    commitSignedState:commit,
    admitProofCredential,readProofCredential,enableCorporateSeatPolicy,
    getStatus:async()=>{const state=(await read()).state;
      return Object.freeze({sequences:copy(state.statusFloor),
        policy_digest:digest(state.policy),root_policy_digest:trustedHash});},
  });
  originalPorts.set(port,Object.freeze({kernel,workspaceId,objectId}));
  return port;
}
