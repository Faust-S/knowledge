import { describe, expect, it } from "vitest";
import { checkModuleCompatibility } from "../src/workspace-contract/compatibility";
import { validateWorkspaceModuleManifest } from "../src/workspace-contract/module-manifest";
import baseManifest from "../src/modules/base/manifest.json";
const runtime = (contractVersion: string) => ({ contractVersion, grantedLevels: [], grantedOperations: [] });
describe("single active Runtime Contract 1.3.0", () => {
  it("accepts only 1.3 manifests", () => {
    expect(validateWorkspaceModuleManifest(baseManifest).ok).toBe(true);
    expect(validateWorkspaceModuleManifest({...baseManifest, compatibility: {...baseManifest.compatibility, runtime_contract: "1.2.0"}}).ok).toBe(false);
  });
  it("rejects any kernel not implementing exact 1.3.0", () => {
    const m=validateWorkspaceModuleManifest(baseManifest).manifest!;
    expect(checkModuleCompatibility(m,runtime("1.3.0"))).toEqual([]);
    for(const v of ["1.2.0","1.0.0","1.4.0"])
      expect(checkModuleCompatibility(m,runtime(v)).map(x=>x.code)).toContain("runtime-contract-incompatible");
  });
});
