// The SAME encrypted vault supports both a PERSON's personal proof key and
// organization-issued proof credentials. A corporate signer is always pinned
// to one trusted organizationId and one issued credentialKeyId. The original
// organizational gate still verifies the actual signed enrollment, grant
// and public key independently; this is never a new corporate issuer.
// Node-only trusted owner adapter. Uses the ONE original IWXA T3 encrypted
// key vault and Ed25519 proof algorithm adopted in knowledge. It does NOT
// create a registry, IAM, Store or new signing protocol. Private keys never
// enter the Workspace, browser Worker, .iwxa package or user-facing response.
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {makeProof,keyObjectSigner,digest} from "./core.mjs";
import {decryptVaultAsync,vaultPrivateKey} from "./local-vault.mjs";
import {strictJson} from "./strict-json.mjs";

const IDENT=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
function refuse(code){
  const e=new Error(code);
  e.name="T3OriginalVaultSignerError";
  e.code=code;e.outcome="DENIED";throw e;
}
function requireThat(ok,code){if(!ok)refuse(code);}
function proofOperation({keyId,organizationId=null,personalPrincipalId=null}={},prove){
  requireThat(typeof keyId==="string"&&IDENT.test(keyId)&&
    (organizationId===null||
      (typeof organizationId==="string"&&IDENT.test(organizationId)))&&
    (personalPrincipalId===null||
      (typeof personalPrincipalId==="string"&&IDENT.test(personalPrincipalId)))&&
    (organizationId===null||personalPrincipalId===null),
    "T3_ACCESS_VAULT_CALLBACK_REQUIRED");
  return async function signExistingActorProof({
    request,context,challenge,asOf,credentialKeyId,
  }={}){
    request=structuredClone(request);context=structuredClone(context);
    requireThat(request&&context&&
      typeof request.actorId==="string"&&IDENT.test(request.actorId)&&
      request.actorId===context.actor_id,
      "T3_ACCESS_VAULT_SUBJECT_MISMATCH");
    if(organizationId===null){
      // Without a pinned human principal, preserve the existing direct
      // person-only PERSONAL route. A managing/specialist agent may use its
      // OWN proof key only when the trusted Host explicitly pins the person
      // responsible for its selected PERSONAL delegation chain. The signed
      // Access evaluator still checks all GRANT ancestry, scopes and status.
      requireThat(context.kind==="PERSONAL"&&
        context.organization_id===null&&
        (personalPrincipalId===null
          ? request.principalId===request.actorId
          : context.principal_id===personalPrincipalId&&
            request.principalId===personalPrincipalId&&
            typeof context.workspace_id==="string"&&IDENT.test(context.workspace_id)&&
            context.resource===request.resource&&
            context.grant_id===request.grantId&&
            context.role_id===request.roleId&&
            context.audience===request.audience&&
            context.realm_id===request.realmId&&
            context.purpose===request.purpose),
        "T3_ACCESS_VAULT_SUBJECT_MISMATCH");
      // PERSONAL callers may omit credentialKeyId; they still cannot
      // substitute an unrelated signer if it is present.
      requireThat(credentialKeyId===undefined||credentialKeyId===keyId,
        "T3_ACCESS_VAULT_CREDENTIAL_MISMATCH");
    }else{
      // The trusted Host pins a distinct organization + credential key.
      // Neither the browser nor a stale corporate context can select a key
      // from a different issuer, membership, grant or Workspace.
      requireThat(context.kind==="CORP"&&
        context.organization_id===organizationId&&
        context.principal_id===organizationId&&
        request.principalId===organizationId&&
        // Non-Kernel RAG/Skill operations may address a separate Host-
        // selected resource in this corporate Workspace. The signed Host
        // insists it matches the JIT request. The original Kernel adapter
        // independently rejects resource != workspace for Kernel methods.
        typeof context.workspace_id==="string"&&IDENT.test(context.workspace_id)&&
        typeof context.resource==="string"&&IDENT.test(context.resource)&&
        request.resource===context.resource&&
        request.grantId===context.grant_id&&
        request.roleId===context.role_id&&
        request.audience===context.audience&&
        request.realmId===context.realm_id&&
        request.purpose===context.purpose,
        "T3_ACCESS_VAULT_ORGANIZATION_MISMATCH");
      requireThat(credentialKeyId===keyId,
        "T3_ACCESS_VAULT_CREDENTIAL_MISMATCH");
    }
    requireThat(typeof challenge==="string"&&challenge.length>=16,
      "T3_ACCESS_VAULT_CHALLENGE_REQUIRED");
    const now=Date.parse(asOf);
    requireThat(Number.isSafeInteger(now)&&now>0&&
      new Date(now).toISOString()===asOf,
      "T3_ACCESS_VAULT_CLOCK_INVALID");
    return prove({request,context,challenge,asOf,now});
  };
}
async function readVaultRecord(readEncryptedVault){
  const encrypted=structuredClone(await readEncryptedVault());
  return typeof encrypted==="string"?strictJson(encrypted):encrypted;
}

export function createOriginalVaultProofSigner(options={}){
  const {readEncryptedVault,unlockPassphrase,keyId,organizationId=null}=options;
  requireThat(typeof readEncryptedVault==="function"&&typeof unlockPassphrase==="function",
    "T3_ACCESS_VAULT_CALLBACK_REQUIRED");
  return proofOperation(options,async({request,context,challenge,asOf,now})=>{
    // Read the current encrypted vault on every request. An installed Host
    // decides how to unlock it (passphrase or OS-protected credential).
    // No plaintext persistence, default password, cache or remote service.
    let encrypted,passphrase;
    try{
      encrypted=structuredClone(await readEncryptedVault());
      passphrase=await unlockPassphrase({
        actorId:context.actor_id,keyId,
        organizationId,asOf,
      });
    }catch{refuse("T3_ACCESS_VAULT_UNAVAILABLE");}
    const record=typeof encrypted==="string"?strictJson(encrypted):encrypted;
    const keys=await decryptVaultAsync(record,passphrase);
    requireThat(keys.keys[keyId]?.subjectId===request.actorId,
      "T3_ACCESS_VAULT_SUBJECT_MISMATCH");
    return makeProof(request,challenge,now,
      keyObjectSigner(keyId,vaultPrivateKey(keys,keyId)));
  });
}

// Explicit, bounded unlock of ONE proof credential for the existing native
// Host. Never activated by a proof request or by the network. Unlike the
// default per-proof KDF, this opt-in retains a native Ed25519 KeyObject until
// lock, context/lifetime invalidation or expiry. The encrypted envelope and
// owner consent are still checked per proof. No authorization result is cached.
// The owner MUST close on detach; the independent deadline also releases the
// reference if the owner disappears. Node cannot promise immediate erasure
// of native KeyObject memory by the garbage collector.
export function createOriginalVaultProofSession(options={}){
  const {readEncryptedVault,unlockPassphrase,keyId,organizationId=null,
    context:rawContext,lifetimeMs,isOriginalHostActive,authorizeOriginalVaultUse,
    clock=Date.now}=options;
  const bindings=[["actorId","actor_id"],["principalId","principal_id"],
    ["roleId","role_id"],["grantId","grant_id"],["audience","audience"],
    ["resource","resource"],["purpose","purpose"],["realmId","realm_id"]];
  requireThat(typeof readEncryptedVault==="function"&&typeof unlockPassphrase==="function"&&
    typeof isOriginalHostActive==="function"&&typeof authorizeOriginalVaultUse==="function"&&
    typeof clock==="function"&&Number.isSafeInteger(lifetimeMs)&&lifetimeMs>0&&lifetimeMs<=300000&&
    rawContext&&bindings.every(([,k])=>typeof rawContext[k]==="string"&&IDENT.test(rawContext[k]))&&
    typeof rawContext.workspace_id==="string"&&IDENT.test(rawContext.workspace_id)&&
    typeof rawContext.context_id==="string"&&IDENT.test(rawContext.context_id)&&
    rawContext.kind===(organizationId===null?"PERSONAL":"CORP")&&rawContext.organization_id===organizationId,
    "T3_ACCESS_VAULT_SESSION_REQUIRED");
  const context=structuredClone(rawContext),contextDigest=digest(context);
  // Exact decoded encrypted envelope, rather than the Access canonical
  // digest (whose short-string limit is for signed Access records).
  const envelopeDigest=record=>createHash("sha256").update(JSON.stringify(record)).digest("hex");
  let state="LOCKED",provider=null,envelopeHash=null,timer=null,startedWall=null,startedMono=null,lastWall=null;
  function close(){
    state="CLOSED";provider=null;envelopeHash=null;
    if(timer!==null){clearTimeout(timer);timer=null;}
  }
  function guard(operation,expectedState){
    try{
      requireThat(state===expectedState,"T3_ACCESS_VAULT_SESSION_LOCKED");
      const wall=clock();
      requireThat(Number.isSafeInteger(wall)&&wall>0&&
        (lastWall===null||wall>=lastWall)&&
        (startedWall===null||(wall-startedWall<lifetimeMs&&performance.now()-startedMono<lifetimeMs)),
        "T3_ACCESS_VAULT_SESSION_EXPIRED");
      lastWall=wall;
      requireThat(isOriginalHostActive()===true&&authorizeOriginalVaultUse(Object.freeze({
        operation,keyId,organizationId,actorId:context.actor_id,context:structuredClone(context),
      }))===true&&isOriginalHostActive()===true,"T3_ACCESS_VAULT_SESSION_DENIED");
      // Native owner callbacks can synchronously lock the session.
      requireThat(state===expectedState,"T3_ACCESS_VAULT_SESSION_LOCKED");
      return wall;
    }catch(error){close();throw error;}
  }
  async function readCurrent(expectedState){
    const record=await readVaultRecord(readEncryptedVault);
    requireThat(state===expectedState,"T3_ACCESS_VAULT_SESSION_LOCKED");
    requireThat(envelopeDigest(record)===envelopeHash,"T3_ACCESS_VAULT_SESSION_ENVELOPE_CHANGED");
    return record;
  }
  const signProof=proofOperation(options,async({request,context:requestedContext,challenge,now})=>{
    requireThat(state==="ACTIVE","T3_ACCESS_VAULT_SESSION_LOCKED");
    try{
      const wall=guard("PROVE","ACTIVE");
      requireThat(digest(requestedContext)===contextDigest&&
        bindings.every(([k,c])=>request[k]===context[c]),"T3_ACCESS_VAULT_SESSION_CONTEXT_CHANGED");
      requireThat(now>=startedWall&&now<=wall,"T3_ACCESS_VAULT_SESSION_PROOF_TIME_INVALID");
      await readCurrent("ACTIVE");
      guard("PROVE","ACTIVE");
      // No asynchronous boundary between this final guard and signing.
      const proof=makeProof(request,challenge,now,provider);
      await readCurrent("ACTIVE");
      guard("PROVE","ACTIVE");
      return proof;
    }catch(error){close();throw error;}
  });
  async function unlock(){
    requireThat(state==="LOCKED","T3_ACCESS_VAULT_SESSION_LOCKED");
    state="UNLOCKING";
    try{
      startedWall=guard("UNLOCK","UNLOCKING");startedMono=performance.now();
      timer=setTimeout(close,lifetimeMs);timer.unref?.();
      const record=await readVaultRecord(readEncryptedVault);
      guard("UNLOCK","UNLOCKING");
      envelopeHash=envelopeDigest(record);
      let passphrase=await unlockPassphrase({actorId:context.actor_id,keyId,organizationId,asOf:new Date(startedWall).toISOString()});
      try{
        guard("UNLOCK","UNLOCKING");
        const keys=await decryptVaultAsync(record,passphrase);
        guard("UNLOCK","UNLOCKING");
        requireThat(keys.keys[keyId]?.subjectId===context.actor_id,"T3_ACCESS_VAULT_SUBJECT_MISMATCH");
        // Keep the candidate ONLY in the lifetime-owned slot. A lock while
        // the final envelope read is awaiting I/O releases that reference;
        // no local candidate or decrypted PEM vault crosses the readback.
        provider=keyObjectSigner(keyId,vaultPrivateKey(keys,keyId));
      }finally{passphrase=null;}
      await readCurrent("UNLOCKING");
      guard("UNLOCK","UNLOCKING");
      state="ACTIVE";
    }catch(error){close();throw error;}
  }
  return Object.freeze({unlock,signProof,close,get active(){return state==="ACTIVE";}});
}
