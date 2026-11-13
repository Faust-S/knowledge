// Direct Host-side reuse of the canonical existing T3 Access evaluator.
// This module issues no grant, owns no IAM registry, holds no trust key,
// stores nothing, and never reaches the T2 Kernel on its own.
// The installed trusted Control supplies fresh signed registry state and
// a real pre-existing actor proof signer for each selected PERSONAL request.
import {evaluate} from "./core.mjs";

function refuse(code) {
  const error=new Error(code);
  error.name="T3OriginalPersonalAccessError";
  error.code=code;
  error.outcome="DENIED";
  throw error;
}
function requireThat(ok,code){if(!ok)refuse(code);}
const NOW=ms=>Number.isSafeInteger(ms)&&ms>0&&
  Number.isFinite(new Date(ms).getTime());

// Only the existing signer/registry callbacks can supply authority. The
// original evaluate() verifies the Ed25519 grant, actor proof, status
// signature, ancestry, expiry and status floor every time, without cache.
// Keeping this helper Node-only avoids bundling crypto/private owner state
// into the public Workspace or WebLLM Worker.
export function createOriginalPersonalAccessCheck({
  readState, signProof, clock=Date.now,
  randomUUID=()=>globalThis.crypto?.randomUUID(),
}={}){
  for(const fn of [readState,signProof,clock,randomUUID])
    requireThat(typeof fn==="function","T3_ACCESS_ORIGINAL_CALLBACK_REQUIRED");
  return async function checkPersonalSignedRequest(request,selected){
    requireThat(selected?.kind==="PERSONAL"&&
      selected.organization_id===null,
      "T3_ACCESS_ORIGINAL_PERSONAL_CONTEXT_REQUIRED");
    const now=clock();
    requireThat(NOW(now),"T3_ACCESS_ORIGINAL_CLOCK_REQUIRED");
    const a=randomUUID(),b=randomUUID();
    requireThat(typeof a==="string"&&typeof b==="string"&&
      a.length>=16&&b.length>=16&&a!==b,
      "T3_ACCESS_ORIGINAL_NONCE_REQUIRED");
    const challenge=a+b,asOf=new Date(now).toISOString();
    // The authentic actor proof is issued by the trusted local signer.
    // The caller's command and selected context are copied before awaiting.
    let proof;
    try{
      proof=await signProof({
        request:structuredClone(request),context:structuredClone(selected),
        challenge,asOf,
      });
    }catch{
      refuse("T3_ACCESS_ORIGINAL_PROOF_UNAVAILABLE");
    }
    // Critically, read after the asynchronous proof. Revocation that occurs
    // while signing is observed in THIS operation's signed status snapshot.
    let state;
    try{state=await readState();}catch{
      refuse("T3_ACCESS_ORIGINAL_STATE_UNAVAILABLE");
    }
    requireThat(state && typeof state==="object"&&!Array.isArray(state),
      "T3_ACCESS_ORIGINAL_STATE_UNAVAILABLE");
    return evaluate(request,state,{
      now:asOf,challenge,proof,timeAssurance:"LOCAL_BEST_EFFORT",
    });
  };
}
