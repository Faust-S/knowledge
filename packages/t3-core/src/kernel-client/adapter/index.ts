/**
 * Visual-layer adapter over the real IWXAClient (Runtime 1.3).
 *
 * Rules (enforced by scripts/static-check.mjs):
 *   - Stateless: no caches, no IndexedDB, no browser storage.
 *   - No transformation of arguments or results — pure pass-through.
 *   - No fallback: adapter never substitutes a synthetic runtime.
 *   - No aggregate `canWrite` gate: every method checks its OWN
 *     `granted_operations` string via `requireOperation`.
 *   - `session.mode` is NEVER consulted for permission decisions.
 *   - Adapter does NOT assemble `.iwxa` bytes, compute digests, or
 *     retransmit package bytes into commit calls.
 */

import type { KernelSession } from "../types";
import type {
  ConfirmExportInput,
  ConfirmExportReceipt,
  RelationDeleteResult,
  RelationCommitResult,
  PutRelationInput,
  PutAssetInput,
  ListAssetsQuery,
  DeleteRelationInput,
  DeleteAssetInput,
  AssetWithBytes,
  AssetRecord,
  AssetDeleteResult,
  AssetCommitResult,
  CreateWorkspaceInput,
  DeleteObjectInput,
  EventRecord,
  ExportOptions,
  ExportPreview,
  ImportReceipt,
  ListObjectsQuery,
  ListWorkspacesOptions,
  ObjectRecord,
  ObjectWithRelations,
  PackageArtifact,
  PurgeCommitInput,
  PurgePreview,
  PurgePreviewInput,
  PurgeReceipt,
  PutObjectInput,
  RestoreWorkspaceReceipt,
  SecureCommitInput,
  SecureImportPreview,
  SoftDeleteWorkspaceReceipt,
  CommitResult,
  WorkspaceRecord,
} from "../contracts/runtime-1.3.0";
import { requireOperation } from "./require-operation";

import type { CommitObjectGraphInput, CommitObjectGraphReceipt } from "../contracts/runtime-1.3.0";
import { AtomicGraphUnavailableError } from "../contracts/runtime-1.3.0/atomic-graph-negotiation";
export const adapter = {
  commitObjectGraph(session: KernelSession, input: CommitObjectGraphInput): Promise<CommitObjectGraphReceipt> {
    if (session.contract_version !== "1.3.0") throw new AtomicGraphUnavailableError("CONTRACT_VERSION_MISMATCH");
    requireOperation(session, "t1.commitObjectGraph", session.t1?.commitObjectGraph);
    return session.t1.commitObjectGraph!(input);
  },
  // ---- T1 reads -----------------------------------------------------------
  listWorkspaces(
    session: KernelSession,
    options?: ListWorkspacesOptions,
  ): Promise<WorkspaceRecord[]> {
    requireOperation(session, "t1.listWorkspaces", session.t1?.listWorkspaces);
    return session.t1.listWorkspaces(options);
  },
  getWorkspace(
    session: KernelSession,
    workspaceId: string,
  ): Promise<WorkspaceRecord | null> {
    requireOperation(session, "t1.getWorkspace", session.t1?.getWorkspace);
    return session.t1.getWorkspace(workspaceId);
  },
  listObjects(
    session: KernelSession,
    query: ListObjectsQuery,
  ): Promise<ObjectRecord[]> {
    requireOperation(session, "t1.listObjects", session.t1?.listObjects);
    return session.t1.listObjects(query);
  },
  getObject(
    session: KernelSession,
    workspaceId: string,
    objectId: string,
  ): Promise<ObjectWithRelations | null> {
    requireOperation(session, "t1.getObject", session.t1?.getObject);
    return session.t1.getObject(workspaceId, objectId);
  },
  listEventsSince(
    session: KernelSession,
    workspaceId: string,
    since?: string,
  ): Promise<EventRecord[]> {
    requireOperation(
      session,
      "t1.listEventsSince",
      session.t1?.listEventsSince,
    );
    return session.t1.listEventsSince(workspaceId, since);
  },

  // ---- T1 writes ----------------------------------------------------------
  createWorkspace(
    session: KernelSession,
    input: CreateWorkspaceInput,
  ): Promise<WorkspaceRecord> {
    requireOperation(
      session,
      "t1.createWorkspace",
      session.t1?.createWorkspace,
    );
    return session.t1.createWorkspace(input);
  },
  putObject(
    session: KernelSession,
    input: PutObjectInput,
  ): Promise<CommitResult> {
    requireOperation(session, "t1.putObject", session.t1?.putObject);
    return session.t1.putObject(input);
  },
  deleteObject(
    session: KernelSession,
    input: DeleteObjectInput,
  ): Promise<CommitResult> {
    requireOperation(session, "t1.deleteObject", session.t1?.deleteObject);
    return session.t1.deleteObject(input);
  },

  putRelation(
    session: KernelSession,
    input: PutRelationInput,
  ): Promise<RelationCommitResult> {
    requireOperation(session, "t1.putRelation", session.t1?.putRelation);
    return session.t1.putRelation(input);
  },
  deleteRelation(
    session: KernelSession,
    input: DeleteRelationInput,
  ): Promise<RelationDeleteResult> {
    requireOperation(session, "t1.deleteRelation", session.t1?.deleteRelation);
    return session.t1.deleteRelation(input);
  },
  listAssets(
    session: KernelSession,
    query: ListAssetsQuery,
  ): Promise<AssetRecord[]> {
    requireOperation(session, "t1.listAssets", session.t1?.listAssets);
    return session.t1.listAssets(query);
  },
  getAsset(
    session: KernelSession,
    workspaceId: string,
    assetId: string,
  ): Promise<AssetWithBytes | null> {
    requireOperation(session, "t1.getAsset", session.t1?.getAsset);
    return session.t1.getAsset(workspaceId, assetId);
  },
  putAsset(
    session: KernelSession,
    input: PutAssetInput,
  ): Promise<AssetCommitResult> {
    requireOperation(session, "t1.putAsset", session.t1?.putAsset);
    return session.t1.putAsset(input);
  },
  deleteAsset(
    session: KernelSession,
    input: DeleteAssetInput,
  ): Promise<AssetDeleteResult> {
    requireOperation(session, "t1.deleteAsset", session.t1?.deleteAsset);
    return session.t1.deleteAsset(input);
  },

  // ---- T1 lifecycle -------------------------------------------------------
  softDeleteWorkspace(
    session: KernelSession,
    workspaceId: string,
  ): Promise<SoftDeleteWorkspaceReceipt> {
    requireOperation(
      session,
      "t1.softDeleteWorkspace",
      session.t1?.softDeleteWorkspace,
    );
    return session.t1.softDeleteWorkspace(workspaceId);
  },
  restoreWorkspace(
    session: KernelSession,
    workspaceId: string,
  ): Promise<RestoreWorkspaceReceipt> {
    requireOperation(
      session,
      "t1.restoreWorkspace",
      session.t1?.restoreWorkspace,
    );
    return session.t1.restoreWorkspace(workspaceId);
  },
  purgePreview(
    session: KernelSession,
    input: PurgePreviewInput,
  ): Promise<PurgePreview> {
    requireOperation(session, "t1.purgePreview", session.t1?.purgePreview);
    return session.t1.purgePreview(input);
  },
  purgeCommit(
    session: KernelSession,
    input: PurgeCommitInput,
  ): Promise<PurgeReceipt> {
    requireOperation(session, "t1.purgeCommit", session.t1?.purgeCommit);
    return session.t1.purgeCommit(input);
  },
  purgeCancel(
    session: KernelSession,
    purgeToken: string,
  ): Promise<boolean> {
    requireOperation(session, "t1.purgeCancel", session.t1?.purgeCancel);
    return session.t1.purgeCancel(purgeToken);
  },

  // ---- T2 packages --------------------------------------------------------
  exportPreview(
    session: KernelSession,
    options: ExportOptions,
  ): Promise<ExportPreview> {
    requireOperation(session, "t2.exportPreview", session.t2?.exportPreview);
    return session.t2.exportPreview(options);
  },
  exportPackage(
    session: KernelSession,
    options: ExportOptions,
  ): Promise<PackageArtifact> {
    requireOperation(session, "t2.exportPackage", session.t2?.exportPackage);
    return session.t2.exportPackage(options);
  },
  confirmExport(
    session: KernelSession,
    input: ConfirmExportInput,
  ): Promise<ConfirmExportReceipt> {
    requireOperation(session, "t2.confirmExport", session.t2?.confirmExport);
    return session.t2.confirmExport(input);
  },
  importPreview(
    session: KernelSession,
    bytes: Uint8Array,
  ): Promise<SecureImportPreview> {
    requireOperation(session, "t2.importPreview", session.t2?.importPreview);
    return session.t2.importPreview(bytes);
  },
  importCommit(
    session: KernelSession,
    input: SecureCommitInput,
  ): Promise<ImportReceipt> {
    requireOperation(session, "t2.importCommit", session.t2?.importCommit);
    return session.t2.importCommit(input);
  },
  importCancel(
    session: KernelSession,
    previewToken: string,
  ): Promise<boolean> {
    requireOperation(session, "t2.importCancel", session.t2?.importCancel);
    return session.t2.importCancel(previewToken);
  },
};

export type WorkspaceAdapter = typeof adapter;
export {
  OperationNotGrantedError,
  RuntimeSurfaceIncompatibleError,
  requireOperation,
} from "./require-operation";
