import { describe, it, expect } from "vitest";
import lifecycleModule from "@/modules/lifecycle";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import { makeKernel, ALL_LIFECYCLE_OPS } from "./lifecycle/_helpers";

function ctx(kernel: ReturnType<typeof makeKernel>): WorkspaceModuleContext {
  return { kernel } as unknown as WorkspaceModuleContext;
}

describe("lifecycle operation gating (any-of)", () => {
  it("no lifecycle op → no routes, no nav; only the trash-refresh utility command (PROMPT 29 §7)", () => {
    const r = lifecycleModule.activate(ctx(makeKernel({ granted: [] })));
    expect(r.contributions.routes?.length ?? 0).toBe(0);
    expect(r.contributions.navigation?.length ?? 0).toBe(0);
    // `lifecycle.trash.refresh` requires no Runtime ops and always
    // registers so cross-module fanout stays possible even without
    // T1 lifecycle grants.
    const ids = r.contributions.commands?.map((c) => c.id) ?? [];
    expect(ids).toEqual(["lifecycle.trash.refresh"]);
  });

  it("only listWorkspaces → routes + nav surface, kernel-backed commands still gated", () => {
    const r = lifecycleModule.activate(ctx(makeKernel({ granted: ["t1.listWorkspaces"] })));
    expect(r.contributions.routes?.length).toBe(2);
    expect(r.contributions.navigation?.length).toBe(1);
    const ids = r.contributions.commands?.map((c) => c.id) ?? [];
    // No T1-gated command; only the always-available refresh utility.
    expect(ids).toEqual(["lifecycle.trash.refresh"]);
  });

  it("only purgeCancel → module still surfaces; individual commands filtered", () => {
    const r = lifecycleModule.activate(ctx(makeKernel({ granted: ["t1.purgeCancel"] })));
    expect(r.contributions.routes?.length).toBe(2);
    const ids = r.contributions.commands?.map((c) => c.id) ?? [];
    expect(ids).toContain("lifecycle.purge-cancel");
    expect(ids).not.toContain("lifecycle.purge-commit");
    expect(ids).toContain("lifecycle.trash.refresh");
  });

  it("full grant → every command contributed (5 kernel + trash.refresh)", () => {
    const r = lifecycleModule.activate(ctx(makeKernel({ granted: ALL_LIFECYCLE_OPS })));
    expect(r.contributions.commands?.length).toBe(6);
  });
});

