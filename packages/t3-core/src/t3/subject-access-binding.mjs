// IWXA T3 D1: adapt the existing Access authority to the inherited T2 KernelFacade.
// No issuer, IAM, Store, journal, signer, or grant cache is created here.
// Only a trusted Host can provide the Access owner and currently selected context.
const OPERATIONS = Object.freeze({
  createWorkspace: "t1.createWorkspace",
  getWorkspace: "t1.getWorkspace",
  getObject: "t1.getObject",
  listObjects: "t1.listObjects",
  putObject: "t1.putObject",
  deleteObject: "t1.deleteObject",
  putRelation: "t1.putRelation",
  deleteRelation: "t1.deleteRelation",
  listAssets: "t1.listAssets",
  getAsset: "t1.getAsset",
  putAsset: "t1.putAsset",
  deleteAsset: "t1.deleteAsset",
  commitObjectGraph: "t1.commitObjectGraph",
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
  // Existing T3 scoped Workspace Host binds the signed resource to the exact
  // selected workspace ID, not to an independently caller-supplied alias.
  if (c.resource !== c.workspace_id) refused("T3_SUBJECT_RESOURCE_WORKSPACE_MISMATCH");
  if (!Number.isSafeInteger(c.scope_revision) || c.scope_revision < 1) {
    refused("T3_SUBJECT_SCOPE_REVISION_UNKNOWN");
  }
  if (c.kind === "CORP") {
    requiredId(c.organization_id,"ORGANIZATION_ID");
    // T3 Access grants name the organization as principal; the actor is a person.
    if (c.principal_id !== c.organization_id) refused("T3_CORPORATE_PRINCIPAL_MISMATCH");
  } else if (c.organization_id !== null) refused("T3_PERSONAL_ORGANIZATION_FORBIDDEN");
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
  const corporate = context.kind === "CORP";
  const schema = corporate
    ? "IWXA_T3_ORGANIZATION_OPERATION_DECISION/1"
    : "IWXA_T3_AUTHORIZATION_DECISION/1";
  if (!decision || decision.schema !== schema || decision.allowed !== true ||
      decision.outcome !== "PERMITTED" || decision.evidenceOnly !== true ||
      !HEX.test(decision.requestDigest??"") || !HEX.test(decision.policyDigest??"") ||
      !Number.isSafeInteger(decision.statusSequence) || decision.statusSequence < 0) {
    refused("T3_ACCESS_NOT_PERMITTED");
  }
  // The organizational owner signs the enrollment and binds the complete
  // operation in its own digest. Its decision is NOT a direct Access decision.
  if (corporate) {
    if (decision.organizationId !== context.organization_id ||
        decision.workspaceId !== context.workspace_id ||
        decision.grantId !== context.grant_id ||
        !HEX.test(decision.operationDigest??"") ||
        !HEX.test(decision.evidenceDigest??"") ||
        decision.productionActivation !== false ||
        decision.doesNotTransferData !== true ||
        decision.doesNotAcceptCorporateCopy !== true) {
      refused("T3_ACCESS_CORPORATE_DECISION_MISMATCH");
    }
  } else if (!Array.isArray(decision.authorityPath) ||
      decision.authorityPath.at(-1)?.grantId !== context.grant_id) {
    refused("T3_ACCESS_NOT_PERMITTED");
  }
  const until = Date.parse(decision.validUntil);
  if (!Number.isFinite(until) || until <= now) refused("T3_ACCESS_STATUS_NOT_CURRENT");
  if (!corporate) {
    const observed = Date.parse(decision.statusObservedAt);
    const evaluated = Date.parse(decision.evaluatedAt);
    if (!Number.isFinite(observed) || observed > now ||
        !Number.isFinite(evaluated) || evaluated > now) {
      refused("T3_ACCESS_STATUS_NOT_CURRENT");
    }
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
    if (typeof kernel[method] !== "function") refused("T3_KERNEL_OPERATION_UNAVAILABLE");
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
        : method === "getAsset"
          ? await kernel.getAsset(workspace_id,command.asset_id)
          : method === "listEventsSince"
            ? await kernel.listEventsSince(workspace_id,command.since)
            : method === "softDeleteWorkspace" || method === "restoreWorkspace"
              ? await kernel[method](workspace_id)
              : await kernel[method](command);
    const scoped = (record,code) => {
      if (!record || typeof record !== "object" ||
          record.workspace_id !== workspace_id) refused(code);
    };
    const checkEvent = event => scoped(event,"T3_KERNEL_EVENT_SCOPE_MISMATCH");
    const checkRelations = rows => {
      if (!Array.isArray(rows)) refused("T3_KERNEL_RELATION_SCOPE_MISMATCH");
      for (const relation of rows) scoped(relation,"T3_KERNEL_RELATION_SCOPE_MISMATCH");
    };
    if (["listObjects","listAssets","listEventsSince"].includes(method)) {
      if (!Array.isArray(result)) refused("T3_KERNEL_LIST_SCOPE_MISMATCH");
      for (const record of result) {
        scoped(record,method === "listEventsSince"
          ? "T3_KERNEL_EVENT_SCOPE_MISMATCH" : "T3_KERNEL_LIST_SCOPE_MISMATCH");
      }
    }
    if (["createWorkspace","getWorkspace"].includes(method) && result != null)
      scoped(result,"T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
    if (method === "createWorkspace" && result == null)
      refused("T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
    if (method === "getObject" && result != null) {
      scoped(result.object,"T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
      if (result.object.object_id !== command.object_id)
        refused("T3_KERNEL_OBJECT_RECEIPT_MISMATCH");
      checkRelations(result.relations?.incoming);
      checkRelations(result.relations?.outgoing);
    }
    if (method === "getAsset" && result != null) {
      scoped(result.asset,"T3_KERNEL_ASSET_SCOPE_MISMATCH");
      if (result.asset.asset_id !== command.asset_id)
        refused("T3_KERNEL_ASSET_RECEIPT_MISMATCH");
    }
    if (["putObject","deleteObject","commitObjectGraph"].includes(method)) {
      scoped(result?.object,"T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
      const requestedId = method === "commitObjectGraph" ? command.object?.object_id : command.object_id;
      if (result.object.object_id !== requestedId)
        refused("T3_KERNEL_OBJECT_RECEIPT_MISMATCH");
      checkEvent(result.event);
    }
    if (method === "commitObjectGraph") {
      if (result.workspace_id !== workspace_id)
        refused("T3_KERNEL_SCOPE_RECEIPT_MISMATCH");
      checkRelations(result.relations_put);
    }
    if (method === "putRelation") {
      scoped(result?.relation,"T3_KERNEL_RELATION_SCOPE_MISMATCH");
      if (result.relation.relation_id !== command.relation_id ||
          result.relation.from_object_id !== command.from_object_id ||
          result.relation.to_object_id !== command.to_object_id)
        refused("T3_KERNEL_RELATION_RECEIPT_MISMATCH");
      checkEvent(result.event);
    }
    if (method === "deleteRelation") {
      if (result?.relation_id !== command.relation_id)
        refused("T3_KERNEL_RELATION_RECEIPT_MISMATCH");
      checkEvent(result.event);
    }
    if (["putAsset","deleteAsset"].includes(method)) {
      if (method === "putAsset") {
        scoped(result?.asset,"T3_KERNEL_ASSET_SCOPE_MISMATCH");
        if (result.asset.asset_id !== command.asset_id)
          refused("T3_KERNEL_ASSET_RECEIPT_MISMATCH");
      } else if (result?.asset_id !== command.asset_id) {
        refused("T3_KERNEL_ASSET_RECEIPT_MISMATCH");
      }
      checkEvent(result.event);
    }
    return result; // Original T2 Kernel receipt; no duplicate source-of-truth.
  }
  return Object.freeze({
    createWorkspace: input => invoke("createWorkspace",input,input?.workspace_id),
    getWorkspace: workspace_id => invoke("getWorkspace",{workspace_id},workspace_id),
    getObject: (workspace_id, object_id) =>
      invoke("getObject",{workspace_id,object_id:requiredId(object_id,"OBJECT_ID")},workspace_id),
    listObjects: query => invoke("listObjects",query,query?.workspace_id),
    putObject: input => invoke("putObject",input,input?.workspace_id),
    deleteObject: input => invoke("deleteObject",input,input?.workspace_id),
    putRelation: input => invoke("putRelation",input,input?.workspace_id),
    deleteRelation: input => invoke("deleteRelation",input,input?.workspace_id),
    listAssets: query => invoke("listAssets",query,query?.workspace_id),
    getAsset: (workspace_id, asset_id) =>
      invoke("getAsset",{workspace_id,asset_id:requiredId(asset_id,"ASSET_ID")},workspace_id),
    putAsset: input => invoke("putAsset",input,input?.workspace_id),
    deleteAsset: input => invoke("deleteAsset",input,input?.workspace_id),
    commitObjectGraph: input => invoke("commitObjectGraph",input,input?.workspace_id),
    listEventsSince: (workspace_id, since) =>
      invoke("listEventsSince",since === undefined ? {workspace_id} :
        {workspace_id,since:requiredId(since,"SINCE")},workspace_id),
  });
}
