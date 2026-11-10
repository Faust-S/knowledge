// @vitest-environment jsdom
/** PROMPT 31 §4 — Blob URL is NOT revoked immediately after click. */
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
  package_digest: "d",
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
    package_digest: "d",
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

function makeKernel(): KernelFacade {
  return {
    hasOperation: () => true,
    listWorkspaces: () => Promise.resolve([
      { workspace_id: "a", profile: "generic", deleted_at: null } as unknown as WorkspaceRecord,
    ]),
    exportPreview: vi.fn().mockResolvedValue(preview),
    exportPackage: vi.fn().mockResolvedValue(artifact),
    confirmExport: vi.fn(),
  } as unknown as KernelFacade;
}

describe("Export blob URL lifecycle (§4)", () => {
  it("does not revoke the object URL immediately after click", async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((_b: Blob) => {
      const u = `blob:mock-${created.length}`;
      created.push(u);
      return u;
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); }) as unknown as typeof URL.revokeObjectURL;

    try {
      const kernel = makeKernel();
      render(createElement(ExportView, { kernel }));
      await waitFor(() => screen.getByTestId("export-preview"));
      await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
      await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());
      await act(async () => { fireEvent.click(screen.getByTestId("export-package")); });
      await waitFor(() => expect(screen.queryByTestId("export-artifact")).toBeTruthy());
      await act(async () => { fireEvent.click(screen.getByTestId("export-download")); });

      expect(created.length).toBe(1);
      // The URL just created must NOT be revoked synchronously.
      expect(revoked.includes(created[0])).toBe(false);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});
