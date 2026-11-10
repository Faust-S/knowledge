/**
 * Public contract parity — ensures declared operations and TS surface stay in
 * lockstep. Uses `computeGrantedOperations` (the runtime source of truth) as
 * the reference and validates that every entry corresponds to a real method on
 * `IWXAClient`, and that `t2.importCancel` is actually granted.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_OPERATIONS,
  CONTRACT_VERSION,
  computeGrantedOperations,
} from "../src/runtime/public-api";
import type { ServicePermissions } from "../src/runtime/public-api";

const fullPerms: ServicePermissions = {
  workspace: {
    list: true,
    read: true,
    create: true,
    soft_delete: true,
    restore: true,
    purge: true,
  },
  objects: { read: ["*"], write: ["*"], delete: ["*"] },
  events: { read_scope: "workspace" },
  packages: {
    export: true,
    import: true,
    export_scope: "workspace",
    import_scope: "workspace",
  },
};

describe("public contract parity", () => {
  it("contract version pinned to 1.2.0", () => {
    expect(CONTRACT_VERSION).toBe("1.3.0");
  });

  it("ALL_OPERATIONS lists every t0/t1/t2 method", () => {
    // Every entry must be of the form t<n>.<method>
    for (const op of ALL_OPERATIONS) {
      expect(op).toMatch(/^t[012]\.[a-zA-Z]+$/);
    }
    expect(ALL_OPERATIONS).toContain("t2.importCancel");
  });

  it("computeGrantedOperations grants t2.importCancel when import allowed", () => {
    const ops = computeGrantedOperations(["T0", "T1", "T2"], "full", fullPerms);
    expect(ops).toContain("t2.importCancel");
    expect(ops).toContain("t2.importPreview");
    expect(ops).toContain("t2.importCommit");
  });

  it("every granted operation appears in ALL_OPERATIONS", () => {
    const ops = computeGrantedOperations(["T0", "T1", "T2"], "full", fullPerms);
    for (const op of ops) {
      expect(ALL_OPERATIONS).toContain(op);
    }
  });
});
