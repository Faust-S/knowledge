import { describe, expect, it, vi } from "vitest";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { adapter, OperationNotGrantedError, RuntimeSurfaceIncompatibleError } from "../src/kernel-client/adapter";
import { AtomicGraphUnavailableError } from "../src/kernel-client/contracts/runtime-1.3.0/atomic-graph-negotiation";
import { connectKernel } from "../src/kernel-client/connect";
import type { KernelSession } from "../src/kernel-client/types";
import type { CommitObjectGraphInput } from "../src/kernel-client/contracts/runtime-1.3.0";
import { checkModuleCompatibility } from "../src/workspace-contract/compatibility";
import manifest from "./fixtures/modules/synthetic-valid/manifest.json";
import type { WorkspaceModuleManifest } from "../src/workspace-contract";

const input = { workspace_id: "w" } as CommitObjectGraphInput;
function session(version = "1.3.0", grants = ["t1.commitObjectGraph"], method: unknown = vi.fn(async () => ({ transaction_id: "tx" }))) {
  return { contract_version: version, mode: "full", granted_levels: ["T1"], granted_operations: grants, t1: { commitObjectGraph: method }, t2: {}, authorization: {}, service: {} } as unknown as KernelSession;
}
describe("qualified Runtime 1.3 facade", () => {
  it("dispatches unchanged input and receipt once through adapter", async () => {
    const receipt = { transaction_id: "tx" }; const method = vi.fn(async () => receipt); const facade = createKernelFacade({ session: session("1.3.0", undefined, method) });
    expect(facade.hasOperation("t1.commitObjectGraph")).toBe(true);
    expect(await facade.commitObjectGraph!(input)).toBe(receipt); expect(method).toHaveBeenCalledExactlyOnceWith(input);
    expect(Object.isFrozen(facade)).toBe(true); expect(Object.isFrozen(facade.grantedOperations)).toBe(true);
    for (const key of ["session", "adapter", "runtime", "client", "t1"]) expect(facade).not.toHaveProperty(key);
  });
  it.each([
    ["1.2.0", ["t1.commitObjectGraph"], vi.fn(), AtomicGraphUnavailableError],
    ["1.3.0", ["t1.putObject", "t1.putRelation"], vi.fn(), OperationNotGrantedError],
    ["1.3.0", ["t1.commitObjectGraph"], undefined, RuntimeSurfaceIncompatibleError],
  ])("denies incomplete negotiation (%s, %s) and keeps operation absent", (version, grants, method, ErrorType) => {
    const value = session(version, grants, method === undefined ? null : method);
    const facade = createKernelFacade({ session: value }); expect(facade).not.toHaveProperty("commitObjectGraph"); expect(facade.hasOperation("t1.commitObjectGraph")).toBe(false);
    expect(() => adapter.commitObjectGraph(value, input)).toThrow(ErrorType);
    if (typeof method === "function") expect(method).not.toHaveBeenCalled();
  });
  it("rechecks grants on dispatch after facade creation", async () => {
    const value = session(); const facade = createKernelFacade({ session: value }); (value as { granted_operations: string[] }).granted_operations = [];
    await expect(facade.commitObjectGraph!(input)).rejects.toBeInstanceOf(OperationNotGrantedError);
  });
  it("accepts qualified 1.3 intentionally and rejects unknown successor versions", async () => {
    for (const [version, status] of [["1.3.0", "ready"], ["1.4.0", "update-required"], ["1.3.0-candidate", "update-required"]]) {
      const result = await connectKernel({ serviceId: "s", bootstrap: { version: 1, connect: async () => session(version) } as never }); expect(result.status).toBe(status);
    }
  });
  it("keeps 1.3 domain modules compatible on qualified 1.3", () => {
    expect(checkModuleCompatibility(manifest as WorkspaceModuleManifest, { contractVersion: "1.3.0", grantedLevels: ["T1"], grantedOperations: [] })).toEqual([]);
  });
});
