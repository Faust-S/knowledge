// The SAME encrypted vault supports both a PERSON's personal proof key and
// organization-issued proof credentials. A corporate signer is always pinned
// to one trusted organizationId and one issued credentialKeyId. The original
// organizational gate still verifies the actual signed enrollment, grant
// and public key independently; this is never a new corporate issuer.
// Node-only trusted owner adapter. Uses the ONE original IWXA T3 encrypted
// key vault and Ed25519 proof algorithm adopted in knowledge. It does NOT
// create a registry, IAM, Store or new signing protocol. Private keys never
// enter the Workspace, browser Worker, .iwxa package or user-facing response.
import {makeProof,keyObjectSigner} from "./core.mjs";
import {decryptVault,vaultPrivateKey} from "./local-vault.mjs";
import {strictJson} from "./strict-json.mjs";

const IDENT=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
function refuse(code){
  const e=new Error(code);
  e.name="T3OriginalVaultSignerError";
  e.code=code;e.outcome="DENIED";throw e;
}
function requireThat(ok,code){if(!ok)refuse(code);}
export function createOriginalVaultProofSigner({
  readEncryptedVault,unlockPassphrase,keyId,organizationId=null,
  personalPrincipalId=null,
}={}){
  requireThat(typeof readEncryptedVault==="function"&&
    typeof unlockPassphrase==="function"&&
    typeof keyId==="string"&&IDENT.test(keyId)&&
    (organizationId===null||
      (typeof organizationId==="string"&&IDENT.test(organizationId)))&&
    (personalPrincipalId===null||
      (typeof personalPrincipalId==="string"&&IDENT.test(personalPrincipalId)))&&
    (organizationId===null||personalPrincipalId===null),
    "T3_ACCESS_VAULT_CALLBACK_REQUIRED");
  return async function signExistingActorProof({
    request,context,challenge,asOf,credentialKeyId,
  }={}){
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
    // Read the current encrypted vault on every request. An installed Host
    // decides how to unlock it (passphrase or OS-protected credential).
    // No plaintext persistence, default password, cache or remote service.
    let encrypted,passphrase;
    try{
      encrypted=await readEncryptedVault();
      passphrase=await unlockPassphrase({
        actorId:context.actor_id,keyId,
        organizationId,asOf,
      });
    }catch{refuse("T3_ACCESS_VAULT_UNAVAILABLE");}
    const record=typeof encrypted==="string"?strictJson(encrypted):encrypted;
    const keys=decryptVault(record,passphrase);
    requireThat(keys.keys[keyId]?.subjectId===request.actorId,
      "T3_ACCESS_VAULT_SUBJECT_MISMATCH");
    return makeProof(request,challenge,now,
      keyObjectSigner(keyId,vaultPrivateKey(keys,keyId)));
  };
}
