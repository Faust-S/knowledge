/**
 * Capability predicates — Runtime Contract 1.3.0.
 *
 * The single source of truth for every gate is `session.granted_operations`.
 * `session.mode` is NEVER used here as a permission signal; it is only
 * a diagnostic channel for connection status elsewhere in the shell.
 *
 * Every canonical `granted_operations` string has its OWN boolean.
 * Composite flags (`canImportFlow`, `canExportFlow`, `canPurgeFlow`)
 * are strictly derived — never a substitute for the per-op checks the
 * adapter enforces.
 */
import type { KernelSession } from "./types";

export interface Capabilities {
  // ---- Level presence (from granted_levels) --------------------------------
  hasT1: boolean;
  hasT2: boolean;

  // ---- Per-operation predicates (mirror ALL_OPERATIONS 1:1) ---------------
  // T1 reads
  canListWorkspaces: boolean;      // t1.listWorkspaces
  canGetWorkspace: boolean;        // t1.getWorkspace
  canListObjects: boolean;         // t1.listObjects
  canGetObject: boolean;           // t1.getObject
  canListEvents: boolean;          // t1.listEventsSince
  // T1 writes
  canCreateWorkspace: boolean;     // t1.createWorkspace
  canCommitObjectGraph: boolean; // t1.commitObjectGraph
  canPutObject: boolean;           // t1.putObject
  canDeleteObject: boolean;        // t1.deleteObject
  canPutRelation: boolean;        // t1.putRelation
  canDeleteRelation: boolean;     // t1.deleteRelation
  canListAssets: boolean;         // t1.listAssets
  canGetAsset: boolean;           // t1.getAsset
  canPutAsset: boolean;           // t1.putAsset
  canDeleteAsset: boolean;        // t1.deleteAsset
  // T1 lifecycle
  canSoftDeleteWorkspace: boolean; // t1.softDeleteWorkspace
  canRestoreWorkspace: boolean;    // t1.restoreWorkspace
  canPurgePreview: boolean;        // t1.purgePreview
  canPurgeCommit: boolean;         // t1.purgeCommit
  canPurgeCancel: boolean;         // t1.purgeCancel
  // T2 export / import
  canExportPreview: boolean;       // t2.exportPreview
  canExportPackage: boolean;       // t2.exportPackage
  canConfirmExport: boolean;       // t2.confirmExport
  canImportPreview: boolean;       // t2.importPreview
  canImportCommit: boolean;        // t2.importCommit
  canImportCancel: boolean;        // t2.importCancel

  // ---- Composite predicates (derived only) --------------------------------
  /** Full import round-trip: preview + commit + cancel. */
  canImportFlow: boolean;
  /** Full export round-trip: preview + package + confirmation. */
  canExportFlow: boolean;
  /** Full purge round-trip: preview + commit + cancel. */
  canPurgeFlow: boolean;

  // ---- Aggregate / legacy convenience aliases -----------------------------
  /** Aggregate: any read op present. */
  canRead: boolean;
  /** Aggregate: any T1 write op present. NOT used by adapter for gating. */
  canWrite: boolean;
  /** Legacy alias for `canPutObject` (kept for existing UI props). */
  canWriteObject: boolean;
  /** Legacy alias for `canExportPackage`. */
  canExport: boolean;
  /** Legacy alias for `canImportCommit`. */
  canImport: boolean;
  /** Legacy alias for `canImportCommit`. */
  canImportPackage: boolean;
  /** Legacy alias for `canRestoreWorkspace`. */
  canRestore: boolean;
  /** Legacy alias: purge preview AND commit both granted. */
  canPurge: boolean;

  recoveryContract: "unavailable" | "available";
  handoffContract: "unavailable" | "available";
}

function has(ops: readonly string[], op: string): boolean {
  return ops.includes(op);
}

export function capabilities(session: KernelSession): Capabilities {
  const levels = session.granted_levels ?? [];
  const ops = session.granted_operations ?? [];

  const hasT1 = levels.includes("T1");
  const hasT2 = levels.includes("T2");

  const canListWorkspaces = has(ops, "t1.listWorkspaces");
  const canGetWorkspace   = has(ops, "t1.getWorkspace");
  const canListObjects    = has(ops, "t1.listObjects");
  const canGetObject      = has(ops, "t1.getObject");
  const canListEvents     = has(ops, "t1.listEventsSince");

  const canCreateWorkspace = has(ops, "t1.createWorkspace");
  const canCommitObjectGraph = has(ops, "t1.commitObjectGraph");
  const canPutObject       = has(ops, "t1.putObject");
  const canDeleteObject    = has(ops, "t1.deleteObject");
  const canPutRelation     = has(ops, "t1.putRelation");
  const canDeleteRelation  = has(ops, "t1.deleteRelation");
  const canListAssets      = has(ops, "t1.listAssets");
  const canGetAsset        = has(ops, "t1.getAsset");
  const canPutAsset        = has(ops, "t1.putAsset");
  const canDeleteAsset     = has(ops, "t1.deleteAsset");

  const canSoftDeleteWorkspace = has(ops, "t1.softDeleteWorkspace");
  const canRestoreWorkspace    = has(ops, "t1.restoreWorkspace");
  const canPurgePreview        = has(ops, "t1.purgePreview");
  const canPurgeCommit         = has(ops, "t1.purgeCommit");
  const canPurgeCancel         = has(ops, "t1.purgeCancel");

  const canExportPreview = has(ops, "t2.exportPreview");
  const canExportPackage = has(ops, "t2.exportPackage");
  const canConfirmExport = has(ops, "t2.confirmExport");
  const canImportPreview = has(ops, "t2.importPreview");
  const canImportCommit  = has(ops, "t2.importCommit");
  const canImportCancel  = has(ops, "t2.importCancel");

  const canImportFlow = canImportPreview && canImportCommit && canImportCancel;
  const canExportFlow = canExportPreview && canExportPackage && canConfirmExport;
  const canPurgeFlow  = canPurgePreview && canPurgeCommit && canPurgeCancel;

  const canRestore = canRestoreWorkspace;
  const canPurge   = canPurgePreview && canPurgeCommit;
  const recoveryContract: Capabilities["recoveryContract"] =
    canRestore || canPurge ? "available" : "unavailable";

  // Handoff (T3) — not part of Baseline 1.2. Always unavailable.
  const handoffContract: Capabilities["handoffContract"] = "unavailable";

  return {
    hasT1,
    hasT2,

    canListWorkspaces,
    canGetWorkspace,
    canListObjects,
    canGetObject,
    canListEvents,
    canCreateWorkspace,
    canCommitObjectGraph,
    canPutObject,
    canDeleteObject,
    canPutRelation,
    canDeleteRelation,
    canListAssets,
    canGetAsset,
    canPutAsset,
    canDeleteAsset,
    canSoftDeleteWorkspace,
    canRestoreWorkspace,
    canPurgePreview,
    canPurgeCommit,
    canPurgeCancel,
    canExportPreview,
    canExportPackage,
    canConfirmExport,
    canImportPreview,
    canImportCommit,
    canImportCancel,

    canImportFlow,
    canExportFlow,
    canPurgeFlow,

    canRead: canListWorkspaces || canGetWorkspace || canListObjects || canGetObject || canListAssets || canGetAsset,
    canWrite: canCreateWorkspace || canCommitObjectGraph || canPutObject || canDeleteObject || canPutRelation || canDeleteRelation || canPutAsset || canDeleteAsset,
    canWriteObject: canPutObject,
    canExport: canExportPackage,
    canImport: canImportCommit,
    canImportPackage: canImportCommit,
    canRestore,
    canPurge,

    recoveryContract,
    handoffContract,
  };
}
