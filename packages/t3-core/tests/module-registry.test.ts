/**
 * tests/module-registry.test.ts — PROMPT 13 orchestration acceptance.
 */
import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "@/workspace-host/modules";
import { createRouteRef } from "@/workspace-contract";
import {
  buildDeclarations,
  buildRuntimeView,
  fakeContextProvider,
  makeManifest,
  makeModule,
} from "./helpers/module-registry-helpers";

describe("ModuleRegistry", () => {
  it("activates a valid active module and registers its contributions", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "alpha", state: "active" }]),
      loaderTable: { alpha: async () => ({ default: makeModule("alpha") }) },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap.find((r) => r.moduleId === "alpha")?.status).toBe("activated");
    expect(registry.contributions.listByGroup("routes")).toHaveLength(1);
  });

  it("does NOT invoke loaders for planned, disabled, or unknown modules", async () => {
    const planned = vi.fn();
    const disabled = vi.fn();
    const unknown = vi.fn();
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "planned", state: "planned" },
        { id: "disabled", state: "disabled" },
        { id: "ghost", state: "active" },
      ]),
      loaderTable: {
        planned: async () => {
          planned();
          return { default: makeModule("planned") };
        },
        disabled: async () => {
          disabled();
          return { default: makeModule("disabled") };
        },
        // 'ghost' intentionally absent → unknown-module
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(planned).not.toHaveBeenCalled();
    expect(disabled).not.toHaveBeenCalled();
    expect(unknown).not.toHaveBeenCalled();
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("planned")?.status).toBe("planned");
    expect(byId.get("disabled")?.status).toBe("disabled");
    expect(byId.get("ghost")?.status).toBe("unknown");
    expect(byId.get("ghost")?.diagnostics[0]?.code).toBe("unknown-module");
  });

  it("blocks import when a required operation is missing", async () => {
    const loader = vi.fn(async () => ({ default: makeModule("m") }));
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "m", state: "active", requiredOperations: ["t1.putObject"] },
      ]),
      loaderTable: { m: loader },
      runtime: buildRuntimeView({ grantedOperations: ["t1.listWorkspaces"] }),
      contextProvider: fakeContextProvider(),
    });
    expect(loader).not.toHaveBeenCalled();
    expect(snap[0]?.status).toBe("missing-operation");
  });

  it("blocks import when a required level is missing", async () => {
    const loader = vi.fn(async () => ({ default: makeModule("m") }));
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "m", state: "active", requiredLevels: ["T2"] },
      ]),
      loaderTable: { m: loader },
      runtime: buildRuntimeView({ grantedLevels: ["T0", "T1"] }),
      contextProvider: fakeContextProvider(),
    });
    expect(loader).not.toHaveBeenCalled();
    expect(snap[0]?.status).toBe("missing-level");
  });

  it("activates dependencies in topological order", async () => {
    const order: string[] = [];
    const mkLoader = (id: string) => async () => ({
      default: makeModule(id, {
        activate: () => {
          order.push(id);
          return {
            contributions: {
              routes: [
                {
                  kind: "route",
                  id: `${id}-root`,
                  moduleId: id,
                  requiredOperations: [],
                  routeRef: createRouteRef(`${id}-root`),
                  loader: async () => ({ default: () => null }),
                },
              ],
            },
          };
        },
      }),
    });
    const registry = new ModuleRegistry();
    await registry.start({
      declarations: buildDeclarations([
        { id: "z", state: "active", dependencies: ["a", "b"] },
        { id: "b", state: "active", dependencies: ["a"] },
        { id: "a", state: "active" },
      ]),
      loaderTable: { a: mkLoader("a"), b: mkLoader("b"), z: mkLoader("z") },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(order).toEqual(["a", "b", "z"]);
  });

  it("blocks a dependency cycle without activating any participant", async () => {
    const activate = vi.fn();
    const mk = (id: string) =>
      makeModule(id, { activate: () => { activate(id); } });
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "a", state: "active", dependencies: ["b"] },
        { id: "b", state: "active", dependencies: ["a"] },
      ]),
      loaderTable: {
        a: async () => ({ default: mk("a") }),
        b: async () => ({ default: mk("b") }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(activate).not.toHaveBeenCalled();
    for (const r of snap) expect(r.status).toBe("dependency-error");
  });

  it("blocks a module whose loaded manifest.module_id does not match", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "declared", state: "active" }]),
      loaderTable: { declared: async () => ({ default: makeModule("actual") }) },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("module-id-mismatch");
    expect(snap[0]?.diagnostics[0]?.code).toBe("module-id-mismatch");
  });

  it("isolates an activation failure; peers stay activated", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "good", state: "active" },
        { id: "bad", state: "active" },
      ]),
      loaderTable: {
        good: async () => ({ default: makeModule("good") }),
        bad: async () => ({
          default: makeModule("bad", {
            activate: () => {
              throw new Error("bad activate");
            },
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("good")?.status).toBe("activated");
    expect(byId.get("bad")?.status).toBe("activation-error");
    expect(byId.get("bad")?.diagnostics[0]?.code).toBe("activation-error");
  });

  it("rejects a batch with duplicate contribution ids and stores nothing", async () => {
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "m", state: "active" }]),
      loaderTable: {
        m: async () => ({
          default: makeModule("m", {
            activate: () => ({
              contributions: {
                routes: [
                  {
                    kind: "route",
                    id: "dup",
                    moduleId: "m",
                    requiredOperations: [],
                    routeRef: createRouteRef("dup"),
                    loader: async () => ({ default: () => null }),
                  },
                  {
                    kind: "route",
                    id: "dup",
                    moduleId: "m",
                    requiredOperations: [],
                    routeRef: createRouteRef("dup"),
                    loader: async () => ({ default: () => null }),
                  },
                ],
              },
            }),
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    // Duplicate is caught by contribution validation in
    // module-loader/loadAndActivate BEFORE the store sees anything.
    expect(snap[0]?.status).toBe("contribution-invalid");
    expect(registry.contributions.size()).toBe(0);
  });

  it("does not accept a synthesized import specifier — loader table is the only entry", async () => {
    // The loaderTable type forbids anything but a `() => Promise<...>`,
    // and the registry never reads config.url / config.path. This test
    // confirms behaviour: an "active" declaration whose id isn't in the
    // table is quarantined as "unknown-module" — no fetch, no import.
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "http://evil/m", state: "active" }]),
      loaderTable: {},
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("unknown");
    expect(snap[0]?.diagnostics[0]?.code).toBe("unknown-module");
  });

  it("never leaks storage/session/adapter into the module context", async () => {
    const registry = new ModuleRegistry();
    let seen: object | null = null;
    await registry.start({
      declarations: buildDeclarations([{ id: "peek", state: "active" }]),
      loaderTable: {
        peek: async () => ({
          default: makeModule("peek", {
            activate: (ctx) => {
              seen = ctx as unknown as object;
            },
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(seen).not.toBeNull();
    const keys = Object.keys(seen ?? {}).sort();
    expect(keys).toEqual(
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
    for (const forbidden of ["session", "adapter", "runtime", "IWXA", "indexedDB", "localStore"]) {
      expect(Object.prototype.hasOwnProperty.call(seen, forbidden)).toBe(false);
    }
  });

  it("silences an unknown-module while still starting the healthy peer", async () => {
    // Sanity: makeManifest is exported for future prompts.
    void makeManifest;
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([
        { id: "healthy", state: "active" },
        { id: "ghost", state: "active" },
      ]),
      loaderTable: { healthy: async () => ({ default: makeModule("healthy") }) },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    const byId = new Map(snap.map((r) => [r.moduleId, r]));
    expect(byId.get("healthy")?.status).toBe("activated");
    expect(byId.get("ghost")?.status).toBe("unknown");
  });
});


  it("snapshots mutable activation contributions so later module mutation cannot corrupt cleanup", async () => {
    const mutable = {
      kind: "route" as const,
      id: "mutable-root",
      moduleId: "mutable",
      requiredOperations: [] as never[],
      routeRef: { id: "mutable-root" },
      loader: async () => ({ default: () => null }),
    };
    const registry = new ModuleRegistry();
    const snap = await registry.start({
      declarations: buildDeclarations([{ id: "mutable", state: "active" }]),
      loaderTable: {
        mutable: async () => ({
          default: makeModule("mutable", {
            activate: () => ({ contributions: { routes: [mutable] } }),
          }),
        }),
      },
      runtime: buildRuntimeView(),
      contextProvider: fakeContextProvider(),
    });
    expect(snap[0]?.status).toBe("activated");
    const stored = registry.contributions.findById("routes", "mutable-root");
    expect(stored?.contribution).not.toBe(mutable);
    expect(Object.isFrozen(stored?.contribution)).toBe(true);

    mutable.id = "changed-after-registration";
    mutable.routeRef.id = "changed-route";
    (mutable.requiredOperations as unknown as string[]).push("t1.putObject");

    expect(registry.contributions.findById("routes", "mutable-root")).not.toBeNull();
    expect(registry.contributions.contributionIdsFor("mutable")).toEqual(["mutable-root"]);
    await registry.stop();
    expect(registry.contributions.size()).toBe(0);
  });
