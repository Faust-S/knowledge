/** §1 — Exchange route/nav activates when ANY of the 6 T2 ops is granted. */
import { describe, expect, it } from "vitest";
import { buildExchangeRouteContributions } from "@/modules/exchange/routes";
import { buildExchangeNavigationContributions } from "@/modules/exchange/navigation";
import type { OperationId } from "@/kernel-client";

const OPS: OperationId[] = [
  "t2.exportPreview", "t2.exportPackage", "t2.confirmExport",
  "t2.importPreview", "t2.importCommit", "t2.importCancel",
];

describe("Exchange activation (§1)", () => {
  for (const op of OPS) {
    it(`activates route+nav when only ${op} is granted`, () => {
      const has = (o: OperationId) => o === op;
      expect(buildExchangeRouteContributions(has).length).toBe(1);
      expect(buildExchangeNavigationContributions(has).length).toBe(1);
    });
  }
  it("omits route+nav when no T2 op is granted", () => {
    const has = () => false;
    expect(buildExchangeRouteContributions(has).length).toBe(0);
    expect(buildExchangeNavigationContributions(has).length).toBe(0);
  });
});
