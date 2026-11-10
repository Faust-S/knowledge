/**
 * PROMPT_08 §4–5 — profile, runtime and local-store cross-file invariants.
 */
import { describe, it, expect } from "vitest";
import { verifyCrossFileInvariants } from "../src/config/host-config/cross-file-invariants";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
} from "../src/config/host-config/types";
import D from "../fixtures/host-configs/generic/domain.json";
import S from "../fixtures/host-configs/generic/domain-shell.json";
import W from "../fixtures/host-configs/generic/workspace.config.json";

const domain = D as unknown as DomainConfigDoc;
const shell = S as unknown as DomainShellDoc;
const workspace = W as unknown as WorkspaceConfigDoc;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("host-config profile invariants (PROMPT_08 §4)", () => {
  it("passes for a coherent generic set", () => {
    expect(
      verifyCrossFileInvariants({
        domain,
        shell,
        workspace,
        runtimeOrigin: null,
        originCheckMode: "skip-synthetic",
      }),
    ).toEqual([]);
  });

  it("detects workspace_profile / domain.workspace_profile mismatch", () => {
    const d = clone(domain);
    d.workspace_profile = "personal";
    d.enabled_profiles = ["personal", "generic"]; // keep the workspace profile enabled to isolate the check
    const codes = verifyCrossFileInvariants({
      domain: d,
      shell,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    }).map((i) => i.code);
    expect(codes).toContain("workspace-profile-mismatch");
    expect(codes).not.toContain("workspace-profile-disabled");
  });

  it("detects workspace.profile not in domain.enabled_profiles", () => {
    const d = clone(domain);
    d.enabled_profiles = ["personal"];
    d.workspace_profile = "generic";
    const codes = verifyCrossFileInvariants({
      domain: d,
      shell,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    }).map((i) => i.code);
    expect(codes).toContain("workspace-profile-disabled");
  });
});

describe("host-config runtime / local-store invariants (PROMPT_08 §5)", () => {
  it("blocks when domain.runtime.runtime_version drifts from workspace", () => {
    const d = clone(domain);
    d.runtime.runtime_version = "9.9.9";
    const codes = verifyCrossFileInvariants({
      domain: d,
      shell,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    }).map((i) => i.code);
    expect(codes).toContain("runtime-version-mismatch");
  });

  it("blocks when workspace.host.required_runtime_version != 0.3.5", () => {
    const w = clone(workspace);
    (w.host as { required_runtime_version: string }).required_runtime_version = "9.9.9";
    const codes = verifyCrossFileInvariants({
      domain,
      shell,
      workspace: w,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    }).map((i) => i.code);
    expect(codes).toContain("runtime-version-mismatch");
  });

  it("blocks when local_store_name disagrees across files", () => {
    const d = clone(domain);
    (d as { local_store_name: string }).local_store_name = "other-store";
    const codes = verifyCrossFileInvariants({
      domain: d,
      shell,
      workspace,
      runtimeOrigin: null,
      originCheckMode: "skip-synthetic",
    }).map((i) => i.code);
    expect(codes).toContain("local-store-name-mismatch");
  });
});
