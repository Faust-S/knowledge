import { describe, expect, it } from "vitest";
import { resolveProductFirstLanding } from "../src/workspace-host/router/product-first-landing";
import { hostRouteRefs } from "../src/workspace-host/router/host-route-refs";

describe("product-first landing", () => {
  const active = (ref: { id: string }) => ref.id === hostRouteRefs.domain.home.id || ref.id === hostRouteRefs.base.home.id;
  const bare = { pathname: "/workspace/", hash: "" };
  it("opens a trusted compiled domain", () => {
    expect(resolveProductFirstLanding({ enabled: true, location: bare, isActive: active })).toBe(hostRouteRefs.domain.home);
    expect(resolveProductFirstLanding({ enabled: true, location: { pathname: "/workspace/", hash: "#" }, isActive: active })).toBe(hostRouteRefs.domain.home);
  });
  it("preserves bookmarked routes and independent applications", () => {
    for (const location of [{ pathname: "/workspace/", hash: "#/overview" }, { pathname: "/workspace/", hash: "#/domain" }, { pathname: "/workspace/", hash: "#/workspaces" }, { pathname: "/workspace/exchange/", hash: "" }, { pathname: "/workspace/lifecycle/", hash: "#/trash" }]) {
      expect(resolveProductFirstLanding({ enabled: true, location, isActive: active })).toBeNull();
    }
  });
  it("keeps integrated mode and missing-domain fallback", () => {
    expect(resolveProductFirstLanding({ enabled: false, location: bare, isActive: active })).toBeNull();
    expect(resolveProductFirstLanding({ enabled: true, location: bare, isActive: ref => ref.id === hostRouteRefs.base.home.id })).toBe(hostRouteRefs.base.home);
    expect(resolveProductFirstLanding({ enabled: true, location: bare, isActive: () => false })).toBeNull();
  });
});
