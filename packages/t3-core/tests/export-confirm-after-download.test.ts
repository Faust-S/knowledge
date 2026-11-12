// @vitest-environment jsdom
/** PROMPT 31 §5 — confirmExport only after download-initiated; uses packageSnapshot.workspaces. */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ExportView } from "@/modules/exchange/features/packages/ExportView";
import type { KernelFacade } from "@/workspace-contract";
import type { WorkspaceRecord } from "@/kernel-client";

const preview = {
  workspaces: ["a"],
  counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  approx_bytes: 0,
  summary: {
    included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    scope_mode: "workspace",
  },
  unsupported: [], conflicts: [],
};

const artifact = {
  filename: "a.iwxa",
  bytes: new Uint8Array([1, 2, 3]),
  size: 3,
  package_digest: "digest-xyz",
  semantic_digest: "sd",
  manifest: {
    format: "iwxa.package",
    format_version: "1.0",
    encryption: "none",
    created_at: "2026-01-01T00:00:00Z",
    workspaces: ["a"],
    workspace_states: [{ workspace_id: "a", updated_at: "2026-01-01T00:00:00Z" }],
    options: { include_history: true, include_assets: true, include_relations: true, include_schemas: true },
    counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    files: [],
    package_digest: "digest-xyz",
    semantic_digest: "sd",
  },
  validation: {
    format: "iwxa.package.validation",
    ok: true,
    checked_at: "2026-01-01T00:00:00Z",
    file_count: 0,
    object_count: 0,
    schema_issues: [],
    path_issues: [],
  },
  summary: preview.summary,
};

async function waitForExportState(expected: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("export-view").getAttribute("data-export-state")).toBe(expected);
  });
}

async function waitForEnabledButton(testId: string): Promise<HTMLButtonElement> {
  let button!: HTMLButtonElement;
  await waitFor(() => {
    button = screen.getByTestId(testId) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
  return button;
}

function makeKernel(): KernelFacade {
  return {
    hasOperation: () => true,
    listWorkspaces: () => Promise.resolve([
      { workspace_id: "a", profile: "generic", deleted_at: null } as unknown as WorkspaceRecord,
    ]),
    exportPreview: vi.fn().mockResolvedValue(preview),
    exportPackage: vi.fn().mockResolvedValue(artifact),
    confirmExport: vi.fn().mockResolvedValue({
      confirmed_at: "2026-01-01T00:00:00Z",
      package_digest: "digest-xyz",
      workspace_ids: ["a"],
      confirmations: 1,
    }),
  } as unknown as KernelFacade;
}

describe("Export confirm after download (§5)", () => {
  it("does not call confirmExport before download", async () => {
    const kernel = makeKernel();
    render(createElement(ExportView, { kernel }));
    await waitForExportState("ready");
    await act(async () => { fireEvent.click(await waitForEnabledButton("export-preview")); });
    await waitForExportState("preview-ready");
    expect(screen.queryByTestId("export-preview-result")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("export-ack-sensitive")); });
    await act(async () => { fireEvent.click(await waitForEnabledButton("export-package")); });
    await waitForExportState("package-ready");
    expect(screen.queryByTestId("export-artifact")).toBeTruthy();

    // Force-click confirm before download.
    const btn = screen.getByTestId("export-confirm") as HTMLButtonElement;
    btn.disabled = false;
    await act(async () => { fireEvent.click(btn); });

    expect(kernel.confirmExport).not.toHaveBeenCalled();
  });

  it("confirmExport uses the workspace set proven by the package snapshot and matching manifest", async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    try {
      const kernel = makeKernel();
      render(createElement(ExportView, { kernel }));
      await waitForExportState("ready");
      await act(async () => { fireEvent.click(await waitForEnabledButton("export-preview")); });
      await waitForExportState("preview-ready");
      expect(screen.queryByTestId("export-preview-result")).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByTestId("export-ack-sensitive")); });
    await act(async () => { fireEvent.click(await waitForEnabledButton("export-package")); });
      await waitForExportState("package-ready");
      expect(screen.queryByTestId("export-artifact")).toBeTruthy();
      await act(async () => { fireEvent.click(await waitForEnabledButton("export-download")); });
      await waitForExportState("download-initiated");
      // Starting a download does not establish that the file was actually saved.
      const premature = screen.getByTestId("export-confirm") as HTMLButtonElement;
      expect(premature.disabled).toBe(true);
      premature.disabled = false;
      await act(async () => { fireEvent.click(premature); });
      expect(kernel.confirmExport).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(screen.getByTestId("export-confirm-saved-file")); });
      await act(async () => { fireEvent.click(await waitForEnabledButton("export-confirm")); });
      await waitForExportState("confirmed");

      expect(kernel.confirmExport).toHaveBeenCalledTimes(1);
      const call = (kernel.confirmExport as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
        package_digest: string;
        workspace_ids: string[];
      };
      expect(call.package_digest).toBe("digest-xyz");
      expect(call.workspace_ids).toEqual(["a"]);
      expect(artifact.manifest.workspaces).toEqual(["a"]);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
