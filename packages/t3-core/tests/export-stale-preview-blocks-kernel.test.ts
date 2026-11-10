// @vitest-environment jsdom
/** PROMPT 31 §2 — stale preview must never invoke kernel.exportPackage. */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ExportView } from "@/modules/exchange/features/packages/ExportView";
import type { KernelFacade } from "@/workspace-contract";
import type { WorkspaceRecord } from "@/kernel-client";

function makeKernel(): KernelFacade {
  return {
    hasOperation: () => true,
    listWorkspaces: () =>
      Promise.resolve([
        { workspace_id: "a", profile: "generic", deleted_at: null } as unknown as WorkspaceRecord,
      ]),
    exportPreview: vi.fn().mockResolvedValue({
      workspaces: ["a"],
      counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
      approx_bytes: 0,
      summary: {
        included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
        excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
        scope_mode: "workspace",
      },
      unsupported: [], conflicts: [],
    }),
    exportPackage: vi.fn(),
    confirmExport: vi.fn(),
  } as unknown as KernelFacade;
}

describe("Export stale preview (§2)", () => {
  it("does not call exportPackage when selection changed after preview", async () => {
    const kernel = makeKernel();
    render(createElement(ExportView, { kernel }));

    await waitFor(() => expect(screen.getByTestId("export-preview-result")).toBeFalsy(), { timeout: 100 }).catch(() => {});

    await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
    await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());

    // Toggle a selection option — invalidates preview snapshot.
    await act(async () => { fireEvent.click(screen.getByTestId("export-include_history")); });

    // Force-click the package button even if disabled.
    const btn = screen.getByTestId("export-package") as HTMLButtonElement;
    btn.disabled = false;
    await act(async () => { fireEvent.click(btn); });

    expect(kernel.exportPackage).not.toHaveBeenCalled();
  });
});
