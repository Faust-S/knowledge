// T3 D1: Host-side bridge to existing independently signed Access owners.
// This file does not issue grants, sign proofs, cache status or contain trust keys.
// Only the trusted Host supplies owner methods and the selected PERSONAL/CORP context.
const DIRECT = "IWXA_T3_AUTHORIZATION_DECISION/1";
const ORGANIZATION = "IWXA_T3_ORGANIZATION_OPERATION_DECISION/1";
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const OWNER_FIELDS = ["actorId","principalId","roleId","grantId","audience",
  "resource","action","purpose","realmId"];

function deny(code) {
  const e = new Error(code);
  e.name = "T3SignedAccessHostError";
  e.code = code;
  e.outcome = "DENIED";
  throw e;
}
function requireThat(ok, code) { if (!ok) deny(code); }
function digestFrom(owner, value) {
  const d = owner(value);
  requireThat(typeof d === "string" && HEX.test(d), "T3_OWNER_DIGEST_INVALID");
  return d;
}
function nowFrom(clock) {
  const now = clock();
  requireThat(Number.isSafeInteger(now) && now > 0, "T3_OWNER_CLOCK_INVALID");
  return new Date(now).toISOString();
}
function sameRequestFields(actual, expected) {
  return actual && OWNER_FIELDS.every(field => actual[field] === expected[field]);
}

// Pass personal.check as an existing signed local Access evaluator (for example,
// a trusted registry.check bound to its proof key). Pass corporate.gate as the
// pre-existing createOrganizationalOperationGate({registry}) instance and
// corporate.prove as the trusted credential proof provider. Neither is created
// by this adapter, and no signer or registry is exposed in the returned port.
export function createSignedAccessHostPort({
  currentContext, actionFor, operationDigest, canonicalDigest,
  personal, corporate, clock = Date.now, randomUUID = () => globalThis.crypto?.randomUUID(),
} = {}) {
  for (const item of [currentContext, actionFor, operationDigest, canonicalDigest, clock, randomUUID]) {
    requireThat(typeof item === "function", "T3_OWNER_HOST_CALLBACK_REQUIRED");
  }
  // A PERSONAL installation must work without Admin Center or organizational
  // enrollment. Requiring both owners would break autonomous T3 local work.
  const hasPersonal = typeof personal?.check === "function";
  const hasCorporate = typeof corporate?.gate?.preview === "function" &&
    typeof corporate?.gate?.authorize === "function" &&
    typeof corporate?.inputFor === "function" &&
    typeof corporate?.prove === "function";
  requireThat(hasPersonal || hasCorporate, "T3_OWNER_ACCESS_REQUIRED");
  if (personal != null) requireThat(hasPersonal,"T3_OWNER_PERSONAL_ACCESS_INVALID");
  if (corporate != null) requireThat(hasCorporate,"T3_OWNER_CORPORATE_GATE_INVALID");
  // Corporate product IDs are validated by the existing signed enrollment gate.
  // A T3-only invented product ID would make a false claim of compatibility.
  const productId = hasCorporate ? corporate.productId : null;
  if (hasCorporate) {
    requireThat(typeof productId === "string" && productId.length > 0,
      "T3_OWNER_CORPORATE_PRODUCT_REQUIRED");
    requireThat(["IWXA_ADMIN_CENTER","IWXA_CONTROL_CENTER"].includes(productId),
      "T3_OWNER_CORPORATE_PRODUCT_UNSUPPORTED");
  }
  const issued = new WeakMap();

  async function authorize(request) {
    requireThat(request && typeof request === "object" && !Array.isArray(request) &&
      OWNER_FIELDS.every(field => typeof request[field] === "string" && ID.test(request[field])) &&
      HEX.test(request.operationDigest) && ID.test(request.id),
      "T3_OWNER_REQUEST_INVALID");
    const context = structuredClone(currentContext());
    requireThat(context && (context.kind === "PERSONAL" || context.kind === "CORP") &&
      context.actor_id === request.actorId && context.principal_id === request.principalId &&
      context.role_id === request.roleId && context.grant_id === request.grantId &&
      context.realm_id === request.realmId && context.workspace_id === request.resource,
      "T3_OWNER_CONTEXT_MISMATCH");

    let decision, expectedRequestDigest, expectedOperationDigest = null;
    if (context.kind === "PERSONAL") {
      requireThat(hasPersonal, "T3_OWNER_PERSONAL_ACCESS_UNAVAILABLE");
      decision = await personal.check(request, context);
      expectedRequestDigest = digestFrom(canonicalDigest, request);
      requireThat(decision?.schema === DIRECT && decision.requestDigest === expectedRequestDigest,
        "T3_OWNER_PERSONAL_DECISION_UNBOUND");
    } else {
      requireThat(hasCorporate, "T3_OWNER_CORPORATE_GATE_UNAVAILABLE");
      requireThat(context.organization_id === request.principalId,
        "T3_OWNER_CORPORATE_PRINCIPAL_MISMATCH");
      const hostInput = structuredClone(await corporate.inputFor(context));
      requireThat(hostInput && typeof hostInput === "object" && !Array.isArray(hostInput),
        "T3_OWNER_CORPORATE_INPUT_UNAVAILABLE");
      const operation = Object.freeze({
        operationId:request.id, productId, audience:request.audience, resource:request.resource,
        action:request.action, purpose:request.purpose, payloadDigest:request.operationDigest,
      });
      const at = nowFrom(clock);
      const input = {...hostInput,operation,asOf:at};
      // The real organizational owner computes a DIFFERENT, enrollment-bound
      // digest of the complete operation. Never substitute the payload digest.
      const preview = corporate.gate.preview(input);
      requireThat(preview?.schema === "IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1" &&
        preview.authorized === false && preview.subjectType === "ORGANIZATION" &&
        preview.organizationId === context.organization_id &&
        preview.workspaceId === context.workspace_id &&
        sameRequestFields(preview.request, request) &&
        HEX.test(preview.request?.operationDigest) &&
        preview.scopeDigest === preview.request.operationDigest,
        "T3_OWNER_CORPORATE_PREVIEW_MISMATCH");
      expectedRequestDigest = digestFrom(canonicalDigest, preview.request);
      expectedOperationDigest = preview.request.operationDigest;
      const nonce1 = randomUUID(), nonce2 = randomUUID();
      requireThat(typeof nonce1 === "string" && typeof nonce2 === "string" &&
        nonce1.length >= 16 && nonce2.length >= 16 && nonce1 !== nonce2,
        "T3_OWNER_CHALLENGE_UNAVAILABLE");
      const challenge = nonce1 + nonce2;
      const proof = await corporate.prove({
        request:structuredClone(preview.request), challenge,
        credentialKeyId:preview.credentialKeyId,
        context:structuredClone(context), asOf:at,
      });
      requireThat(proof && typeof proof === "object" && !Array.isArray(proof) &&
        proof.keyId === preview.credentialKeyId,
        "T3_OWNER_CORPORATE_PROOF_UNAVAILABLE");
      // Re-evaluates the authoritative registry state, signed enrollment,
      // credential, grant ancestry, signed status and exact proof binding.
      // The proof is never generated, weakened or substituted here.
      const atJit = nowFrom(clock);
      decision = corporate.gate.authorize({...input, asOf:atJit},
        {now:atJit,challenge,proof,timeAssurance:"LOCAL_BEST_EFFORT"});
      requireThat(decision?.schema === ORGANIZATION &&
        decision.requestDigest === expectedRequestDigest &&
        decision.operationDigest === expectedOperationDigest &&
        decision.organizationId === context.organization_id &&
        decision.workspaceId === context.workspace_id &&
        decision.grantId === context.grant_id,
        "T3_OWNER_CORPORATE_DECISION_UNBOUND");
    }
    requireThat(decision && typeof decision === "object" && !Array.isArray(decision),
      "T3_OWNER_DECISION_INVALID");
    issued.set(decision, {request, expectedRequestDigest, expectedOperationDigest});
    return decision; // Authentic owner's decision, never a synthetic direct decision.
  }

  async function verifyDecisionBinding(request, decision) {
    const record = decision && typeof decision === "object" ? issued.get(decision) : null;
    return !!(record && record.request === request &&
      decision.requestDigest === record.expectedRequestDigest &&
      (record.expectedOperationDigest === null ||
        decision.operationDigest === record.expectedOperationDigest));
  }

  return Object.freeze({
    currentContext,
    actionFor,
    operationDigest,
    authorize,
    verifyDecisionBinding,
  });
}
