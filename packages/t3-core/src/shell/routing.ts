/**
 * Opaque-id predicate — the only thing preserved from the deleted
 * legacy shell router (PROMPT 28). It gates workspace_id / object_id
 * strings before they reach the kernel; it is not a router utility
 * and does not depend on any hash-routing code.
 */

/** Grammar accepted by the kernel Local Store for opaque ids. */
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function isSafeOpaqueId(id: string): boolean {
  return typeof id === "string" && ID.test(id);
}
