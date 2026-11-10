/**
 * Adapter parity — every method dispatches to the correct Runtime
 * operation with unchanged arguments and returns unchanged results.
 */
import { describe, expect, it, vi } from "vitest";
import { adapter } from "../src/kernel-client/adapter";
import type { KernelSession } from "../src/kernel-client";
import { ALL_OPERATIONS } from "../src/kernel-client/contracts/v1";

function makeSession(
  ops: readonly string[] = ALL_OPERATIONS,
  overrides: Partial<KernelSession> = {},
): KernelSession {
  const t1: Record<string, ReturnType<typeof vi.fn>> = {};
  const t2: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const op of ALL_OPERATIONS) {
    const [tier, method] = op.split(".");
    const spy = vi.fn(async (..._args: unknown[]) => ({ ok: true, op, args: _args }));
    if (tier === "t1") t1[method] = spy;
    else if (tier === "t2") t2[method] = spy;
  }
  return {
    contract_version: "1.2.0",
    runtime_version: "test",
    mode: "full",
    service: { service_id: "svc", base_path: "/", service_version: "0" },
    granted_levels: ["T0", "T1", "T2"],
    granted_operations: [...ops],
    t0: { validate: vi.fn() } as unknown as KernelSession["t0"],
    t1: t1 as unknown as KernelSession["t1"],
    t2: t2 as unknown as KernelSession["t2"],
    ...overrides,
  } as KernelSession;
}

interface Case {
  op: string;
  tier: "t1" | "t2";
  method: string;
  call: (s: KernelSession) => unknown;
  expectArgs: unknown[];
}

const CASES: Case[] = [
  { op: "t1.listWorkspaces", tier: "t1", method: "listWorkspaces",
    call: (s) => adapter.listWorkspaces(s, { include_deleted: true }),
    expectArgs: [{ include_deleted: true }] },
  { op: "t1.getWorkspace", tier: "t1", method: "getWorkspace",
    call: (s) => adapter.getWorkspace(s, "ws"), expectArgs: ["ws"] },
  { op: "t1.createWorkspace", tier: "t1", method: "createWorkspace",
    call: (s) => adapter.createWorkspace(s, { workspace_id: "w", profile: "p" }),
    expectArgs: [{ workspace_id: "w", profile: "p" }] },
  { op: "t1.listObjects", tier: "t1", method: "listObjects",
    call: (s) => adapter.listObjects(s, { workspace_id: "w" }),
    expectArgs: [{ workspace_id: "w" }] },
  { op: "t1.getObject", tier: "t1", method: "getObject",
    call: (s) => adapter.getObject(s, "w", "o"), expectArgs: ["w", "o"] },
  { op: "t1.putObject", tier: "t1", method: "putObject",
    call: (s) => adapter.putObject(s, {
      workspace_id: "w", object_id: "o", schema_id: "s", schema_version: "1.0.0",
      data: {}, event: { event_type: "e" },
    }),
    expectArgs: [{
      workspace_id: "w", object_id: "o", schema_id: "s", schema_version: "1.0.0",
      data: {}, event: { event_type: "e" },
    }] },
  { op: "t1.deleteObject", tier: "t1", method: "deleteObject",
    call: (s) => adapter.deleteObject(s, {
      workspace_id: "w", object_id: "o", event: { event_type: "d" },
    }),
    expectArgs: [{ workspace_id: "w", object_id: "o", event: { event_type: "d" } }] },
  { op: "t1.putRelation", tier: "t1", method: "putRelation",
    call: (s) => adapter.putRelation(s, {
      workspace_id: "w", relation_id: "r", from_object_id: "a", to_object_id: "b", kind: "related", event: { event_type: "relation.put" },
    }),
    expectArgs: [{ workspace_id: "w", relation_id: "r", from_object_id: "a", to_object_id: "b", kind: "related", event: { event_type: "relation.put" } }] },
  { op: "t1.deleteRelation", tier: "t1", method: "deleteRelation",
    call: (s) => adapter.deleteRelation(s, { workspace_id: "w", relation_id: "r", event: { event_type: "relation.delete" } }),
    expectArgs: [{ workspace_id: "w", relation_id: "r", event: { event_type: "relation.delete" } }] },
  { op: "t1.listAssets", tier: "t1", method: "listAssets",
    call: (s) => adapter.listAssets(s, { workspace_id: "w", object_id: "o" }),
    expectArgs: [{ workspace_id: "w", object_id: "o" }] },
  { op: "t1.getAsset", tier: "t1", method: "getAsset",
    call: (s) => adapter.getAsset(s, "w", "asset"), expectArgs: ["w", "asset"] },
  { op: "t1.putAsset", tier: "t1", method: "putAsset",
    call: (s) => adapter.putAsset(s, { workspace_id: "w", asset_id: "asset", object_id: "o", mime: "text/plain", bytes: new Uint8Array([1]), event: { event_type: "asset.put" } }),
    expectArgs: [{ workspace_id: "w", asset_id: "asset", object_id: "o", mime: "text/plain", bytes: new Uint8Array([1]), event: { event_type: "asset.put" } }] },
  { op: "t1.deleteAsset", tier: "t1", method: "deleteAsset",
    call: (s) => adapter.deleteAsset(s, { workspace_id: "w", asset_id: "asset", event: { event_type: "asset.delete" } }),
    expectArgs: [{ workspace_id: "w", asset_id: "asset", event: { event_type: "asset.delete" } }] },
  { op: "t1.listEventsSince", tier: "t1", method: "listEventsSince",
    call: (s) => adapter.listEventsSince(s, "w", "2024-01-01"),
    expectArgs: ["w", "2024-01-01"] },
  { op: "t1.softDeleteWorkspace", tier: "t1", method: "softDeleteWorkspace",
    call: (s) => adapter.softDeleteWorkspace(s, "w"), expectArgs: ["w"] },
  { op: "t1.restoreWorkspace", tier: "t1", method: "restoreWorkspace",
    call: (s) => adapter.restoreWorkspace(s, "w"), expectArgs: ["w"] },
  { op: "t1.purgePreview", tier: "t1", method: "purgePreview",
    call: (s) => adapter.purgePreview(s, { workspace_id: "w" }),
    expectArgs: [{ workspace_id: "w" }] },
  { op: "t1.purgeCommit", tier: "t1", method: "purgeCommit",
    call: (s) => adapter.purgeCommit(s, { purge_token: "p", confirmation: "c" }),
    expectArgs: [{ purge_token: "p", confirmation: "c" }] },
  { op: "t1.purgeCancel", tier: "t1", method: "purgeCancel",
    call: (s) => adapter.purgeCancel(s, "p"), expectArgs: ["p"] },
  { op: "t2.exportPreview", tier: "t2", method: "exportPreview",
    call: (s) => adapter.exportPreview(s, { workspaces: ["w"] }),
    expectArgs: [{ workspaces: ["w"] }] },
  { op: "t2.exportPackage", tier: "t2", method: "exportPackage",
    call: (s) => adapter.exportPackage(s, { workspaces: ["w"] }),
    expectArgs: [{ workspaces: ["w"] }] },
  { op: "t2.confirmExport", tier: "t2", method: "confirmExport",
    call: (s) => adapter.confirmExport(s, { package_digest: "d" }),
    expectArgs: [{ package_digest: "d" }] },
  { op: "t2.importPreview", tier: "t2", method: "importPreview",
    call: (s) => adapter.importPreview(s, new Uint8Array([1, 2, 3])),
    expectArgs: [new Uint8Array([1, 2, 3])] },
  { op: "t2.importCommit", tier: "t2", method: "importCommit",
    call: (s) => adapter.importCommit(s, {
      preview_token: "t", package_digest: "d", plan: { mode: "full" },
    }),
    expectArgs: [{ preview_token: "t", package_digest: "d", plan: { mode: "full" } }] },
  { op: "t2.importCancel", tier: "t2", method: "importCancel",
    call: (s) => adapter.importCancel(s, "t"), expectArgs: ["t"] },
];

describe("adapter dispatches every Runtime Contract 1.2.0 operation", () => {
  for (const c of CASES) {
    it(`${c.op} → session.${c.tier}.${c.method} (args passed through)`, async () => {
      const s = makeSession();
      const result = await c.call(s);
      const spy = (s[c.tier] as Record<string, ReturnType<typeof vi.fn>>)[c.method];
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual(c.expectArgs);
      expect(result).toEqual({ ok: true, op: c.op, args: c.expectArgs });
    });
  }

  it("covers every operation in ALL_OPERATIONS except t0.validate", () => {
    const covered = new Set(CASES.map((c) => c.op));
    const missing = ALL_OPERATIONS.filter(
      (op) => op !== "t0.validate" && !covered.has(op),
    );
    expect(missing).toEqual([]);
  });
});
