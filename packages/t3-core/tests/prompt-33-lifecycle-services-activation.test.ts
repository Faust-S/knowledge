// PROMPT 33 §1, §2 — refresh services expose activate/dispose and
// tolerate notify while inactive without throwing.
import { describe, it, expect } from "vitest";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";
import { trashRefreshService } from "@/modules/lifecycle/services/trash-refresh-service";

describe("PROMPT 33 — refresh services activate/dispose", () => {
  it("catalog subscribe throws while inactive and works after activate", () => {
    catalogRefreshService.dispose();
    expect(() => catalogRefreshService.subscribe(() => {})).toThrow();
    catalogRefreshService.activate();
    let seen: string | null = null;
    const off = catalogRefreshService.subscribe((r) => (seen = r));
    catalogRefreshService.notify("hello");
    expect(seen).toBe("hello");
    off();
    catalogRefreshService.dispose();
    // notify while disposed is a no-op, not a throw.
    expect(() => catalogRefreshService.notify("ignored")).not.toThrow();
  });

  it("trash subscribe throws while inactive and works after activate", () => {
    trashRefreshService.dispose();
    expect(() => trashRefreshService.subscribe(() => {})).toThrow();
    trashRefreshService.activate();
    let seen: string | null = null;
    const off = trashRefreshService.subscribe((r) => (seen = r));
    trashRefreshService.notify("boom");
    expect(seen).toBe("boom");
    off();
    trashRefreshService.dispose();
    expect(() => trashRefreshService.notify("ignored")).not.toThrow();
  });
});
