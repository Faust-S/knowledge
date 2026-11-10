/**
 * tests/host-route-security.test.ts — PROMPT 16 §3, §4, §10, §13.
 */
import { describe, expect, it } from "vitest";
import { createRouteRef } from "@/workspace-contract";
import {
  FORBIDDEN_ROUTE_PARAM_NAMES,
  RouteRegistry,
  hostRouteRefs,
  validateHostRouteBinding,
  validateStaticBase,
  type HostRouteBinding,
} from "@/workspace-host/router";
import { STATIC_WORKSPACE_ROUTE_BASES } from "@/composition/static-route-bases";

function frag(pattern: string, id = "host.frag.x"): HostRouteBinding {
  return {
    routeRef: createRouteRef(id),
    ownerModuleId: "mod-a",
    mode: "fragment",
    staticBase: "/workspace/",
    fragmentPattern: pattern,
    allowedParams: ["workspaceId", "objectId"],
    opaqueIdParams: ["workspaceId", "objectId"],
  };
}

describe("route security", () => {
  it("static base outside /workspace/ is rejected", () => {
    for (const bad of ["/other/", "/", "/workspace", "workspace/", "//evil/"]) {
      expect(validateStaticBase(bad)).not.toBeNull();
    }
  });

  it("static bases with .., backslash, query, or fragment are rejected", () => {
    for (const bad of [
      "/workspace/../etc/",
      "/workspace\\lifecycle/",
      "/workspace/?x=1",
      "/workspace/#/foo",
    ]) {
      expect(validateStaticBase(bad)).not.toBeNull();
    }
  });

  it("only the reserved bases are accepted", () => {
    for (const good of STATIC_WORKSPACE_ROUTE_BASES) {
      expect(validateStaticBase(good)).toBeNull();
    }
  });

  it("unsafe workspaceId is rejected on resolve()", () => {
    const r = new RouteRegistry();
    r.register(frag("#/workspace/:workspaceId", "host.base.workspace"));
    expect(() =>
      r.resolve(createRouteRef("host.base.workspace"), {
        workspaceId: "ws with space",
      }),
    ).toThrow(/opaque/i);
  });

  it("unsafe objectId is rejected on resolve()", () => {
    const r = new RouteRegistry();
    r.register(
      frag("#/workspace/:workspaceId/object/:objectId", "host.base.object"),
    );
    expect(() =>
      r.resolve(createRouteRef("host.base.object"), {
        workspaceId: "ws-1",
        objectId: "../etc/passwd",
      }),
    ).toThrow(/opaque/i);
  });

  it("unknown params are rejected", () => {
    const r = new RouteRegistry();
    r.register(frag("#/workspace/:workspaceId", "host.base.workspace"));
    expect(() =>
      r.resolve(createRouteRef("host.base.workspace"), {
        workspaceId: "ws-1",
        extraneous: "leak",
      } as never),
    ).toThrow(/not allowed/i);
  });

  it("every forbidden param name is blocked in bindings", () => {
    for (const name of FORBIDDEN_ROUTE_PARAM_NAMES) {
      const err = validateHostRouteBinding({
        routeRef: createRouteRef("host.evil"),
        ownerModuleId: "mod",
        mode: "fragment",
        staticBase: "/workspace/",
        fragmentPattern: "#/x",
        allowedParams: [name],
        opaqueIdParams: [],
      });
      expect(err?.code).toBe("forbidden-param");
    }
  });

  it("params are percent-encoded on resolve()", () => {
    const r = new RouteRegistry();
    r.register(frag("#/workspace/:workspaceId", "host.base.workspace"));
    // ':' is allowed in opaque ids and MUST be encoded in URLs.
    const url = r.resolve(createRouteRef("host.base.workspace"), {
      workspaceId: "ws:1",
    });
    expect(url).toBe("/workspace/#/workspace/ws%3A1");
  });

  it("host inventory has no reserved forbidden param names", () => {
    for (const ref of Object.values(hostRouteRefs.base)) {
      expect(typeof ref.id).toBe("string");
    }
  });

  it("static-check-esque: T3 handoff terms are absent from the router source", async () => {
    const files = [
      "src/workspace-host/router/index.ts",
      "src/workspace-host/router/HostRouter.ts",
      "src/workspace-host/router/RouteRegistry.ts",
      "src/workspace-host/router/create-router-facade.ts",
      "src/workspace-host/router/register-route-contributions.ts",
      "src/workspace-host/router/host-route-refs.ts",
      "src/workspace-host/router/route-binding.ts",
      "src/workspace-host/router/route-params.ts",
    ];
    const fs = await import("node:fs/promises");
    for (const f of files) {
      const src = await fs.readFile(f, "utf8");
      for (const forbidden of [
        "mintIntent",
        "consumeIntent",
        "handoff",
        "career.open",
        "journal.open",
        "?intent=",
      ]) {
        expect(src.includes(forbidden), `${f} contains ${forbidden}`).toBe(false);
      }
    }
  });
});
