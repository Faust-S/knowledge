/**
 * createKernelFacade — PROMPT 17 §8.
 *
 * Real, capability-checked façade over the workspace `adapter`. Each
 * method:
 *   - fails fast if `session.granted_operations` does not include the
 *     exact operation id (adapter throws `OperationNotGrantedError`);
 *   - passes arguments through unchanged;
 *   - returns adapter results unchanged;
 *   - keeps NO cache and does NOT expose `session`, `adapter`, or
 *     Runtime internals.
 */

import type { KernelFacade } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type { KernelSession } from "@/kernel-client/types";
import { adapter } from "@/kernel-client/adapter";
import { createSubjectKernelBinding } from "@/t3/index.mjs";
import type { T3SignedActivityAccess } from "@/t3/index.mjs";
import type { Level } from "@/kernel-client/contracts/runtime-1.3.0";

import { negotiateAtomicGraph } from "@/kernel-client/contracts/runtime-1.3.0/atomic-graph-negotiation";
export interface KernelFacadeInput {
  session: KernelSession;
  /** Trusted Host-only signed owner, never a module, package, or UI field.
   * The provider resolves the current PERSONAL/CORP authority per operation. */
  signedKernelAccess?: T3SignedActivityAccess |
    ((operation: string) => T3SignedActivityAccess | null | Promise<T3SignedActivityAccess | null>);
  /** The original Host lifecycle, not a second authorization registry. */
  isHostActive?: () => boolean;
}

export function createKernelFacade(input: KernelFacadeInput): KernelFacade {
  const { session } = input;
  const atomicAvailable = negotiateAtomicGraph(session).available;
  const grantedOperations = Object.freeze(
    [...(session.granted_operations ?? [])].filter(op => op !== "t1.commitObjectGraph" || atomicAvailable),
  ) as readonly OperationId[];
  const grantedLevels = Object.freeze(
    [...(session.granted_levels ?? [])],
  ) as readonly Level[];
  const grantedOpSet = new Set<string>(grantedOperations as readonly string[]);

  const facade: KernelFacade = {
    ...(atomicAvailable ? { commitObjectGraph: async (value: import("@/kernel-client/contracts/runtime-1.3.0").CommitObjectGraphInput) => adapter.commitObjectGraph(session, value) } : {}),
    hasOperation(op) {
      return grantedOpSet.has(op);
    },
    grantedOperations,
    grantedLevels,
    authorizationForWorkspace: async (workspaceId) => session.authorization.forWorkspace(workspaceId),
    hasCapability: async (workspaceId, capabilityId) => session.authorization.hasCapability(workspaceId, capabilityId),
    sessionInfo: Object.freeze({
      mode: session.mode ?? "unknown",
      contract_version: session.contract_version ?? "unknown",
      runtime_version: session.runtime_version ?? "unknown",
      service_id: session.service?.service_id ?? "unknown",
    }),

    // Reads
    listWorkspaces: async (options) => adapter.listWorkspaces(session, options),
    getWorkspace: async (id) => adapter.getWorkspace(session, id),
    createWorkspace: async (input) => adapter.createWorkspace(session, input),
    listObjects: async (query) => adapter.listObjects(session, query),
    getObject: async (ws, obj) => adapter.getObject(session, ws, obj),
    listEventsSince: async (ws, since) => adapter.listEventsSince(session, ws, since),

    // Writes
    putObject: async (input) => adapter.putObject(session, input),
    deleteObject: async (input) => adapter.deleteObject(session, input),
    putRelation: async (input) => adapter.putRelation(session, input),
    deleteRelation: async (input) => adapter.deleteRelation(session, input),

    // Assets
    listAssets: async (query) => adapter.listAssets(session, query),
    getAsset: async (ws, assetId) => adapter.getAsset(session, ws, assetId),
    putAsset: async (input) => adapter.putAsset(session, input),
    deleteAsset: async (input) => adapter.deleteAsset(session, input),

    // Lifecycle
    softDeleteWorkspace: async (id) => adapter.softDeleteWorkspace(session, id),
    restoreWorkspace: async (id) => adapter.restoreWorkspace(session, id),
    purgePreview: async (input) => adapter.purgePreview(session, input),
    purgeCommit: async (input) => adapter.purgeCommit(session, input),
    purgeCancel: async (token) => adapter.purgeCancel(session, token),

    // Exchange
    exportPreview: async (options) => adapter.exportPreview(session, options),
    exportPackage: async (options) => adapter.exportPackage(session, options),
    confirmExport: async (input) => adapter.confirmExport(session, input),
    importPreview: async (bytes) => adapter.importPreview(session, bytes),
    importCommit: async (input) => adapter.importCommit(session, input),
    importCancel: async (token) => adapter.importCancel(session, token),
  };
  if (!input.signedKernelAccess) return Object.freeze(facade);

  const requireLiveHost = (): void => {
    if (input.isHostActive?.() === false)
      throw Object.assign(new Error("T3_HOST_DISPOSED"), { code: "T3_HOST_DISPOSED" });
  };
  // This remains the original complete T2 facade. A selected subject may
  // invoke it only after the original signed Access owner authorizes that
  // method. We do not create a Kernel, Store, authority or extra grant here.
  const inherited = Object.freeze({ ...facade });
  const instances = new WeakMap<object, ReturnType<typeof createSubjectKernelBinding>>();
  const deny = (code: string): never => {
    throw Object.assign(new Error(code), { code });
  };
  const source = input.signedKernelAccess;
  const owner = async (operation: string): Promise<T3SignedActivityAccess> => {
    requireLiveHost();
    const current = typeof source === "function" ? await source(operation) : source;
    requireLiveHost();
    if (!current) return deny("T3_D1_ACCESS_OWNER_REQUIRED");
    if (typeof current.currentContext !== "function")
      return deny("T3_D1_ACCESS_OWNER_REQUIRED");
    return current;
  };
  const signed = async (operation: string) => {
    const access = await owner(operation);
    let bound = instances.get(access);
    if (!bound) {
      bound = createSubjectKernelBinding({ kernel: inherited, access });
      instances.set(access, bound);
    }
    const initial = JSON.stringify(await access.currentContext());
    return { bound, initial };
  };
  const revalidate = async (initial: string, operation: string) => {
    requireLiveHost();
    const current = await owner(operation);
    if (JSON.stringify(await current.currentContext()) !== initial)
      deny("T3_SUBJECT_RESULT_STALE_AFTER_KERNEL");
    requireLiveHost();
  };
  const guarded = facade as unknown as Record<string, unknown>;
  const original = inherited as unknown as Record<string, unknown>;
  const subjectMethods = [
    "createWorkspace","getWorkspace","getObject","listObjects",
    "putObject","deleteObject","putRelation","deleteRelation",
    "listAssets","getAsset","putAsset","deleteAsset","listEventsSince",
    "softDeleteWorkspace","restoreWorkspace",
    "exportPreview","exportPackage","confirmExport",
    "importPreview","importCommit","importCancel",
    "purgePreview","purgeCommit","purgeCancel",
    ...(atomicAvailable ? ["commitObjectGraph"] : []),
  ];
  for (const method of subjectMethods) {
    guarded[method] = async (...args: unknown[]) => {
      const { bound, initial } = await signed(method);
      const delegate = (bound as unknown as Record<string, (...args: unknown[]) =>
        Promise<unknown>>)[method];
      if (typeof delegate !== "function") deny("T3_SUBJECT_OPERATION_UNAVAILABLE");
      const result = await delegate(...args);
      await revalidate(initial, method);
      return result; // the original T2 receipt, not a second result model
    };
  }
  // Non-subject T2 enumeration cannot expose another organization's
  // workspaces. Filter by the one signed selected workspace instead.
  guarded.listWorkspaces = async (options?: { include_deleted?: boolean }) => {
    const { bound, initial } = await signed("getWorkspace");
    const active = await owner("getWorkspace");
    const selectedContext = await active.currentContext() as { workspace_id?: unknown } | null;
    const workspaceId = selectedContext?.workspace_id;
    if (typeof workspaceId !== "string") return deny("T3_SUBJECT_CONTEXT_UNAVAILABLE");
    const row = await bound.getWorkspace(workspaceId);
    await revalidate(initial, "getWorkspace");
    return row && (options?.include_deleted === true || !row.deleted_at) ? [row] : [];
  };
  for (const method of ["authorizationForWorkspace","hasCapability"] as const) {
    guarded[method] = async (workspaceId: string, capabilityId?: string) => {
      const { bound, initial } = await signed("getWorkspace");
      // GetWorkspace performs the original signed JIT and selected-resource
      // check before the underlying T2 authorization/capability query.
      await bound.getWorkspace(workspaceId);
      const delegate = original[method] as (...args: string[]) => Promise<unknown>;
      const result = method === "hasCapability"
        ? await delegate(workspaceId, capabilityId as string)
        : await delegate(workspaceId);
      await revalidate(initial, "getWorkspace");
      return result;
    };
  }
  return Object.freeze(facade);
}
