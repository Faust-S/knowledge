import { describe, it, expect } from "vitest";
import { catalogRefreshService } from "@/modules/base/services/catalog-refresh-service";
import { trashRefreshService } from "@/modules/lifecycle/services/trash-refresh-service";

describe("cross-module refresh: independent module-local services", () => {
  it("catalog and trash services do not cross-fire (PROMPT 29 §5, §7)", () => {
    catalogRefreshService.activate();
    trashRefreshService.activate();
    let cat = 0, life = 0;
    catalogRefreshService.subscribe(() => { cat++; });
    trashRefreshService.subscribe(() => { life++; });
    catalogRefreshService.notify("workspace.mutated");
    expect(cat).toBe(1);
    expect(life).toBe(0);
    trashRefreshService.notify("restore.committed");
    expect(cat).toBe(1);
    expect(life).toBe(1);
  });

  it("trash reasons include the three commit events", () => {
    trashRefreshService.activate();
    const seen: string[] = [];
    trashRefreshService.subscribe((r) => { seen.push(r); });
    for (const r of ["soft-delete.committed", "restore.committed", "purge.committed"] as const) {
      trashRefreshService.notify(r);
    }
    expect(seen).toEqual(["soft-delete.committed", "restore.committed", "purge.committed"]);
  });
});
