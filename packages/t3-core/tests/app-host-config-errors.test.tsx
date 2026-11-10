/**
 * PROMPT_08 §7 — Host configuration failures render `config_invalid`
 * (never `health_build_required`) and preserve the diagnostic details
 * through the ErrorPage surface via HostConfigError.
 */
import { describe, it, expect } from "vitest";
import { hostConfigErrorToWorkspaceCode } from "../src/errors/host-config-error";
import { HostConfigError } from "../src/config/host-config";

describe("App host-config error mapping (PROMPT_08 §7)", () => {
  const CODES = [
    "runtime-version-mismatch",
    "contract-version-mismatch",
    "workspace-profile-mismatch",
    "workspace-profile-disabled",
    "domain-schema-invalid",
    "shell-schema-invalid",
    "workspace-schema-invalid",
    "domain-id-mismatch",
    "origin-mismatch",
    "unsafe-storage-policy",
    "unsafe-module-policy",
    "domain-config-http-error",
    "shell-config-invalid-json",
    "local-store-name-mismatch",
  ] as const;

  for (const code of CODES) {
    it(`${code} → config_invalid (never health_build_required)`, () => {
      const mapped = hostConfigErrorToWorkspaceCode(code);
      expect(mapped).toBe("config_invalid");
      expect(mapped).not.toBe("health_build_required");
    });
  }

  it("HostConfigError round-trips diagnostic code + details", () => {
    const err = new HostConfigError({
      code: "runtime-version-mismatch",
      message: "runtime drifted",
      details: { got: "9.9.9", expected: "0.1.0" },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("runtime-version-mismatch");
    expect(err.message).toBe("runtime drifted");
    expect(err.diagnostic.details).toEqual({ got: "9.9.9", expected: "0.1.0" });
    // ErrorPage dev-details reads .cause through getDevDetails.
    expect(err.cause).toEqual({ got: "9.9.9", expected: "0.1.0" });
  });
});
