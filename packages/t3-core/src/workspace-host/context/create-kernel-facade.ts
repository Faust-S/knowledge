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
import type { Level } from "@/kernel-client/contracts/runtime-1.3.0";

import { negotiateAtomicGraph } from "@/kernel-client/contracts/runtime-1.3.0/atomic-graph-negotiation";
import {
  createSubjectScopedModuleKernelFacade,
  type SubjectAccessHostOwner,
} from "../../t3/subject-kernel-module-facade.mjs";
export interface KernelFacadeInput {
  session: KernelSession;
  /** Trusted Host-only T3 D1 owner: never supplied by a module or a package. */
  subjectAccess?: SubjectAccessHostOwner;
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
  const inherited = Object.freeze(facade);
  // T3 is the direct T2 successor: protect the very same inherited facade
  // at the Host injection point. Legacy/unprovisioned T2 products are unchanged.
  return input.subjectAccess
    ? createSubjectScopedModuleKernelFacade({ kernel: inherited, access: input.subjectAccess })
    : inherited;
}
