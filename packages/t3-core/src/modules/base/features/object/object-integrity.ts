/**
 * Pure integrity checks for object detail responses.
 *
 * T2-03D: the Workspace shell must never trust that the kernel returned
 * the requested object. A getObject response for the wrong workspace or
 * object_id is treated as an integrity error — payload is NOT rendered.
 */
import type { ObjectRecord, ObjectWithRelations } from "../../../../kernel-client";
import { isSafeOpaqueId } from "../../../../shell/routing";

export interface ObjectIntegrityResult {
  ok: boolean;
  reason:
    | "ok"
    | "workspace-mismatch"
    | "object-id-mismatch"
    | "unsafe-object-id";
}

export function checkObjectIntegrity(
  record: ObjectRecord,
  expectedWorkspaceId: string,
  expectedObjectId: string,
): ObjectIntegrityResult {
  if (record.workspace_id !== expectedWorkspaceId) {
    return { ok: false, reason: "workspace-mismatch" };
  }
  if (!isSafeOpaqueId(record.object_id)) {
    return { ok: false, reason: "unsafe-object-id" };
  }
  if (record.object_id !== expectedObjectId) {
    return { ok: false, reason: "object-id-mismatch" };
  }
  return { ok: true, reason: "ok" };
}

export function checkDetailIntegrity(
  detail: ObjectWithRelations,
  expectedWorkspaceId: string,
  expectedObjectId: string,
): ObjectIntegrityResult {
  return checkObjectIntegrity(detail.object, expectedWorkspaceId, expectedObjectId);
}

export const OBJECT_INTEGRITY_ERROR_MESSAGE =
  "Kernel returned an object that does not match the requested identity";

/** A canvas detail is a read of the exact selected catalog revision, never
 * an implicit switch to a newer result or another schema. */
export function checkCanvasMaterialDetail(
  detail: ObjectWithRelations | null,
  expected: ObjectRecord,
): detail is ObjectWithRelations {
  return Boolean(detail?.object
    && checkDetailIntegrity(detail, expected.workspace_id, expected.object_id).ok
    && detail.object.revision === expected.revision
    && detail.object.schema_id === expected.schema_id
    && detail.object.schema_version === expected.schema_version);
}
