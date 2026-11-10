import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

const ACTIVE_FILES = [
  "src/kernel-client/connect.ts",
  "src/kernel-client/index.ts",
  "src/kernel-client/types.ts",
  "src/kernel-client/adapter/index.ts",
  "src/workspace-contract/module-context.ts",
  "src/workspace-host/context/create-kernel-facade.ts",
];

describe("Runtime 1.3 atomic graph candidate isolation", () => {
  it("does not leak candidate imports into the active Runtime 1.3 path", () => {
    for (const path of ACTIVE_FILES) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      expect(source, path).not.toContain("runtime-1.3.0-candidate");
    }
  });

  it("activates only the qualified successor, never the candidate through the facade", () => {
    const contract = readFileSync(
      resolve(ROOT, "src/workspace-contract/module-context.ts"),
      "utf8",
    );
    const facade = readFileSync(
      resolve(ROOT, "src/workspace-host/context/create-kernel-facade.ts"),
      "utf8",
    );
    expect(contract).toContain("runtime-1.3.0");
    expect(contract).not.toContain("runtime-1.3.0-candidate");
    expect(facade).toContain("atomicAvailable");
    expect(facade).not.toContain("runtime-1.3.0-candidate");
  });

  it("keeps the active loader pinned to the qualified Runtime Contract 1.3.0 snapshot", () => {
    const connect = readFileSync(resolve(ROOT, "src/kernel-client/connect.ts"), "utf8");
    expect(connect).toContain('from "./contracts/runtime-1.3.0"');
    expect(connect).toContain("client.contract_version !== CONTRACT_VERSION");
    expect(connect).not.toContain("runtime-1.3.0-candidate");
  });
});
