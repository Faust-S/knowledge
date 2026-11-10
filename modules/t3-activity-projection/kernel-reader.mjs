import { canonical, projectActivitySnapshot } from "./index.mjs";

const READ_OPERATIONS = Object.freeze([
  "t1.getWorkspace",
  "t1.listObjects",
  "t1.getObject",
  "t1.listEventsSince",
]);

function reject(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareRows(rows, identity) {
  return canonical([...rows].sort((left, right) =>
    String(left[identity]).localeCompare(String(right[identity]), "en")));
}

function verifyScope(rows, workspaceId) {
  if (!Array.isArray(rows)) reject("INVALID_T2_RESPONSE");
  for (const row of rows) {
    if (!record(row)) reject("INVALID_T2_RESPONSE");
    if (row.workspace_id !== workspaceId) reject("CROSS_WORKSPACE_SOURCE");
  }
}

function stableRows(first, second, identity, workspaceId) {
  verifyScope(second, workspaceId);
  if (compareRows(first, identity) !== compareRows(second, identity)) {
    reject("SOURCE_CHANGED_DURING_READ");
  }
}

export async function readActivityFromT2Host({
  kernel,
  workspace_id: workspaceId,
  bindings,
  max_objects: maxObjects = 2000,
  max_events: maxEvents = 50000,
} = {}) {
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    reject("INVALID_WORKSPACE");
  }
  if (!record(kernel) || !record(kernel.sessionInfo) ||
      kernel.sessionInfo.contract_version !== "1.3.0" ||
      typeof kernel.hasOperation !== "function") {
    reject("INCOMPATIBLE_T2_FACADE");
  }
  for (const operation of READ_OPERATIONS) {
    if (!kernel.hasOperation(operation)) reject("OPERATION_NOT_GRANTED");
  }
  for (const method of ["getWorkspace", "listObjects", "getObject", "listEventsSince"]) {
    if (typeof kernel[method] !== "function") reject("INCOMPATIBLE_T2_FACADE");
  }
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 1) {
    reject("INVALID_BOUND");
  }

  const workspace = await kernel.getWorkspace(workspaceId);
  if (!record(workspace) || workspace.workspace_id !== workspaceId ||
      workspace.deleted_at) reject("WORKSPACE_NOT_ACTIVE");

  const query = Object.freeze({ workspace_id: workspaceId, include_deleted: true });
  const [objects, events] = await Promise.all([
    kernel.listObjects(query),
    kernel.listEventsSince(workspaceId),
  ]);
  verifyScope(objects, workspaceId);
  verifyScope(events, workspaceId);
  if (objects.length > maxObjects || events.length > maxEvents) {
    reject("SOURCE_LIMIT_EXCEEDED");
  }

  // T2 lists do not expose relations. The existing getObject() read façade does.
  const relations = [];
  const relationIds = new Map();
  for (let offset = 0; offset < objects.length; offset += 16) {
    const batch = objects.slice(offset, offset + 16);
    const details = await Promise.all(batch.map((row) => {
      if (typeof row.object_id !== "string" || !row.object_id) {
        reject("INVALID_T2_OBJECT");
      }
      return kernel.getObject(workspaceId, row.object_id);
    }));
    for (let index = 0; index < batch.length; index++) {
      const listed = batch[index];
      const detail = details[index];
      if (!record(detail) || !record(detail.object) ||
          detail.object.workspace_id !== workspaceId ||
          detail.object.object_id !== listed.object_id ||
          canonical(detail.object) !== canonical(listed)) {
        reject("SOURCE_CHANGED_DURING_READ");
      }
      if (!record(detail.relations) || !Array.isArray(detail.relations.outgoing)) {
        reject("INVALID_T2_RELATIONS");
      }
      for (const relation of detail.relations.outgoing) {
        if (!record(relation) || relation.workspace_id !== workspaceId) {
          reject("CROSS_WORKSPACE_SOURCE");
        }
        if (relation.from_object_id !== listed.object_id ||
            typeof relation.relation_id !== "string" || !relation.relation_id) {
          reject("INVALID_T2_RELATIONS");
        }
        const digest = canonical(relation);
        const existing = relationIds.get(relation.relation_id);
        if (existing !== undefined) {
          if (existing !== digest) reject("CONFLICTING_RELATION_ID");
        } else {
          relationIds.set(relation.relation_id, digest);
          relations.push(relation);
        }
      }
    }
  }

  // An independent second read detects ordinary source/event changes during
  // enumeration. This is NOT an atomic database snapshot or trusted checkpoint.
  const [afterWorkspace, afterObjects, afterEvents] = await Promise.all([
    kernel.getWorkspace(workspaceId),
    kernel.listObjects(query),
    kernel.listEventsSince(workspaceId),
  ]);
  if (!record(afterWorkspace) || afterWorkspace.workspace_id !== workspaceId ||
      afterWorkspace.deleted_at || canonical(afterWorkspace) !== canonical(workspace)) {
    reject("SOURCE_CHANGED_DURING_READ");
  }
  stableRows(objects, afterObjects, "object_id", workspaceId);
  stableRows(events, afterEvents, "event_id", workspaceId);

  return projectActivitySnapshot({
    workspace_id: workspaceId, objects, events, relations, bindings,
  });
}
