// T3 D1: Host-side bridge to existing independently signed Access owners.
// This file does not issue grants, sign proofs, cache status or contain trust keys.
// Only the trusted Host supplies owner methods and the selected PERSONAL/CORP context.
const DIRECT = "IWXA_T3_AUTHORIZATION_DECISION/1";
const ORGANIZATION = "IWXA_T3_ORGANIZATION_OPERATION_DECISION/1";
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const OWNER_FIELDS = ["actorId","principalId","roleId","grantId","audience",
  "resource","action","purpose","realmId"];
const CONTEXT_BINDINGS = ["kind","context_id","actor_id","principal_id","role_id",
  "grant_id","realm_id","audience","resource","purpose","workspace_id",
  "organization_id","scope_revision"];
const contextIdentity = context => JSON.stringify(CONTEXT_BINDINGS.map(k => context?.[k]));

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
  personal, corporate, resourceRead = null,
  clock = Date.now, randomUUID = () => globalThis.crypto?.randomUUID(),
} = {}) {
  for (const item of [currentContext, actionFor, operationDigest, canonicalDigest, clock, randomUUID]) {
    requireThat(typeof item === "function", "T3_OWNER_HOST_CALLBACK_REQUIRED");
  }
  // Only an installed/trusted product Host may supply its existing
  // READ_ONLY ToolRuntime/knowledge provider. A model or Skill cannot
  // register a handler, and this never calls consequential ToolRuntime.execute.
  requireThat(resourceRead === null || typeof resourceRead === "function",
    "T3_OWNER_RESOURCE_READ_INVALID");
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
  if (corporate?.confirm !== undefined) {
    requireThat(typeof corporate.confirm === "function",
      "T3_OWNER_CORPORATE_CONFIRM_INVALID");
  }
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
      context.realm_id === request.realmId &&
      typeof context.workspace_id === "string" && ID.test(context.workspace_id) &&
      context.resource === request.resource,
      "T3_OWNER_CONTEXT_MISMATCH");
    // The Host may explicitly select a RAG, process or Skill resource within
    // its selected Workspace. The inherited Kernel binding is deliberately
    // stricter: it still requires context.resource === context.workspace_id
    // for all T2 object/event/Exchange calls. Both gates use the SAME T3
    // signed authorization owner; neither is an independent IAM.

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
      const preview = await corporate.gate.preview(input);
      requireThat(preview?.schema === "IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1" &&
        preview.authorized === false && preview.subjectType === "ORGANIZATION" &&
        preview.organizationId === context.organization_id &&
        preview.workspaceId === context.workspace_id &&
        sameRequestFields(preview.request, request) &&
        HEX.test(preview.request?.operationDigest) &&
        preview.scopeDigest === preview.request.operationDigest,
        "T3_OWNER_CORPORATE_PREVIEW_MISMATCH");
      // Caller-provided actor name is not a staff identity. Only the
      // original signed organization enrollment can bind an agent to a
      // separate verified human and a narrowed grant.
      if(hostInput.agentEnrollment !== undefined) {
        requireThat(preview.actorIdentityKind === "AGENT" &&
          typeof preview.responsiblePersonId === "string" &&
          ID.test(preview.responsiblePersonId) &&
          preview.responsiblePersonId !== request.actorId &&
          preview.agentEnrollmentDigest ===
            digestFrom(canonicalDigest, hostInput.agentEnrollment),
          "T3_OWNER_CORPORATE_AGENT_ACCOUNTABILITY_UNBOUND");
      }
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
      // A consequential operation can require a separate ORIGINAL T3
      // CONFIRMATION by an authorized HUMAN principal. Only the trusted
      // product Host's existing Human Review/approval signer may supply it.
      // An agent proof or unverified UI flag is NEVER treated as approval.
      const confirmations = typeof corporate.confirm === "function"
        ? await corporate.confirm({
            request:structuredClone(preview.request),challenge,
            context:structuredClone(context),asOf:at,
            operation:structuredClone(operation)
          })
        : [];
      requireThat(Array.isArray(confirmations) && confirmations.length <= 8 &&
        confirmations.every(item => item && typeof item === "object" &&
          !Array.isArray(item)), "T3_OWNER_CORPORATE_CONFIRM_INVALID");
      const atJit = nowFrom(clock);
      decision = await corporate.gate.authorize({...input, asOf:atJit},
        {now:atJit,challenge,proof,confirmations,timeAssurance:"LOCAL_BEST_EFFORT"});
      // The original Access gate intentionally returns a short DENIED or
      // UNRESOLVED decision without success-only binding fields. Treat it as
      // denied, not as a malformed successful decision. No Kernel call follows.
      if (decision?.schema === ORGANIZATION &&
          decision.allowed !== true && decision.outcome !== "PERMITTED") {
        deny("T3_ACCESS_NOT_PERMITTED");
      }
      requireThat(decision?.schema === ORGANIZATION &&
        decision.requestDigest === expectedRequestDigest &&
        decision.operationDigest === expectedOperationDigest &&
        decision.organizationId === context.organization_id &&
        decision.workspaceId === context.workspace_id &&
        decision.grantId === context.grant_id &&
        (hostInput.agentEnrollment === undefined ||
          (decision.actorId === request.actorId &&
           decision.actorIdentityKind === "AGENT" &&
           decision.responsiblePersonId === preview.responsiblePersonId &&
           decision.agentEnrollmentDigest === preview.agentEnrollmentDigest)),
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

  // Execution-side guard for the existing read-only provider, not a new
  // ToolRuntime, IAM, scheduler or Store. Host constructs the complete signed
  // request from immutable arguments and its own selected resource. The
  // provider never sees issuer private keys or receives an unsigned grant.
  async function readAuthorizedResource(operation, argumentsInput) {
    requireThat(resourceRead !== null, "T3_OWNER_RESOURCE_READ_UNAVAILABLE");
    requireThat(typeof operation === "string" && ID.test(operation),
      "T3_OWNER_RESOURCE_OPERATION_INVALID");
    let args, context;
    try {
      args = structuredClone(argumentsInput);
      context = structuredClone(currentContext());
    } catch {
      deny("T3_OWNER_RESOURCE_INPUT_NOT_CLONEABLE");
    }
    requireThat(args && typeof args === "object" && !Array.isArray(args),
      "T3_OWNER_RESOURCE_ARGUMENTS_INVALID");
    requireThat(context && typeof context === "object" &&
      Number.isSafeInteger(context.scope_revision) && context.scope_revision > 0 &&
      ID.test(context.resource??"") && ID.test(context.workspace_id??""),
      "T3_OWNER_RESOURCE_CONTEXT_INVALID");
    const selected = contextIdentity(context);
    const action = await actionFor(operation);
    requireThat(typeof action === "string" && ID.test(action),
      "T3_OWNER_RESOURCE_ACTION_INVALID");
    // The original Host digest implementation binds these precise arguments.
    const operationHash = await operationDigest({operation,input:args,context});
    requireThat(typeof operationHash === "string" && HEX.test(operationHash),
      "T3_OWNER_RESOURCE_DIGEST_INVALID");
    const request = Object.freeze({
      id:"t3-"+randomUUID(),actorId:context.actor_id,
      principalId:context.principal_id,roleId:context.role_id,
      grantId:context.grant_id,audience:context.audience,
      resource:context.resource,action,purpose:context.purpose,
      realmId:context.realm_id,operationDigest:operationHash,
    });
    const assertReadDecision = async decision => {
      requireThat(await verifyDecisionBinding(request,decision) === true,
        "T3_OWNER_RESOURCE_DECISION_UNBOUND");
      requireThat(decision.allowed === true && decision.outcome === "PERMITTED" &&
        decision.evidenceOnly === true &&
        Number.isSafeInteger(decision.statusSequence) &&
        decision.statusSequence >= 0 &&
        Number.isFinite(Date.parse(decision.validUntil)) &&
        Date.parse(decision.validUntil) > clock(),
        "T3_OWNER_RESOURCE_ACCESS_NOT_PERMITTED");
      if(context.kind === "CORP") {
        requireThat(decision.schema === ORGANIZATION &&
          decision.organizationId === context.organization_id &&
          decision.workspaceId === context.workspace_id &&
          decision.grantId === context.grant_id &&
          decision.doesNotTransferData === true,
          "T3_OWNER_RESOURCE_CORPORATE_SCOPE_MISMATCH");
      } else {
        requireThat(decision.schema === DIRECT &&
          decision.authorityPath?.at(-1)?.grantId === context.grant_id,
          "T3_OWNER_RESOURCE_PERSONAL_SCOPE_MISMATCH");
      }
      requireThat(contextIdentity(currentContext()) === selected,
        "T3_OWNER_RESOURCE_CONTEXT_CHANGED");
    };
    const decision = await authorize(request);
    await assertReadDecision(decision);
    // This callback must be the existing read-only provider's read() path,
    // never an external-effect ToolRuntime.execute() without Human Review.
    const result = await resourceRead({
      operation,arguments:structuredClone(args),context:structuredClone(context)
    });
    // A read can finish after a context switch or a delivered revocation.
    // Recheck the CURRENT signed grant/status with fresh proof before exposing
    // its content. In-flight provider access cannot be retroactively undone.
    requireThat(contextIdentity(currentContext()) === selected,
      "T3_OWNER_RESOURCE_CONTEXT_CHANGED");
    const refreshed = await authorize(request);
    await assertReadDecision(refreshed);
    let data;
    try { data=structuredClone(result); }
    catch { deny("T3_OWNER_RESOURCE_RESULT_NOT_CLONEABLE"); }
    const outputDigest = digestFrom(canonicalDigest,data);
    return Object.freeze({
      data,authorization:Object.freeze({
        requestDigest:refreshed.requestDigest,
        policyDigest:refreshed.policyDigest,
        statusSequence:refreshed.statusSequence,
        validUntil:refreshed.validUntil,
        resource:context.resource,action,actorId:context.actor_id,
        operationDigest:operationHash,outputDigest,
      })
    });
  }

  return Object.freeze({
    currentContext,
    actionFor,
    operationDigest,
    authorize,
    verifyDecisionBinding,
    readAuthorizedResource,
  });
}
