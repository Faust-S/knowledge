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
import type { KernelSession, OriginalObjectWindowQuery } from "@/kernel-client/types";
import { adapter } from "@/kernel-client/adapter";
import { createSubjectKernelBinding } from "@/t3/index.mjs";
import type { T3SignedActivityAccess } from "@/t3/index.mjs";
import type { Level } from "@/kernel-client/contracts/runtime-1.3.0";
import {companyExchangeServiceId,COMPANY_PACKAGE_OPERATIONS} from "@/t3/company-exchange-profile.mjs";
import type { OriginalMutationRoute } from "@/t3/original-local-source-mutation-route.mjs";

import { negotiateAtomicGraph } from "@/kernel-client/contracts/runtime-1.3.0/atomic-graph-negotiation";
export interface KernelFacadeInput {
  session: KernelSession;
  /** Trusted Host-only signed owner, never a module, package, or UI field.
   * The provider resolves the current PERSONAL/CORP authority per operation. */
  signedKernelAccess?: T3SignedActivityAccess |
    ((operation: string) => T3SignedActivityAccess | null | Promise<T3SignedActivityAccess | null>);
  /** The original Host lifecycle, not a second authorization registry. */
  isHostActive?: () => boolean;
  /** Private original Workspace-scope session in the trusted realm only.
   * Never passed across MessagePort or used for native T1 graph operations. */
  trustedCompanyExchangeSession?: KernelSession;
  /** Optional original Host-only source capture, AFTER the signed D1 JIT. */
  routeOriginalMutation?: OriginalMutationRoute;
}

export function createKernelFacade(input: KernelFacadeInput): KernelFacade {
  const { session } = input;
  const exchangeServiceId=companyExchangeServiceId(session.service?.service_id);
  const corporateBusinessExchange=exchangeServiceId!==null&&!!input.signedKernelAccess;
  const privateExchange=input.trustedCompanyExchangeSession;
  if(privateExchange&&(!corporateBusinessExchange||
      privateExchange.service?.service_id!==exchangeServiceId||
      privateExchange.contract_version!==session.contract_version||
      privateExchange.runtime_version!==session.runtime_version||
      !COMPANY_PACKAGE_OPERATIONS.every(op=>privateExchange.granted_operations?.includes(op as OperationId))))
    throw Object.assign(new Error("T3_COMPANY_EXCHANGE_PRIVATE_SESSION_INVALID"),{code:"T3_COMPANY_EXCHANGE_PRIVATE_SESSION_INVALID"});
  const exchangeSession=privateExchange??session;
  const atomicAvailable = negotiateAtomicGraph(session).available;
  const commitWindowAvailable = session.contract_version === "1.3.0" &&
    session.granted_operations?.includes("t1.listEventsSince") === true &&
    session.granted_operations?.includes("t1.listEventCommitWindow") === true &&
    typeof session.t1?.listEventsSince === "function" &&
    typeof session.t1?.listEventCommitWindow === "function";
  const objectCommitWindowAvailable = session.contract_version === "1.3.0" &&
    session.granted_operations?.includes("t1.listEventsSince") === true &&
    session.granted_operations?.includes("t1.listEventObjectCommitWindow") === true &&
    typeof session.t1?.listEventsSince === "function" &&
    typeof session.t1?.listEventObjectCommitWindow === "function";
  const objectWindowAvailable = session.contract_version === "1.3.0" &&
    session.granted_operations?.includes("t1.listObjects") === true &&
    session.granted_operations?.includes("t1.listObjectWindow") === true &&
    typeof session.t1?.listObjects === "function" && typeof session.t1?.listObjectWindow === "function";
  const grantedOperations = Object.freeze(
    [...(session.granted_operations ?? [])].filter(op =>
      (op !== "t1.commitObjectGraph" || atomicAvailable) &&
      (op !== "t1.listEventCommitWindow" || commitWindowAvailable) &&
      (op !== "t1.listEventObjectCommitWindow" || objectCommitWindowAvailable) &&
      (op !== "t1.listObjectWindow" || objectWindowAvailable) &&
      (!corporateBusinessExchange||!COMPANY_PACKAGE_OPERATIONS.includes(op)||!!privateExchange)),
  ) as readonly OperationId[];
  const grantedLevels = Object.freeze(
    [...(session.granted_levels ?? [])],
  ) as readonly Level[];
  const grantedOpSet = new Set<string>(grantedOperations as readonly string[]);

  const facade: KernelFacade = {
    ...(atomicAvailable ? { commitObjectGraph: async (value: import("@/kernel-client/contracts/runtime-1.3.0").CommitObjectGraphInput) => adapter.commitObjectGraph(session, value) } : {}),
    ...(commitWindowAvailable ? {
      listEventCommitWindow: async (ws: string, after: string | null, limit: number) =>
        adapter.listEventCommitWindow(session,ws,after,limit),
    } : {}),
    ...(objectCommitWindowAvailable ? {
      listEventObjectCommitWindow: async (ws: string, objectId: string, after: string | null, limit: number) =>
        adapter.listEventObjectCommitWindow(session,ws,objectId,after,limit),
    } : {}),
    ...(objectWindowAvailable ? {
      listObjectWindow: async (query: OriginalObjectWindowQuery) => adapter.listObjectWindow(session,query),
    } : {}),
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
    exportPreview: async (options) => adapter.exportPreview(exchangeSession, options),
    exportPackage: async (options) => adapter.exportPackage(exchangeSession, options),
    confirmExport: async (input) => adapter.confirmExport(exchangeSession, input),
    importPreview: async (bytes) => adapter.importPreview(exchangeSession, bytes),
    importCommit: async (input) => adapter.importCommit(exchangeSession, input),
    importCancel: async (token) => adapter.importCancel(exchangeSession, token),
  };
  if (!input.signedKernelAccess) {
    if (input.routeOriginalMutation) throw Object.assign(new Error("T3_D1_ACCESS_OWNER_REQUIRED"), {code:"T3_D1_ACCESS_OWNER_REQUIRED"});
    return Object.freeze(facade);
  }

  const requireLiveHost = (): void => {
    if (input.isHostActive?.() === false)
      throw Object.assign(new Error("T3_HOST_DISPOSED"), { code: "T3_HOST_DISPOSED" });
  };
  // This remains the original complete T2 facade. A selected subject may
  // invoke it only after the original signed Access owner authorizes that
  // method. We do not create a Kernel, Store, authority or extra grant here.
  // Keep the ORIGINAL T2 adapter as the only execution backend. Sign-out can
  // happen while a signed Access JIT request is pending; guard the *last hop*
  // into the adapter as well as the call entry / returned receipt.
  const original = Object.freeze({ ...facade }) as Record<string, unknown>;
  const inherited = { ...facade } as Record<string, unknown>;
  const instances = new WeakMap<object, ReturnType<typeof createSubjectKernelBinding>>();
  // Control returns fresh method-specific signed ports. Original preview
  // handles survive across them only within this live KernelFacade.
  const previewSession=Object.freeze({});
  // Exact installed service identity from the original negotiated T2
  // session, never a UI-provided operation or imported manifest.
  // Private Workspace passport grants never appear in the product facade.
  // Without the trusted connection, corporate T2 operations are unavailable.
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
      bound = createSubjectKernelBinding({
        kernel: inherited as unknown as KernelFacade, access,previewSession,
        corporateBusinessExchange,
        isHostActive:()=>input.isHostActive?.()!==false,
      });
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
  const subjectMethods = [
    "createWorkspace","getWorkspace","getObject","listObjects",
    "putObject","deleteObject","putRelation","deleteRelation",
    "listAssets","getAsset","putAsset","deleteAsset","listEventsSince",
    "softDeleteWorkspace","restoreWorkspace",
    "exportPreview","exportPackage","confirmExport",
    "importPreview","importCommit","importCancel",
    "purgePreview","purgeCommit","purgeCancel",
    ...(atomicAvailable ? ["commitObjectGraph"] : []),
    ...(commitWindowAvailable ? ["listEventCommitWindow"] : []),
    ...(objectCommitWindowAvailable ? ["listEventObjectCommitWindow"] : []),
    ...(objectWindowAvailable ? ["listObjectWindow"] : []),
  ];
  const routeOriginalMutation = input.routeOriginalMutation;
  const mutationMethods = new Set(["createWorkspace","putObject","deleteObject","putRelation","deleteRelation",
    "putAsset","deleteAsset","commitObjectGraph","softDeleteWorkspace","restoreWorkspace",
    "purgeCommit","importCommit","confirmExport"]);
  for (const method of subjectMethods) {
    const invokeT2 = original[method] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof invokeT2 === "function") {
      inherited[method] = (...args: unknown[]) => {
        requireLiveHost(); // The final hop, AFTER asynchronous signed JIT.
        if (routeOriginalMutation && mutationMethods.has(method)) {
          const exact=structuredClone(args);
          return routeOriginalMutation(method,structuredClone(exact)).then(result=>{
            requireLiveHost();
            if(result?.kind==="CAPTURED")return result.originalReceipt;
            if(result?.kind!=="LOCAL_T3")return deny("T3_LOCAL_SOURCE_CAPTURE_RECEIPT_INVALID");
            return invokeT2(...exact);
          });
        }
        return invokeT2(...args);
      };
    }
  }
  Object.freeze(inherited);
  for (const method of subjectMethods) {
    guarded[method] = async (...args: unknown[]) => {
      const { bound, initial } = await signed(method);
      const delegate = (bound as unknown as Record<string, (...args: unknown[]) =>
        Promise<unknown>>)[method];
      if (typeof delegate !== "function") deny("T3_SUBJECT_OPERATION_UNAVAILABLE");
      requireLiveHost();
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
      requireLiveHost(); // Signed read may complete after logout.
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
