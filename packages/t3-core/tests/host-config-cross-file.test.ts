import { describe, it, expect } from "vitest";
import { verifyCrossFileInvariants } from "../src/config/host-config/cross-file-invariants";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
} from "../src/config/host-config/types";
import genericDomainRaw from "../fixtures/host-configs/generic/domain.json";
import genericShellRaw from "../fixtures/host-configs/generic/domain-shell.json";
import genericWorkspaceRaw from "../fixtures/host-configs/generic/workspace.config.json";

const D = genericDomainRaw as unknown as DomainConfigDoc;
const S = genericShellRaw as unknown as DomainShellDoc;
const W = genericWorkspaceRaw as unknown as WorkspaceConfigDoc;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("host-config cross-file invariants", () => {
  it("passes for a coherent generic set (synthetic → skip runtime origin)", () => {
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace: W,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues).toEqual([]);
  });

  it("detects domain_id mismatch between the three files", () => {
    const shell = clone(S);
    shell.domain_id = "different";
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell,
      workspace: W,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "domain-id-mismatch")).toBe(true);
  });

  it("detects origin mismatch when enforcing runtime", () => {
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace: W,
      runtimeOrigin: "https://other.test",
      originCheckMode: "enforce",
    });
    expect(issues.some((i) => i.code === "origin-mismatch")).toBe(true);
  });

  it("detects workspace_service_id that does not match any /workspace/ module in the domain", () => {
    const workspace = clone(W);
    workspace.workspace_service_id = "not.a.real.module";
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "workspace-service-mismatch")).toBe(true);
  });

  it("detects runtime version mismatch surface", () => {
    const workspace = clone(W);
    (workspace.host as { required_runtime_version: string }).required_runtime_version = "9.9.9";
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "runtime-version-mismatch")).toBe(true);
  });

  it("detects contract version mismatch surface", () => {
    const workspace = clone(W);
    (workspace.host as { required_contract_version: string }).required_contract_version = "0.9.9";
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "contract-version-mismatch")).toBe(true);
  });

  it("detects unsafe storage policy", () => {
    const workspace = clone(W);
    (workspace.host as { direct_indexeddb: boolean }).direct_indexeddb = true;
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "unsafe-storage-policy")).toBe(true);
  });

  it("detects unsafe module policy when remote modules would be allowed", () => {
    const workspace = clone(W);
    (workspace.module_loading as { allow_remote_modules: boolean }).allow_remote_modules = true;
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "unsafe-module-policy")).toBe(true);
  });

  it("detects executable code in .iwxa policy hole", () => {
    const workspace = clone(W);
    (workspace.security as { executable_code_in_iwxa: boolean }).executable_code_in_iwxa = true;
    const issues = verifyCrossFileInvariants({
      domain: D,
      shell: S,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    });
    expect(issues.some((i) => i.code === "unsafe-module-policy")).toBe(true);
  });
});
