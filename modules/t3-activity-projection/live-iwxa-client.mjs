import { canonical } from "./index.mjs";
import { readActivityFromT2Host } from "./kernel-reader.mjs";

function reject(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

const READ_OPS = Object.freeze([
  "t1.getWorkspace", "t1.listObjects", "t1.getObject", "t1.listEventsSince",
]);

const WRITE_OPS = new Set([
  "t1.createWorkspace", "t1.commitObjectGraph",
  "t1.putObject", "t1.deleteObject",
  "t1.putRelation", "t1.deleteRelation",
  "t1.putAsset", "t1.deleteAsset",
  "t1.softDeleteWorkspace", "t1.restoreWorkspace",
  "t1.purgePreview", "t1.purgeCommit", "t1.purgeCancel",
  "t2.exportPackage", "t2.confirmExport",
  "t2.importPreview", "t2.importCommit", "t2.importCancel",
]);

export async function readFromLiveT2Kernel({
  bootstrap,
  service_id,
  workspace_id,
  bindings,
  expected_runtime_version = "0.3.6",
} = {}) {
  // A real host must supply its existing window.IWXA bootstrap.
  // This function neither installs an IWXA bootstrap nor supplies a mock.
  if (!bootstrap || typeof bootstrap.connect !== "function") {
    reject("T2_LIVE_BOOTSTRAP_REQUIRED");
  }
  if (typeof service_id !== "string" || !service_id.trim() ||
      typeof workspace_id !== "string" || !workspace_id.trim()) {
    reject("INVALID_LIVE_TARGET");
  }

  const session = await bootstrap.connect({ service_id });
  if (!session || session.contract_version !== "1.3.0" ||
      session.runtime_version !== expected_runtime_version ||
      session.service?.service_id !== service_id ||
      !session.t1 || !Array.isArray(session.granted_operations)) {
    reject("LIVE_T2_CONTRACT_MISMATCH");
  }

  // Enforce that the T3 probe uses an independent read-only T2 service.
  if (session.granted_operations.some((operation) => WRITE_OPS.has(operation))) {
    reject("T2_READER_HAS_WRITE_AUTHORITY");
  }
  if (READ_OPS.some((operation) => !session.granted_operations.includes(operation))) {
    reject("T2_READER_MISSING_READ_GRANT");
  }

  const kernel = Object.freeze({
    sessionInfo: Object.freeze({
      mode: session.mode,
      contract_version: session.contract_version,
      runtime_version: session.runtime_version,
      service_id: session.service.service_id,
    }),
    hasOperation: (operation) => session.granted_operations.includes(operation),
    getWorkspace: (workspaceId) => session.t1.getWorkspace(workspaceId),
    listObjects: (query) => session.t1.listObjects(query),
    getObject: (workspaceId, objectId) => session.t1.getObject(workspaceId, objectId),
    listEventsSince: (workspaceId) => session.t1.listEventsSince(workspaceId),
  });

  const view = await readActivityFromT2Host({
    kernel, workspace_id, bindings,
  });
  return Object.freeze({
    source: "t2-live-kernel-client",
    contract_version: session.contract_version,
    runtime_version: session.runtime_version,
    service_id,
    workspace_id,
    view,
  });
}

// Call with two independently obtained live snapshots, after the caller has
// closed the original browser process and reopened the same T2 data profile.
// The host witness, not this comparator, must prove that cold restart occurred.
export function compareLiveT2Readback(before, after) {
  if (!before || !after ||
      before.source !== "t2-live-kernel-client" ||
      after.source !== "t2-live-kernel-client") reject("LIVE_PROOF_REQUIRED");
  if (canonical(before) !== canonical(after)) reject("T2_COLD_READBACK_CHANGED");
  return Object.freeze({
    status: "MATCHING_LIVE_VIEWS",
    workspace_id: before.workspace_id,
    objects: before.view.nodes.length,
    events: before.view.events.length,
    relations: before.view.relations.length,
  });
}
