import { describe, it, expect } from "vitest";
import {
  validateDomainDoc,
  validateShellDoc,
  validateWorkspaceDoc,
} from "../src/config/host-config/validators";
import genericDomain from "../fixtures/host-configs/generic/domain.json";
import genericShell from "../fixtures/host-configs/generic/domain-shell.json";
import genericWorkspace from "../fixtures/host-configs/generic/workspace.config.json";
import learningDomain from "../fixtures/host-configs/learning/domain.json";
import learningShell from "../fixtures/host-configs/learning/domain-shell.json";
import learningWorkspace from "../fixtures/host-configs/learning/workspace.config.json";

describe("host-config schema validation (Keys 2.0)", () => {
  it("generic fixture set passes all three schemas", () => {
    expect(validateDomainDoc(genericDomain).valid).toBe(true);
    expect(validateShellDoc(genericShell).valid).toBe(true);
    expect(validateWorkspaceDoc(genericWorkspace).valid).toBe(true);
  });

  it("learning fixture set passes all three schemas", () => {
    expect(validateDomainDoc(learningDomain).valid).toBe(true);
    expect(validateShellDoc(learningShell).valid).toBe(true);
    expect(validateWorkspaceDoc(learningWorkspace).valid).toBe(true);
  });

  it("rejects domain doc missing required field", () => {
    const bad = { ...genericDomain } as Record<string, unknown>;
    delete bad.enabled_capabilities;
    expect(validateDomainDoc(bad).valid).toBe(false);
  });

  it("rejects shell doc with wrong shell_schema_version", () => {
    const bad = { ...genericShell, shell_schema_version: "9.9.9" };
    expect(validateShellDoc(bad).valid).toBe(false);
  });

  it("rejects workspace doc with direct_indexeddb = true", () => {
    const bad = JSON.parse(JSON.stringify(genericWorkspace));
    bad.host.direct_indexeddb = true;
    expect(validateWorkspaceDoc(bad).valid).toBe(false);
  });

  it("rejects workspace doc with allow_remote_modules = true", () => {
    const bad = JSON.parse(JSON.stringify(genericWorkspace));
    bad.module_loading.allow_remote_modules = true;
    expect(validateWorkspaceDoc(bad).valid).toBe(false);
  });

  it("rejects workspace doc with executable_code_in_iwxa = true", () => {
    const bad = JSON.parse(JSON.stringify(genericWorkspace));
    bad.security.executable_code_in_iwxa = true;
    expect(validateWorkspaceDoc(bad).valid).toBe(false);
  });

  it("rejects workspace doc with additional unknown property (no silent stripping)", () => {
    const bad = { ...genericWorkspace, mystery_field: true };
    expect(validateWorkspaceDoc(bad).valid).toBe(false);
  });

  it("rejects non-https origin in shell schema", () => {
    const bad = { ...genericShell, origin: "http://insecure.test" };
    expect(validateShellDoc(bad).valid).toBe(false);
  });

  it("accepts site-owned visual composition without changing other normative shell properties", () => {
    const siteOwned = {
      ...genericShell,
      layout: { ...genericShell.layout, workspace_chrome: "site-owned" },
    };
    expect(validateShellDoc(siteOwned).valid).toBe(true);
    expect(validateShellDoc(genericShell).valid).toBe(true);
  });

  it("rejects unrecognized shell modes rather than silently accepting them", () => {
    const malformed = {
      ...genericShell,
      layout: { ...genericShell.layout, workspace_chrome: "third-party-html" },
    };
    expect(validateShellDoc(malformed).valid).toBe(false);
  });
});
