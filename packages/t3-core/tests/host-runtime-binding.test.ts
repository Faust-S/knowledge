import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verifyCrossFileInvariants } from "../src/config/host-config/cross-file-invariants";
import { isSupportedHostRuntimeVersion } from "../src/config/host-config/runtime-binding";
import { validateWorkspaceDoc } from "../src/config/host-config/validators";
import type { DomainConfigDoc, DomainShellDoc, WorkspaceConfigDoc } from "../src/config/host-config/types";
import domainFixture from "../fixtures/host-configs/generic/domain.json";
import shellFixture from "../fixtures/host-configs/generic/domain-shell.json";
import workspaceFixture from "../fixtures/host-configs/generic/workspace.config.json";

function pair(domainVersion: string, workspaceVersion: string) {
  const domain = structuredClone(domainFixture) as unknown as DomainConfigDoc;
  const shell = structuredClone(shellFixture) as unknown as DomainShellDoc;
  const workspace = structuredClone(workspaceFixture) as unknown as WorkspaceConfigDoc;
  domain.runtime.runtime_version = domainVersion;
  (workspace.host as { required_runtime_version: string }).required_runtime_version = workspaceVersion;
  return { domain, shell, workspace, runtimeOrigin: null, originCheckMode: "skip-synthetic" as const };
}

describe("explicit existing host runtime configuration bindings", () => {
  it.each(["0.3.6"])("admits matching %s configuration without claiming executable runtime acceptance", (version) => {
    const input = pair(version, version);
    expect(isSupportedHostRuntimeVersion(version)).toBe(true);
    expect(validateWorkspaceDoc(input.workspace).valid).toBe(true);
    expect(verifyCrossFileInvariants(input)).toEqual([]);
  });

  it.each([["0.3.5", "0.3.6"], ["0.3.6", "0.3.5"]])("rejects a %s domain with a %s Workspace", (domain, workspace) => {
    expect(verifyCrossFileInvariants(pair(domain, workspace)).some((issue) => issue.code === "runtime-version-mismatch")).toBe(true);
  });

  it.each(["0.3.5", "0.3.7", "0.4.0", "^0.3.6", "0.3.6-beta", " 0.3.6", "", null, 0.36])("rejects unsupported runtime input %s", (version) => {
    expect(isSupportedHostRuntimeVersion(version)).toBe(false);
    const input = pair(String(version), String(version));
    expect(validateWorkspaceDoc(input.workspace).valid).toBe(false);
    expect(verifyCrossFileInvariants(input).some((issue) => issue.code === "runtime-version-mismatch")).toBe(true);
  });

  it("does not relax contract, direct storage or executable-module restrictions for 0.3.6", () => {
    const input = pair("0.3.6", "0.3.6");
    Object.assign(input.workspace.host, { direct_indexeddb: true, required_contract_version: "1.2.0" });
    Object.assign(input.workspace.module_loading, { allow_remote_modules: true });
    expect(validateWorkspaceDoc(input.workspace).valid).toBe(false);
    const codes = verifyCrossFileInvariants(input).map((issue) => issue.code);
    expect(codes).toContain("unsafe-storage-policy");
    expect(codes).toContain("contract-version-mismatch");
    expect(codes).toContain("unsafe-module-policy");
  });

  it("records the donor discrepancy and preserves original Domain Keys source identity", () => {
    const provenance = JSON.parse(readFileSync("src/config/schemas/keys-2.0/provenance.json", "utf8"));
    expect(provenance.retained_donor_discrepancy).toMatchObject({
      declared_sha256: "69baffe0f88aff15a16bcd2914c3dac9f21d42ad39737d5d95f7101f5eb6a515",
      actual_donor_sha256: "2bab48f601e137d8e6593f59c7b6e595dceb4c48e4e7740cab8037b19c5c31c1",
      status: "RECORDED_NOT_SILENTLY_ACCEPTED",
    });
    expect(provenance.source_files["workspace-config.schema.json"]).toBe("0df3a5a457a20c0121af64a2c122bb6bdfe70c0f3aa86deed940c34c47690f7f");
    expect(provenance.current_derivation.runtime_qualification_complete).toBe(false);
  });
});
