/**
 * Capability model — per-operation predicates mirror granted_operations.
 * `session.mode` is NEVER consulted to decide whether an op is allowed.
 */
import { describe, expect, it } from "vitest";
import { capabilities } from "../src/kernel-client/capabilities";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { ALL_OPERATIONS } from "../src/kernel-client/contracts/runtime-1.3.0";
import type { KernelSession, ConnectMode } from "../src/kernel-client";

function withOps(ops: readonly string[], mode: ConnectMode = "full"): KernelSession {
  return createDevMockClient({ mode, grantedOperations: [...ops] });
}

const OP_TO_FLAG: Record<string, keyof ReturnType<typeof capabilities>> = {
  "t1.listWorkspaces": "canListWorkspaces",
  "t1.getWorkspace": "canGetWorkspace",
  "t1.createWorkspace": "canCreateWorkspace",
  "t1.commitObjectGraph": "canCommitObjectGraph",
  "t1.listObjects": "canListObjects",
  "t1.getObject": "canGetObject",
  "t1.putObject": "canPutObject",
  "t1.deleteObject": "canDeleteObject",
  "t1.putRelation": "canPutRelation",
  "t1.deleteRelation": "canDeleteRelation",
  "t1.listAssets": "canListAssets",
  "t1.getAsset": "canGetAsset",
  "t1.putAsset": "canPutAsset",
  "t1.deleteAsset": "canDeleteAsset",
  "t1.listEventsSince": "canListEvents",
  "t1.softDeleteWorkspace": "canSoftDeleteWorkspace",
  "t1.restoreWorkspace": "canRestoreWorkspace",
  "t1.purgePreview": "canPurgePreview",
  "t1.purgeCommit": "canPurgeCommit",
  "t1.purgeCancel": "canPurgeCancel",
  "t2.exportPreview": "canExportPreview",
  "t2.exportPackage": "canExportPackage",
  "t2.confirmExport": "canConfirmExport",
  "t2.importPreview": "canImportPreview",
  "t2.importCommit": "canImportCommit",
  "t2.importCancel": "canImportCancel",
};

describe("per-operation capability predicates", () => {
  for (const [op, flag] of Object.entries(OP_TO_FLAG)) {
    it(`${op} flips exactly ${flag}`, () => {
      const yes = capabilities(withOps([op]));
      expect(yes[flag]).toBe(true);
      const no = capabilities(withOps([]));
      expect(no[flag]).toBe(false);
    });
  }

  it("every op in ALL_OPERATIONS (except t0.validate) has a predicate", () => {
    const covered = new Set(Object.keys(OP_TO_FLAG));
    for (const op of ALL_OPERATIONS) {
      if (op === "t0.validate") continue;
      expect(covered.has(op)).toBe(true);
    }
  });
});

describe("composite predicates are strict derivations", () => {
  it("canImportFlow requires preview + commit + cancel", () => {
    expect(capabilities(withOps(["t2.importPreview", "t2.importCommit"])).canImportFlow).toBe(false);
    expect(capabilities(withOps([
      "t2.importPreview", "t2.importCommit", "t2.importCancel",
    ])).canImportFlow).toBe(true);
  });
  it("canExportFlow requires preview + package + confirmation", () => {
    expect(capabilities(withOps(["t2.exportPreview", "t2.exportPackage"])).canExportFlow).toBe(false);
    expect(capabilities(withOps([
      "t2.exportPreview", "t2.exportPackage", "t2.confirmExport",
    ])).canExportFlow).toBe(true);
  });
  it("canPurgeFlow requires preview + commit + cancel", () => {
    expect(capabilities(withOps(["t1.purgePreview", "t1.purgeCommit"])).canPurgeFlow).toBe(false);
    expect(capabilities(withOps([
      "t1.purgePreview", "t1.purgeCommit", "t1.purgeCancel",
    ])).canPurgeFlow).toBe(true);
  });
});

describe("session.mode does NOT decide permissions", () => {
  it("mode=ready-equivalent (full) without an op still denies that op", () => {
    const s = withOps([], "full");
    expect(capabilities(s).canPutObject).toBe(false);
    expect(capabilities(s).canRestoreWorkspace).toBe(false);
  });
  it("mode=limited with an explicit op grants that op", () => {
    const s = withOps(["t1.restoreWorkspace"], "limited");
    expect(capabilities(s).canRestoreWorkspace).toBe(true);
  });
});
