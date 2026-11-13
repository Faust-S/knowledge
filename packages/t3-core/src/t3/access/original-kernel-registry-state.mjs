// Durable signed AccessRegistry STATE in the already inherited T2 Kernel Store.
// Not a new Store, database, IAM or signer. The trusted Host supplies the same
// original KernelFacade (getObject/putObject/listEventsSince) and a pinned,
// independently trusted policy. No private key, passphrase or issuer is saved.
// Access decisions continue to use the canonical IWXA T3 evaluate() algorithm.
import {
  canonical,digest,snapshot,copy,validatePolicy,validateGrant,verifyRecord,
  validateStatusSnapshot,assertStatusTransitionHistory,iso
} from "./core.mjs";

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
  check(ID.test(workspaceId??"")&&ID.test(objectId??"") &&
    kernel?.sessionInfo?.contract_version==="1.3.0" &&
    ["getObject","putObject","listEventsSince"].every(k=>
      typeof kernel?.[k]==="function") && typeof kernel.hasOperation==="function" &&
    ["t1.getObject","t1.putObject","t1.listEventsSince"].every(op=>
      kernel.hasOperation(op)) && typeof clock==="function",
    "T3_ACCESS_REGISTRY_ORIGINAL_KERNEL_REQUIRED");
  let pinned;
  try{pinned=snapshot(trustedPolicy);validatePolicy(pinned);}
  catch{no("T3_ACCESS_REGISTRY_TRUST_ANCHOR_REQUIRED");}
  const trustedHash=digest(pinned);
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
    const state=stateAt(record.data,pinned,now);
    const events=await kernel.listEventsSince(workspaceId);
    check(Array.isArray(events),"T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_UNAVAILABLE");
    const journal=events.filter(e=>e?.event_type===ORIGINAL_REGISTRY_EVENT &&
      e?.payload?.object_id===objectId);
    check(journal.length>0,"T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_MISSING");
    // The ORIGINAL T2 event journal is the monotonic evidence. A caller
    // cannot silently replay an earlier signed STATUS by rewriting only the
    // latest Object revision while its higher-sequence event remains.
    for(const event of journal){
      check(event.workspace_id===workspaceId &&
        event.payload.policy_digest===trustedHash &&
        dictionary(event.payload.status_sequences) &&
        Object.keys(event.payload.status_sequences).length===
          Object.keys(pinned.authorities).length,
        "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
      for(const authorityId of Object.keys(pinned.authorities)){
        const observed=event.payload.status_sequences[authorityId];
        check(Number.isSafeInteger(observed)&&observed>=0 &&
          observed<=state.statusFloor[authorityId],
          "T3_ACCESS_REGISTRY_ORIGINAL_SEQUENCE_ROLLBACK");
      }
    }
    const last=journal.at(-1);
    check(last.workspace_id===workspaceId &&
      last.payload.revision===record.revision &&
      last.payload.policy_digest===trustedHash &&
      last.payload.state_digest===digest(state),
      "T3_ACCESS_REGISTRY_ORIGINAL_HISTORY_CONFLICT");
    return Object.freeze({revision:record.revision,state:copy(state)});
  };
  const commit=async(signedState)=>{
    const before=await read({allowAbsent:true});
    const now=validClock(clock);
    const draft=copy(signedState);
    draft.lastObservedAt=iso(now);
    const next=stateAt(draft,pinned,now);
    if(before) assertForward(before.state,next);
    const revision=(before?.revision??0)+1;
    const digestState=digest(next);
    const receipt=await kernel.putObject({
      workspace_id:workspaceId,object_id:objectId,
      schema_id:ORIGINAL_REGISTRY_SCHEMA,schema_version:"1.0.0",
      base_revision:before?.revision??0,data:next,extensions:{},
      event:{event_type:ORIGINAL_REGISTRY_EVENT,payload:{
        object_id:objectId,revision,policy_digest:trustedHash,
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
    return Object.freeze({revision,policy_digest:trustedHash,
      state_digest:digestState,event_id:receipt.event.event_id});
  };
  const port=Object.freeze({
    readState:async()=>copy((await read()).state),
    commitSignedState:commit,
    getStatus:async()=>{const state=(await read()).state;
      return Object.freeze({sequences:copy(state.statusFloor),
        policy_digest:trustedHash});},
  });
  originalPorts.add(port);
  return port;
}
