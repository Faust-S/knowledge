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
  readEncryptedVault,unlockPassphrase,keyId,
}={}){
  requireThat(typeof readEncryptedVault==="function"&&
    typeof unlockPassphrase==="function"&&
    typeof keyId==="string"&&IDENT.test(keyId),
    "T3_ACCESS_VAULT_CALLBACK_REQUIRED");
  return async function signExistingActorProof({
    request,context,challenge,asOf,
  }={}){
    requireThat(context?.kind==="PERSONAL"&&
      context.organization_id===null&&
      request?.actorId===context.actor_id&&
      typeof request.actorId==="string"&&IDENT.test(request.actorId),
      "T3_ACCESS_VAULT_SUBJECT_MISMATCH");
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
        actorId:context.actor_id,keyId,asOf,
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
