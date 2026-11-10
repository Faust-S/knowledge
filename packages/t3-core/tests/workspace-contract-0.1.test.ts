import { describe, expect, it } from "vitest";
import syntheticValidManifest from "./fixtures/modules/synthetic-valid/manifest.json";
import {
  createRouteRef,
  isRouteRef,
  ROUTE_REF_ID_PATTERN,
  REQUIRED_KERNEL_FACADE_METHODS,
  WorkspaceContractError,
  defineWorkspaceModule,
  validateActivationContributions,
  type AnyContribution,
  type RouteRef,
  type WorkspaceModuleManifest,
} from "../src/workspace-contract";
import { ALL_OPERATIONS } from "../src/kernel-client";

describe("Workspace Contract 0.1 — RouteRef", () => {
  it("accepts canonical ids matching the pattern", () => {
    for (const id of ["a", "root", "objects.detail", "obj-1", "a1_b"]) {
      const r = createRouteRef(id);
      expect(r.id).toBe(id);
      expect(isRouteRef(r)).toBe(true);
    }
  });

  it("rejects invalid ids", () => {
    for (const id of ["", "/foo", "#/x", "A", "-x", ".x", " ", "x y", "http://x"]) {
      expect(() => createRouteRef(id)).toThrowError(WorkspaceContractError);
    }
  });

  it("exports the exact ID pattern", () => {
    expect(ROUTE_REF_ID_PATTERN.source).toBe("^[a-z0-9][a-z0-9._-]*$");
  });

  it("returned refs are immutable snapshots", () => {
    const r = createRouteRef("root") as RouteRef & { id: string };
    expect(() => {
      (r as { id: string }).id = "hijack";
    }).toThrow();
  });
});

describe("Workspace Contract 0.1 — KernelFacade surface", () => {
  it("REQUIRED_KERNEL_FACADE_METHODS covers T1 + T2 trusted surface", () => {
    // Reads, writes, lifecycle, exchange — total 19 concrete methods
    // plus hasOperation (capability check).
    expect(REQUIRED_KERNEL_FACADE_METHODS).toEqual(
      expect.arrayContaining([
        "hasOperation",
        "listWorkspaces",
        "getWorkspace",
        "createWorkspace",
        "listObjects",
        "getObject",
        "listEventsSince",
        "putObject",
        "deleteObject",
        "putRelation",
        "deleteRelation",
        "listAssets",
        "getAsset",
        "putAsset",
        "deleteAsset",
        "softDeleteWorkspace",
        "restoreWorkspace",
        "purgePreview",
        "purgeCommit",
        "purgeCancel",
        "exportPreview",
        "exportPackage",
        "confirmExport",
        "importPreview",
        "importCommit",
        "importCancel",
      ]),
    );
  });

  it("covers every required Runtime 1.3 T1/T2 operation, with atomic graph capability negotiated separately so modules do not need raw-runtime bypasses", () => {
    const required = new Set(REQUIRED_KERNEL_FACADE_METHODS as readonly string[]);
    const missing = ALL_OPERATIONS
      .filter((op) => (op.startsWith("t1.") || op.startsWith("t2.")) && op !== "t1.commitObjectGraph")
      .map((op) => op.slice(3))
      .filter((method) => !required.has(method));
    expect(missing).toEqual([]);
  });

  it("does not expose raw kernel session / adapter methods", () => {
    // The literal list must not contain forbidden low-level ops.
    for (const forbidden of [
      "session",
      "adapter",
      "getSession",
      "connect",
      "disconnect",
      "handshake",
    ]) {
      expect(REQUIRED_KERNEL_FACADE_METHODS as readonly string[]).not.toContain(
        forbidden,
      );
    }
  });
});

describe("Workspace Contract 0.1 — defineWorkspaceModule (AJV validation)", () => {
  const validManifest = syntheticValidManifest as WorkspaceModuleManifest;

  it("throws WorkspaceContractError with AJV details on invalid manifest", () => {
    const bad = structuredClone(syntheticValidManifest) as unknown as Record<
      string,
      unknown
    >;
    delete (bad.contributions as Record<string, unknown>).routes;
    let caught: WorkspaceContractError | null = null;
    try {
      defineWorkspaceModule({
        manifest: bad as unknown as WorkspaceModuleManifest,
        activate: () => {},
      });
    } catch (e) {
      caught = e as WorkspaceContractError;
    }
    expect(caught).toBeInstanceOf(WorkspaceContractError);
    expect(caught?.code).toBe("manifest-invalid");
    const details = caught?.details as { ajvErrors?: unknown };
    expect(details?.ajvErrors).toBeDefined();
    expect(Array.isArray(details?.ajvErrors)).toBe(true);
  });

  it("accepts a normative manifest and returns identity", () => {
    const def = defineWorkspaceModule({
      manifest: validManifest,
      activate: () => {},
    });
    expect(def.manifest).toBe(validManifest);
  });
});

describe("Workspace Contract 0.1 — validateActivationContributions", () => {
  const manifest = syntheticValidManifest as WorkspaceModuleManifest;
  const routeRef = createRouteRef("root");

  const validCommand = (): AnyContribution => ({
    kind: "command",
    id: "cmd.a",
    moduleId: manifest.module_id,
    requiredOperations: ["t1.listWorkspaces"],
    labelKey: "x",
    loader: async () => ({ run: () => {} }),
  });

  it("accepts contributions owned by the manifest module", () => {
    const out = validateActivationContributions(manifest, {
      contributions: {
        commands: [validCommand()],
        routes: [
          {
            kind: "route",
            id: "r1",
            moduleId: manifest.module_id,
            requiredOperations: [],
            routeRef,
            loader: async () => ({ default: () => null }),
          },
        ],
      },
    });
    expect(out).toEqual([]);
  });

  it("rejects contribution owned by a different module", () => {
    const cmd = validCommand();
    cmd.moduleId = "another.module";
    const out = validateActivationContributions(manifest, {
      contributions: { commands: [cmd] },
    });
    expect(out.some((d) => /moduleId/.test(d.message))).toBe(true);
  });

  it("rejects duplicate ids inside the same group", () => {
    const out = validateActivationContributions(manifest, {
      contributions: { commands: [validCommand(), validCommand()] },
    });
    expect(out.some((d) => /дубликат/.test(d.message))).toBe(true);
  });

  it("rejects unknown requiredOperations", () => {
    const cmd = validCommand();
    (cmd as { requiredOperations: readonly string[] }).requiredOperations = [
      "kernel.doWhatever",
    ];
    const out = validateActivationContributions(manifest, {
      contributions: { commands: [cmd] },
    });
    expect(out.some((d) => /неизвестная operation/.test(d.message))).toBe(true);
  });

  it("accepts every normative OperationId", () => {
    for (const op of ALL_OPERATIONS) {
      const cmd = validCommand();
      (cmd as { requiredOperations: readonly string[] }).requiredOperations = [op];
      const out = validateActivationContributions(manifest, {
        contributions: { commands: [cmd] },
      });
      expect(out).toEqual([]);
    }
  });

  it("rejects route contribution with a missing/invalid routeRef", () => {
    const out = validateActivationContributions(manifest, {
      contributions: {
        routes: [
          {
            kind: "route",
            id: "r1",
            moduleId: manifest.module_id,
            requiredOperations: [],
            // @ts-expect-error deliberate: routeRef must be a RouteRef
            routeRef: { id: "Bad ID!" },
            loader: async () => ({ default: () => null }),
          },
        ],
      },
    });
    expect(out.some((d) => /routeRef/.test(d.message))).toBe(true);
  });

  it("rejects loader that is not a function", () => {
    const cmd = validCommand();
    (cmd as { loader: unknown }).loader = "not-a-function";
    const out = validateActivationContributions(manifest, {
      contributions: { commands: [cmd] },
    });
    expect(out.some((d) => /loader/.test(d.message))).toBe(true);
  });

  it("no-op when result has no contributions", () => {
    expect(validateActivationContributions(manifest, undefined)).toEqual([]);
    expect(validateActivationContributions(manifest, {})).toEqual([]);
  });
});
