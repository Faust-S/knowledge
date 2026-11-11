// D5: explicit user-approved local model draft in the ORIGINAL T3/T2 Workspace.
// This does not create a model runtime, Result authority, Store or second Kernel.
export const LOCAL_INFERENCE_DRAFT_SCHEMA = "iwxa.local-inference.draft";
export const LOCAL_INFERENCE_DRAFT_DECLARATION = Object.freeze({
  schema_version: "1.0.0",
  preserve_unknown: false,
  json_schema: {
    type: "object",
    properties: {
      status: {const: "DRAFT_UNTRUSTED"},
      text: {type: "string", minLength: 1, maxLength: 64000},
      model_id: {type: "string", minLength: 1, maxLength: 256},
      engine: {type: "string", minLength: 1, maxLength: 256},
      origin: {const: "BROWSER_LOCAL"},
      source: {const: "USER_EXPLICIT_SAVE"},
      model_integrity: {const: "NOT_ATTESTED"},
    },
    required: ["status","text","model_id","engine","origin","source","model_integrity"],
    additionalProperties: false,
  },
  embedded: {},
});

function refuse(code, details) {
  const error = new Error(code);
  error.code = code;
  if (details) Object.assign(error, details);
  throw error;
}
function text(value, max, code) {
  if (typeof value !== "string" || !value.trim() || value.length > max) refuse(code);
  return value.trim();
}
function selected(context, allowed) {
  if (!context?.kernel || !context?.currentWorkspace ||
      typeof context.currentWorkspace.get !== "function" ||
      typeof context.currentWorkspace.subscribe !== "function") {
    refuse("T3_D5_MODULE_CONTEXT_REQUIRED");
  }
  const choice = context.currentWorkspace.get();
  const workspaceId = choice?.workspace_id;
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    refuse("T3_D5_WORKSPACE_NOT_SELECTED");
  }
  if (allowed && workspaceId !== allowed) refuse("T3_D5_WORKSPACE_CHANGED");
  return { workspaceId, choice };
}
function requireKernel(kernel, operations) {
  if (kernel?.sessionInfo?.contract_version !== "1.3.0" ||
      typeof kernel.hasOperation !== "function" ||
      operations.some(op => !kernel.hasOperation(op))) {
    refuse("T3_D5_KERNEL_PERMISSION_REQUIRED");
  }
}
function watch(context, choice) {
  let invalidated = false;
  const unsubscribe = context.currentWorkspace.subscribe(() => {
    invalidated = true; // includes A -> B -> A, even when the same ID returns
  });
  const validate = () => {
    if (invalidated || context.currentWorkspace.get() !== choice) {
      refuse("T3_D5_WORKSPACE_CHANGED");
    }
  };
  return { validate, unsubscribe };
}

export async function saveLocalInferenceDraft(context, {
  expected_workspace_id,
  model_id,
  engine,
  output,
} = {}) {
  // This is called by an explicit Save action AFTER local inference. Neither
  // the prompt nor source workspace objects are copied into the draft.
  const { workspaceId, choice } = selected(context, expected_workspace_id);
  if (typeof expected_workspace_id !== "string" || !expected_workspace_id.trim()) {
    refuse("T3_D5_EXPLICIT_WORKSPACE_REQUIRED");
  }
  const modelId = text(model_id, 256, "T3_D5_MODEL_ID_REQUIRED");
  const engineId = text(engine, 256, "T3_D5_ENGINE_REQUIRED");
  const draftText = text(output, 64000, "T3_D5_DRAFT_REQUIRED");
  const kernel = context.kernel;
  requireKernel(kernel, ["t1.getWorkspace", "t1.putObject", "t1.getObject"]);
  const { validate, unsubscribe } = watch(context, choice);
  const objectId = "local-inference:" + globalThis.crypto.randomUUID();
  let acceptedByKernel = false;
  try {
    validate();
    const workspace = await kernel.getWorkspace(workspaceId);
    validate();
    if (!workspace || workspace.workspace_id !== workspaceId ||
        workspace.deleted_at) refuse("T3_D5_WORKSPACE_NOT_ACTIVE");

    const data = {
      status: "DRAFT_UNTRUSTED",
      text: draftText,
      model_id: modelId,
      engine: engineId,
      origin: "BROWSER_LOCAL",
      source: "USER_EXPLICIT_SAVE",
      model_integrity: "NOT_ATTESTED",
    };
    const receipt = await kernel.putObject({
      workspace_id: workspaceId,
      object_id: objectId,
      schema_id: LOCAL_INFERENCE_DRAFT_SCHEMA,
      schema_version: "1.0.0",
      base_revision: 0,
      data,
      extensions: {},
      event: { event_type: "t3.local-inference.draft.saved", payload: {
        status: "DRAFT_UNTRUSTED", model_id: modelId,
      }},
    });
    acceptedByKernel = true; // a late failure must NEVER trigger auto-retry
    validate();
    if (receipt?.object?.workspace_id !== workspaceId ||
        receipt.object.object_id !== objectId ||
        receipt.object.revision !== 1 ||
        typeof receipt?.event?.event_id !== "string") {
      refuse("T3_D5_KERNEL_RECEIPT_INVALID");
    }
    const detail = await kernel.getObject(workspaceId, objectId);
    validate();
    if (!detail?.object ||
        detail.object.workspace_id !== workspaceId ||
        detail.object.object_id !== objectId ||
        detail.object.revision !== receipt.object.revision ||
        detail.object.schema_id !== LOCAL_INFERENCE_DRAFT_SCHEMA ||
        JSON.stringify(detail.object.data) !== JSON.stringify(data)) {
      refuse("T3_D5_DRAFT_READBACK_MISMATCH");
    }
    return Object.freeze({
      workspace_id: workspaceId, object_id: objectId,
      revision: receipt.object.revision, event_id: receipt.event.event_id,
      status: "DRAFT_UNTRUSTED", readback: true,
    });
  } catch (error) {
    if (acceptedByKernel) {
      // The original Kernel may have committed. Return recoverable identity
      // and a clear ambiguous status instead of a fictitious rollback.
      refuse("T3_D5_WRITE_MAY_HAVE_COMMITTED", {
        object_id: objectId, workspace_id: workspaceId,
        cause_code: error?.code ?? "UNVERIFIED_READBACK",
      });
    }
    throw error;
  } finally {
    unsubscribe();
  }
}

export async function listLocalInferenceDrafts(context, {
  expected_workspace_id,
} = {}) {
  const { workspaceId, choice } = selected(context, expected_workspace_id);
  if (typeof expected_workspace_id !== "string" || !expected_workspace_id.trim()) {
    refuse("T3_D5_EXPLICIT_WORKSPACE_REQUIRED");
  }
  const kernel = context.kernel;
  requireKernel(kernel, ["t1.getWorkspace", "t1.listObjects"]);
  const { validate, unsubscribe } = watch(context, choice);
  try {
    validate();
    const workspace = await kernel.getWorkspace(workspaceId);
    validate();
    if (!workspace || workspace.workspace_id !== workspaceId ||
        workspace.deleted_at) refuse("T3_D5_WORKSPACE_NOT_ACTIVE");
    const objects = await kernel.listObjects({ workspace_id: workspaceId });
    validate();
    if (!Array.isArray(objects) || objects.some(row =>
      row?.workspace_id !== workspaceId)) refuse("T3_D5_SOURCE_SCOPE_MISMATCH");
    return objects
      .filter(row => row.schema_id === LOCAL_INFERENCE_DRAFT_SCHEMA &&
        row.deleted !== true && !row.deleted_at)
      .map(row => Object.freeze({
        workspace_id: workspaceId, object_id: row.object_id,
        revision: row.revision,
        status: row.data?.status,
        model_id: row.data?.model_id,
        text: row.data?.text,
      }));
  } finally {
    unsubscribe();
  }
}
