import { describe, expect, it } from "vitest";
import syntheticValidManifest from "./fixtures/modules/synthetic-valid/manifest.json";
import {
  ALLOWED_MODULE_CONTEXT_KEYS,
  CONTRIBUTION_GROUPS,
  EXPECTED_RUNTIME_CONTRACT_VERSION,
  FORBIDDEN_MODULE_CONTEXT_KEYS,
  SUPPORTED_MODULE_MANIFEST_VERSION,
  WORKSPACE_CONTRACT_VERSION,
  WorkspaceContractError,
  assertNoForbiddenContextKeys,
  checkModuleCompatibility,
  collectContributions,
  defineWorkspaceModule,
  emptyContributionSet,
  expectedWorkspaceContractVersion,
  findDuplicateContributionIds,
  moduleDiagnostic,
  validateWorkspaceModuleManifest,
  type AnyContribution,
  type WorkspaceModuleManifest,
} from "../src/workspace-contract";

describe("Workspace Contract — versioning", () => {
  it("pins Workspace Contract to 0.1.0", () => {
    expect(WORKSPACE_CONTRACT_VERSION).toBe("0.1.0");
    expect(expectedWorkspaceContractVersion()).toBe("0.1.0");
  });

  it("targets Runtime Contract 1.3.0 and manifest schema 1.0.0", () => {
    expect(EXPECTED_RUNTIME_CONTRACT_VERSION).toBe("1.3.0");
    expect(SUPPORTED_MODULE_MANIFEST_VERSION).toBe("1.0.0");
  });
});

describe("Workspace Contract — manifest validator", () => {
  it("accepts a normative synthetic manifest", () => {
    const res = validateWorkspaceModuleManifest(syntheticValidManifest);
    expect(res.ok).toBe(true);
    expect(res.diagnostics).toEqual([]);
    expect(res.manifest?.module_id).toBe("synthetic.valid");
  });

  it("rejects a manifest with security.direct_indexeddb=true", () => {
    const bad = structuredClone(syntheticValidManifest) as unknown as Record<
      string,
      unknown
    >;
    (bad.security as Record<string, unknown>).direct_indexeddb = true;
    const res = validateWorkspaceModuleManifest(bad);
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]?.code).toBe("manifest-invalid");
  });

  it("rejects a manifest missing a contribution group", () => {
    const bad = structuredClone(syntheticValidManifest) as unknown as Record<
      string,
      unknown
    >;
    delete (bad.contributions as Record<string, unknown>).routes;
    const res = validateWorkspaceModuleManifest(bad);
    expect(res.ok).toBe(false);
  });

  it("rejects a manifest with the wrong runtime_contract", () => {
    const bad = structuredClone(syntheticValidManifest) as unknown as Record<
      string,
      unknown
    >;
    (bad.compatibility as Record<string, unknown>).runtime_contract = "0.9.0";
    const res = validateWorkspaceModuleManifest(bad);
    expect(res.ok).toBe(false);
  });

  it("declares every contribution group the schema requires", () => {
    // AJV already checks this, but we cross-verify the TypeScript
    // CONTRIBUTION_GROUPS list stays exhaustive.
    for (const g of CONTRIBUTION_GROUPS) {
      expect(
        (syntheticValidManifest.contributions as Record<string, unknown>)[g],
      ).toBeDefined();
    }
    expect(CONTRIBUTION_GROUPS).toEqual([
      "routes",
      "navigation",
      "editors",
      "viewers",
      "commands",
      "panels",
      "dashboard_cards",
      "validators",
      "migrations",
      "legacy_importers",
    ]);
  });
});

describe("Workspace Contract — defineWorkspaceModule", () => {
  const validManifest = syntheticValidManifest as WorkspaceModuleManifest;

  it("returns the same definition object (identity helper)", () => {
    const def = defineWorkspaceModule({
      manifest: validManifest,
      activate: () => {},
    });
    expect(def.manifest).toBe(validManifest);
  });

  it("throws when activate is missing", () => {
    expect(() =>
      // @ts-expect-error deliberate misuse
      defineWorkspaceModule({ manifest: validManifest }),
    ).toThrowError(WorkspaceContractError);
  });

  it.each([
    ["url"],
    ["remoteUrl"],
    ["bundle"],
    ["code"],
    ["sourceCode"],
    ["moduleFederation"],
  ])("rejects remote-loading key `%s`", (key) => {
    expect(() =>
      defineWorkspaceModule({
        manifest: validManifest,
        activate: () => {},
        [key]: "https://example.com/module.js",
      } as never),
    ).toThrowError(WorkspaceContractError);
  });

  it("rejects manifests with security.remote_code=true (literal short-circuit)", () => {
    const evilManifest = {
      ...validManifest,
      security: {
        ...validManifest.security,
        remote_code: true,
      },
    } as unknown as WorkspaceModuleManifest;
    expect(() =>
      defineWorkspaceModule({
        manifest: evilManifest,
        activate: () => {},
      }),
    ).toThrowError(/remote code loading is forbidden/i);
  });

  it("rejects manifests with security.iwxa_executable_payload=true", () => {
    const evilManifest = {
      ...validManifest,
      security: {
        ...validManifest.security,
        iwxa_executable_payload: true,
      },
    } as unknown as WorkspaceModuleManifest;
    expect(() =>
      defineWorkspaceModule({
        manifest: evilManifest,
        activate: () => {},
      }),
    ).toThrowError(/executable payloads/i);
  });
});

describe("Workspace Contract — compatibility checker", () => {
  const manifest = syntheticValidManifest as WorkspaceModuleManifest;
  const okRuntime = {
    contractVersion: "1.3.0",
    grantedLevels: ["T0", "T1"] as const,
    grantedOperations: ["t1.listWorkspaces", "t1.getObject"] as const,
  };

  it("returns empty diagnostics for a matching module + runtime", () => {
    const out = checkModuleCompatibility(manifest, okRuntime, {
      requiredLevels: ["T0"],
      requiredOperations: ["t1.listWorkspaces"],
    });
    expect(out).toEqual([]);
  });

  it("reports missing runtime level", () => {
    const out = checkModuleCompatibility(manifest, okRuntime, {
      requiredLevels: ["T2"],
      requiredOperations: [],
    });
    expect(out[0]?.code).toBe("missing-runtime-level");
  });

  it("reports missing operation", () => {
    const out = checkModuleCompatibility(manifest, okRuntime, {
      requiredLevels: [],
      requiredOperations: ["t1.putObject"],
    });
    expect(out[0]?.code).toBe("missing-operation");
  });

  it("reports incompatible workspace_contract", () => {
    const bad = {
      ...manifest,
      compatibility: { ...manifest.compatibility, workspace_contract: "0.2.0" },
    };
    const out = checkModuleCompatibility(bad, okRuntime);
    expect(out.map((d) => d.code)).toContain("workspace-contract-incompatible");
  });

  it("reports incompatible runtime_contract when the kernel disagrees", () => {
    const out = checkModuleCompatibility(manifest, {
      ...okRuntime,
      contractVersion: "2.0.0",
    });
    expect(out.map((d) => d.code)).toContain("runtime-contract-incompatible");
  });
});

describe("Workspace Contract — module context surface", () => {
  it("declares exactly the allowed context keys", () => {
    expect([...ALLOWED_MODULE_CONTEXT_KEYS].sort()).toEqual(
      [
        "commands",
        "currentWorkspace",
        "dashboard",
        "diagnostics",
        "kernel",
        "panels",
        "profile",
        "router",
        "terminology",
        "views",
      ].sort(),
    );
  });

  it.each(FORBIDDEN_MODULE_CONTEXT_KEYS.map((k) => [k]))(
    "assertNoForbiddenContextKeys rejects `%s`",
    (key) => {
      expect(() => assertNoForbiddenContextKeys({ [key]: {} })).toThrow();
    },
  );

  it("assertNoForbiddenContextKeys accepts a clean context", () => {
    expect(() =>
      assertNoForbiddenContextKeys({
        kernel: {},
        router: {},
        commands: {},
        views: {},
        panels: {},
        dashboard: {},
        terminology: {},
        diagnostics: {},
        currentWorkspace: {},
      }),
    ).not.toThrow();
  });
});

describe("Workspace Contract — contributions utilities", () => {
  it("emptyContributionSet returns every group as an empty array", () => {
    const set = emptyContributionSet();
    for (const g of CONTRIBUTION_GROUPS) {
      expect(Array.isArray(set[g])).toBe(true);
      expect(set[g]).toHaveLength(0);
    }
  });

  it("detects duplicate contribution ids across the same kind", () => {
    const dup: AnyContribution[] = [
      {
        kind: "command",
        id: "c1",
        moduleId: "m",
        requiredOperations: [],
        labelKey: "x",
        loader: async () => ({ run: () => {} }),
      },
      {
        kind: "command",
        id: "c1",
        moduleId: "m2",
        requiredOperations: [],
        labelKey: "y",
        loader: async () => ({ run: () => {} }),
      },
    ];
    const out = findDuplicateContributionIds(dup);
    expect(out).toEqual([{ group: "command", id: "c1", count: 2 }]);
  });

  it("collectContributions flattens the activation result", () => {
    const out = collectContributions({
      contributions: {
        commands: [
          {
            kind: "command",
            id: "c1",
            moduleId: "m",
            requiredOperations: [],
            labelKey: "x",
            loader: async () => ({ run: () => {} }),
          },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(collectContributions()).toEqual([]);
  });
});

describe("Workspace Contract — diagnostics", () => {
  it("moduleDiagnostic omits undefined details", () => {
    const d = moduleDiagnostic("manifest-invalid", "x");
    expect(d).toEqual({ code: "manifest-invalid", message: "x" });
  });

  it("moduleDiagnostic preserves technical details for the diagnostics surface", () => {
    const d = moduleDiagnostic("missing-operation", "x", {
      moduleId: "m",
      details: { op: "t1.putObject" },
    });
    expect(d.details).toEqual({ op: "t1.putObject" });
    expect(d.moduleId).toBe("m");
  });
});
