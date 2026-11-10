/**
 * tests/module-preflight.test.ts — PROMPT 13 §5.
 */
import { describe, expect, it } from "vitest";
import { preflight } from "@/workspace-host/modules";
import type { ModuleDeclaration } from "@/workspace-host/modules";

const decl = (over: Partial<ModuleDeclaration> = {}): ModuleDeclaration => ({
  moduleId: "m",
  state: "active",
  requiredLevels: [],
  requiredOperations: [],
  dependencies: [],
  ...over,
});

const runtime = {
  contractVersion: "1.3.0",
  grantedLevels: ["T0", "T1", "T2"] as const,
  grantedOperations: ["t1.listWorkspaces"] as const,
};

describe("preflight", () => {
  it("returns planned/disabled without touching loader table", () => {
    expect(
      preflight({
        declaration: decl({ state: "planned" }),
        runtime,
        loaderIds: new Set(),
        dependencyFailed: false,
        dependencyDiagnostics: [],
      }),
    ).toMatchObject({ ok: false, status: "planned" });
    expect(
      preflight({
        declaration: decl({ state: "disabled" }),
        runtime,
        loaderIds: new Set(),
        dependencyFailed: false,
        dependencyDiagnostics: [],
      }),
    ).toMatchObject({ ok: false, status: "disabled" });
  });

  it("blocks unknown active module with diagnostic", () => {
    const res = preflight({
      declaration: decl(),
      runtime,
      loaderIds: new Set(),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("unknown");
      expect(res.diagnostics[0]?.code).toBe("unknown-module");
    }
  });

  it("blocks on missing required operation", () => {
    const res = preflight({
      declaration: decl({ requiredOperations: ["t1.putObject"] }),
      runtime,
      loaderIds: new Set(["m"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("missing-operation");
      expect(res.diagnostics[0]?.code).toBe("missing-operation");
    }
  });

  it("blocks on missing required level", () => {
    const res = preflight({
      declaration: decl({ requiredLevels: ["T2"] }),
      runtime: { ...runtime, grantedLevels: ["T0", "T1"] },
      loaderIds: new Set(["m"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe("missing-level");
  });

  it("blocks on dependency-error and surfaces upstream diagnostics", () => {
    const res = preflight({
      declaration: decl(),
      runtime,
      loaderIds: new Set(["m"]),
      dependencyFailed: true,
      dependencyDiagnostics: [
        { code: "missing-dependency", message: "x" },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("dependency-error");
      expect(res.diagnostics[0]?.code).toBe("missing-dependency");
    }
  });

  it("passes for a well-formed active module", () => {
    const res = preflight({
      declaration: decl(),
      runtime,
      loaderIds: new Set(["m"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(res.ok).toBe(true);
  });
});
