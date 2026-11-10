// @vitest-environment jsdom
// PROMPT 33 §6, §7 — Base surfaces expose "В корзину" and invoke the
// lifecycle command instead of touching kernel.softDeleteWorkspace.
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import { WorkspaceCard } from "@/modules/base/features/workspaces/WorkspaceCard";

afterEach(() => cleanup());

function baseKernel(ops: readonly string[] = []): KernelFacade {
  const set = new Set(ops);
  return { hasOperation: (op: string) => set.has(op) } as unknown as KernelFacade;
}

function baseCommands(has: (id: string) => boolean, invoke = vi.fn(async () => undefined)): CommandsFacade {
  return { has, invoke } as unknown as CommandsFacade;
}

const workspaceItem = {
  workspace: {
    workspace_id: "ws-1",
    profile: "generic",
    capabilities: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
} as const;

describe("PROMPT 33 — Base workspace card soft-delete", () => {
  it("hides the trash button when the command is unavailable", () => {
    render(
      <WorkspaceCard
        item={workspaceItem}
        activeProfileId="generic"
        activeProfileLabel="Generic"
        kernel={baseKernel()}
        commands={baseCommands(() => false)}
        onOpen={() => {}}
        onExport={() => {}}
      />,
    );
    expect(screen.queryByTestId("workspace-card-soft-delete")).toBeNull();
  });

  it("invokes lifecycle.soft-delete-workspace via commands only", async () => {
    const invoke = vi.fn(async () => undefined);
    const has = (id: string) => id === "lifecycle.soft-delete-workspace";
    render(
      <WorkspaceCard
        item={workspaceItem}
        activeProfileId="generic"
        activeProfileLabel="Generic"
        kernel={baseKernel()}
        commands={baseCommands(has, invoke)}
        onOpen={() => {}}
        onExport={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("workspace-card-soft-delete"));
    expect(invoke).toHaveBeenCalledWith(
      "lifecycle.soft-delete-workspace",
      { workspaceId: "ws-1" },
    );
  });
});
