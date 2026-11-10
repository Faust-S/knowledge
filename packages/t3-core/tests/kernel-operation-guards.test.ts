/**
 * Adapter operation guards.
 *
 * - Missing granted_operation blocks the call regardless of session.mode.
 * - Granted operation with a missing runtime method throws an
 *   incompatible-surface error, not a silent success.
 * - Lifecycle & confirmExport are gated independently from their pairs.
 * - Mock surface exposes every operation in ALL_OPERATIONS.
 */
import { describe, expect, it, vi } from "vitest";
import { adapter } from "../src/kernel-client/adapter";
import {
  OperationNotGrantedError,
  RuntimeSurfaceIncompatibleError,
  requireOperation,
} from "../src/kernel-client/adapter/require-operation";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import type { KernelSession } from "../src/kernel-client";
import { ALL_OPERATIONS } from "../src/kernel-client/contracts/v1";

function baseSession(overrides: Partial<KernelSession> = {}): KernelSession {
  return createDevMockClient({ mode: "full", ...overrides });
}

describe("requireOperation guard — three deterministic outcomes", () => {
  const session = baseSession();

  it("throws OperationNotGrantedError when op is absent", () => {
    const s: KernelSession = { ...session, granted_operations: [] };
    expect(() => requireOperation(s, "t1.putObject", s.t1.putObject))
      .toThrow(OperationNotGrantedError);
  });

  it("throws RuntimeSurfaceIncompatibleError when op is granted but method is missing", () => {
    const s: KernelSession = {
      ...session,
      granted_operations: ["t1.putObject"],
      t1: { ...session.t1, putObject: undefined as unknown as typeof session.t1.putObject },
    };
    expect(() => requireOperation(s, "t1.putObject", s.t1.putObject))
      .toThrow(RuntimeSurfaceIncompatibleError);
  });

  it("returns void when both are present", () => {
    expect(() => requireOperation(session, "t1.putObject", session.t1.putObject))
      .not.toThrow();
  });
});

describe("adapter guards each op independently", () => {
  it("session.mode=full without a specific op still blocks it", () => {
    const s = createDevMockClient({ mode: "full", grantedOperations: [] });
    expect(() => adapter.restoreWorkspace(s, "w"))
      .toThrow(/t1\.restoreWorkspace/);
    expect(() => adapter.confirmExport(s, { package_digest: "d" }))
      .toThrow(/t2\.confirmExport/);
  });

  it("session.mode=limited does NOT block an explicitly granted op", async () => {
    const s = createDevMockClient({
      mode: "limited",
      grantedOperations: ["t1.listWorkspaces"],
    });
    await expect(adapter.listWorkspaces(s)).resolves.toBeDefined();
  });

  it("confirmExport is gated separately from exportPackage", () => {
    const s = createDevMockClient({
      mode: "full",
      grantedOperations: ["t2.exportPackage"],
    });
    expect(() => adapter.confirmExport(s, { package_digest: "d" }))
      .toThrow(/t2\.confirmExport/);
  });

  it("restoreWorkspace is gated separately from softDeleteWorkspace", () => {
    const s = createDevMockClient({
      mode: "full",
      grantedOperations: ["t1.softDeleteWorkspace"],
    });
    expect(() => adapter.restoreWorkspace(s, "w"))
      .toThrow(/t1\.restoreWorkspace/);
  });

  it("purge ops are each gated individually", () => {
    const s = createDevMockClient({
      mode: "full",
      grantedOperations: ["t1.purgePreview"],
    });
    expect(() => adapter.purgeCommit(s, { purge_token: "p", confirmation: "c" }))
      .toThrow(/t1\.purgeCommit/);
    expect(() => adapter.purgeCancel(s, "p")).toThrow(/t1\.purgeCancel/);
  });

  it("import preview / commit / cancel are gated individually", () => {
    const s = createDevMockClient({
      mode: "full",
      grantedOperations: ["t2.importPreview"],
    });
    expect(() => adapter.importCommit(s, {
      preview_token: "t", package_digest: "d", plan: { mode: "full" },
    })).toThrow(/t2\.importCommit/);
    expect(() => adapter.importCancel(s, "t")).toThrow(/t2\.importCancel/);
  });
});

describe("mock surface matches Runtime Contract 1.2.0", () => {
  const s = baseSession();

  it("exposes every ALL_OPERATIONS method on the correct tier", () => {
    for (const op of ALL_OPERATIONS) {
      const [tier, method] = op.split(".");
      const bag = (s as unknown as Record<string, Record<string, unknown>>)[tier];
      expect(typeof bag?.[method]).toBe("function");
    }
  });

  it("full-mode mock grants every ALL_OPERATIONS entry", () => {
    for (const op of ALL_OPERATIONS) {
      expect(s.granted_operations).toContain(op);
    }
  });

  it("purgePreview → purgeCommit round-trip removes the workspace", async () => {
    await s.t1.createWorkspace({ workspace_id: "wp", profile: "demo" });
    const preview = await adapter.purgePreview(s, { workspace_id: "wp" });
    expect(preview.purge_token).toBeTruthy();
    await adapter.purgeCommit(s, {
      purge_token: preview.purge_token,
      confirmation: preview.challenge,
    });
    expect(await s.t1.getWorkspace("wp")).toBeNull();
  });

  it("adapter passes results through unchanged", async () => {
    const spy = vi.spyOn(s.t1, "listWorkspaces");
    const out = await adapter.listWorkspaces(s);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toBe(await spy.mock.results[0].value);
  });
});
