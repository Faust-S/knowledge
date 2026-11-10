// IWXA T3 D1: adapt the existing Access authority to the inherited T2 KernelFacade.
// No issuer, IAM, Store, journal, signer, or grant cache is created here.
// Only a trusted Host can provide the Access owner and currently selected context.
const DECISION_SCHEMA = "IWXA_T3_AUTHORIZATION_DECISION/1";
const OPERATIONS = Object.freeze({
  createWorkspace: "t1.createWorkspace",
  getWorkspace: "t1.getWorkspace",
  getObject: "t1.getObject",
  putObject: "t1.putObject",
  listEventsSince: "t1.listEventsSince",
});
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX = /^[a-f0-9]{64}$/;

function refused(code) {
  const error = new Error(code);
  error.name = "SubjectKernelBindingError";
  error.code = code;
  error.outcome = "DENIED";
  throw error;
}
function id(value) {
  return typeof value === "string" && REF.test(value);
}
function requiredId(value, field) {
  if (!id(value)) refused("T3_SUBJECT_"+field+"_INVALID");
  return value;
}
function selected(owner) {
  const c = owner.currentContext();
  if (!c || typeof c !== "object" || !["PERSONAL","CORP"].includes(c.kind)) {
    refused("T3_SUBJECT_CONTEXT_UNAVAILABLE");
  }
  for (const key of [
    "context_id","actor_id","principal_id","role_id","grant_id",
    "realm_id","audience","resource","purpose","workspace_id",
  ]) requiredId(c[key],key.toUpperCase());
  if (!Number.isSafeInteger(c.scope_revision) || c.scope_revision < 1) {
    refused("T3_SUBJECT_SCOPE_REVISION_UNKNOWN");
  }
  if (c.kind === "CORP") requiredId(c.organization_id,"ORGANIZATION_ID");
  else if (c.organization_id !== null) refused("T3_PERSONAL_ORGANIZATION_FORBIDDEN");
  return Object.freeze({
    kind:c.kind,context_id:c.context_id,actor_id:c.actor_id,
    principal_id:c.principal_id,role_id:c.role_id,grant_id:c.grant_id,
    realm_id:c.realm_id,audience:c.audience,resource:c.resource,
    purpose:c.purpose,workspace_id:c.workspace_id,
    organization_id:c.organization_id,scope_revision:c.scope_revision,
  });
}
function identity(c) {
  return JSON.stringify(Object.values(c));
}
function authorizedDecision(decision,context,now) {
  if (!decision || decision.schema !== DECISION_SCHEMA || decision.allowed !== true ||
      decision.outcome !== "PERMITTED" || decision.evidenceOnly !== true ||
      !HEX.test(decision.requestDigest??"") || !HEX.test(decision.policyDigest??"") ||
      !Number.isSafeInteger(decision.statusSequence) || decision.statusSequence < 0 ||
      !Array.isArray(decision.authorityPath) ||
      decision.authorityPath.at(-1)?.grantId !== context.grant_id) {
    refused("T3_ACCESS_NOT_PERMITTED");
  }
  const until = Date.parse(decision.validUntil);
  const observed = Date.parse(decision.statusObservedAt);
  const evaluated = Date.parse(decision.evaluatedAt);
  if (!Number.isFinite(until) || until <= now ||
      !Number.isFinite(observed) || observed > now ||
      !Number.isFinite(evaluated) || evaluated > now) {
    refused("T3_ACCESS_STATUS_NOT_CURRENT");
  }
}
export function createSubjectKernelBinding({ kernel, access, clock = Date.now } = {}) {
  if (!kernel || typeof kernel.hasOperation !== "function" ||
      !kernel.sessionInfo || kernel.sessionInfo.contract_version !== "1.3.0" ||
      typeof clock !== "function") refused("T3_KERNEL_FACADE_REQUIRED");
  for (const method of ["currentContext","actionFor","operationDigest",
     "authorize","verifyDecisionBinding"]) {
    if (typeof access?.[method] !== "function") refused("T3_ACCESS_OWNER_REQUIRED");
  }

  async function invoke(method, input, workspace_id) {
    requiredId(workspace_id,"WORKSPACE_ID");
    const context = selected(access);
    // The caller cannot override a Host-selected PERSONAL/CORP context.
    if (context.workspace_id !== workspace_id) refused("T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE");
    // Capture the actual command before any asynchronous authorization step.
    // The caller must not change a digest-authorized write while the owner checks it.
    let command;
    try { command = structuredClone(input); }
    catch { refused("T3_KERNEL_INPUT_NOT_CLONEABLE"); }
    if (command?.workspace_id !== workspace_id) refused("T3_KERNEL_INPUT_SCOPE_MISMATCH");
    const operation = OPERATIONS[method];
    if (!kernel.hasOperation(operation)) refused("T3_KERNEL_OPERATION_NOT_GRANTED");
    const action = await access.actionFor(operation);
    requiredId(action,"ACTION");
    const operationDigest = await access.operationDigest({operation, input:command, context});
    if (typeof operationDigest !== "string" || !HEX.test(operationDigest)) {
      refused("T3_ACCESS_OPERATION_DIGEST_REQUIRED");
    }
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      refused("T3_LOCAL_RANDOM_REQUIRED");
    }
    const request = Object.freeze({
      id:"t3-"+globalThis.crypto.randomUUID(),
      actorId:context.actor_id,principalId:context.principal_id,
      roleId:context.role_id,grantId:context.grant_id,
      audience:context.audience,resource:context.resource,action,
      purpose:context.purpose,realmId:context.realm_id,
      operationDigest,
    });
    const decision = await access.authorize(request);
    if (await access.verifyDecisionBinding(request,decision) !== true) {
      refused("T3_ACCESS_DECISION_BINDING_INVALID");
    }
    authorizedDecision(decision,context,Number(clock()));
    if (identity(context) !== identity(selected(access))) {
      refused("T3_SUBJECT_CONTEXT_CHANGED");
    }
    if (!kernel.hasOperation(operation)) refused("T3_KERNEL_OPERATION_NOT_GRANTED");
    const result = method === "getObject"
      ? await kernel.getObject(workspace_id,command.object_id)
      : method === "getWorkspace"
        ? await kernel.getWorkspace(workspace_id)
        : method === "listEventsSince"
          ? await kernel.listEventsSince(workspace_id)
          : await kernel[method](command);
    const record = method === "getObject" ? result?.object :
      method === "putObject" ? result?.object :
      method === "createWorkspace" ? result : null;
    if (record && record.workspace_id !== workspace_id) {
      refused("T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
    }
    if (record && command.object_id && record.object_id !== command.object_id) {
      refused("T3_KERNEL_OBJECT_RECEIPT_MISMATCH");
    }
    if (method === "listEventsSince" &&
        (!Array.isArray(result) || result.some(event => event.workspace_id !== workspace_id))) {
      refused("T3_KERNEL_EVENT_SCOPE_MISMATCH");
    }
    return result; // Original T2 Kernel receipt; no duplicate source-of-truth.
  }
  return Object.freeze({
    createWorkspace: input => invoke("createWorkspace",input,input?.workspace_id),
    getWorkspace: workspace_id => invoke("getWorkspace",{workspace_id},workspace_id),
    getObject: (workspace_id, object_id) =>
      invoke("getObject",{workspace_id,object_id:requiredId(object_id,"OBJECT_ID")},workspace_id),
    putObject: input => invoke("putObject",input,input?.workspace_id),
    listEventsSince: workspace_id => invoke("listEventsSince",{workspace_id},workspace_id),
  });
}
