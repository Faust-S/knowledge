/**
 * tests/host-route-registry.test.ts — PROMPT 16 §5.
 */
import { describe, expect, it } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import { RouteRegistry, type HostRouteBinding } from "@/workspace-host/router";

function b(id: string, extra: Partial<HostRouteBinding> = {}): HostRouteBinding {
  return {
    routeRef: createRouteRef(id),
    ownerModuleId: "mod-a",
    mode: "static",
    staticBase: "/workspace/",
    allowedParams: [],
    opaqueIdParams: [],
    ...extra,
  };
}

describe("RouteRegistry", () => {
  it("registers a valid static binding and resolves it", () => {
    const r = new RouteRegistry();
    r.register(b("host.base.home"));
    expect(r.list()).toHaveLength(1);
    expect(r.resolve(createRouteRef("host.base.home"))).toBe("/workspace/");
  });

  it("resolves a fragment binding with opaque params", () => {
    const r = new RouteRegistry();
    r.register(
      b("host.base.workspace", {
        mode: "fragment",
        fragmentPattern: "#/workspace/:workspaceId",
        allowedParams: ["workspaceId"],
        opaqueIdParams: ["workspaceId"],
      }),
    );
    const url = r.resolve(createRouteRef("host.base.workspace"), {
      workspaceId: "ws-1",
    });
    expect(url).toBe("/workspace/#/workspace/ws-1");
  });

  it("refuses duplicate route ref ids", () => {
    const r = new RouteRegistry();
    r.register(b("dup"));
    const result = r.registerMany([b("dup")]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("duplicate-route-ref");
  });

  it("registerMany is atomic — a single bad entry rolls back all", () => {
    const r = new RouteRegistry();
    const result = r.registerMany([
      b("host.ok.a"),
      b("host.ok.b", { staticBase: "/evil/" }),
    ]);
    expect(result.ok).toBe(false);
    expect(r.list()).toHaveLength(0);
  });

  it("removeOwner deletes every binding of the module", () => {
    const r = new RouteRegistry();
    r.registerMany([
      b("host.a.x"),
      b("host.a.y", { routeRef: createRouteRef("host.a.y") }),
      b("host.b.x", { ownerModuleId: "mod-b", routeRef: createRouteRef("host.b.x") }),
    ]);
    r.removeOwner("mod-a");
    expect(r.list().map((x) => x.routeRef.id)).toEqual(["host.b.x"]);
  });

  it("list() returns bindings in registration order", () => {
    const r = new RouteRegistry();
    r.registerMany([b("host.order.a"), b("host.order.b"), b("host.order.c")]);
    expect(r.list().map((x) => x.routeRef.id)).toEqual([
      "host.order.a",
      "host.order.b",
      "host.order.c",
    ]);
  });
});


  it("snapshots RouteRef identity when registering a mutable binding", () => {
    const r = new RouteRegistry();
    const mutableRef = { id: "host.mutable.ref" };
    const binding = b("host.mutable.ref", { routeRef: mutableRef });
    r.register(binding);
    mutableRef.id = "host.changed.ref";
    expect(r.get({ id: "host.mutable.ref" })?.routeRef.id).toBe("host.mutable.ref");
    expect(Object.isFrozen(r.get({ id: "host.mutable.ref" })?.routeRef)).toBe(true);
  });
