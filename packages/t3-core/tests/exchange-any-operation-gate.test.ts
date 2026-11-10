/** PROMPT 31 §1 — Exchange gate: any single T2 op activates route+nav. */
import { describe, expect, it } from "vitest";
import { buildExchangeRouteContributions } from "@/modules/exchange/routes";
import { buildExchangeNavigationContributions } from "@/modules/exchange/navigation";
import type { OperationId } from "@/kernel-client";

describe("Exchange any-operation gate (§1)", () => {
  it("activates route+nav when only t2.importPreview is granted", () => {
    const has = (o: OperationId) => o === "t2.importPreview";
    const routes = buildExchangeRouteContributions(has);
    const navs = buildExchangeNavigationContributions(has);
    expect(routes.length).toBe(1);
    expect(navs.length).toBe(1);
    // The contribution itself must not gate on any operation — inner
    // buttons check per-op.
    expect(routes[0].requiredOperations.length).toBe(0);
    expect(navs[0].requiredOperations.length).toBe(0);
  });

  it("omits both when no T2 op is granted", () => {
    const has = () => false;
    expect(buildExchangeRouteContributions(has).length).toBe(0);
    expect(buildExchangeNavigationContributions(has).length).toBe(0);
  });
});
