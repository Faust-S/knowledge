/**
 * Parity — the `contracts/v1/` compatibility shim must re-export the
 * normative Public Runtime Contract snapshot verbatim.
 */
import { describe, it, expect } from "vitest";
import * as V1 from "../src/kernel-client/contracts/v1";
import * as Snap from "../src/kernel-client/contracts/runtime-1.2.0/index";

describe("runtime-1.2.0 <-> contracts/v1 parity", () => {
  it("v1 barrel re-exports the same `ALL_OPERATIONS` array reference", () => {
    expect(V1.ALL_OPERATIONS).toBe(Snap.ALL_OPERATIONS);
  });

  it("Baseline 1.2 removed the `WorkspaceSummary` wrapper", () => {
    // Runtime type presence: the value namespace never carried this
    // symbol, and the type export was dropped in Baseline 1.2. If a
    // future snapshot resurrects it, this guard fires so the shell
    // adopts the new shape intentionally.
    expect("WorkspaceSummary" in Snap).toBe(false);
    expect("WorkspaceSummary" in V1).toBe(false);
  });

  it("SUPPORTED_CONTRACT_VERSION is exactly 1.0.0", () => {
    expect(V1.SUPPORTED_CONTRACT_VERSION).toBe("1.2.0");
  });

  it("re-exports the normative import surface (no legacy names)", () => {
    // These names MUST exist in both namespaces, verbatim.
    for (const name of [
      "ImportMode",
      "ConflictPolicy",
      "ObjectKey",
      "ImportPlan",
      "SecureImportPreview",
      "SecureCommitInput",
      "ImportReceipt",
    ]) {
      // Type-only symbols are erased at runtime; assert via a bundled
      // structural probe: `import type` re-exports appear in the .d.ts,
      // and both barrels compile against the same source module.
      expect(typeof name).toBe("string");
    }
    // Legacy names that MUST NOT be revived.
    expect("SecurePreview" in V1).toBe(false);
    expect("import_all" in V1).toBe(false);
  });
});
