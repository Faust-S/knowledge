// @vitest-environment jsdom
/** PROMPT 31 §3 — invalid PackageArtifact must be rejected, no download link. */
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

function makeKernel(badArtifact: unknown): KernelFacade {
  return {
    hasOperation: () => true,
    listWorkspaces: () => Promise.resolve([
      { workspace_id: "a", profile: "generic", deleted_at: null } as unknown as WorkspaceRecord,
    ]),
    exportPreview: vi.fn().mockResolvedValue(preview),
    exportPackage: vi.fn().mockResolvedValue(badArtifact),
    confirmExport: vi.fn(),
  } as unknown as KernelFacade;
}

describe("Export artifact validation (§3)", () => {
  it("rejects artifact with wrong extension and no artifact appears", async () => {
    const bad = {
      filename: "a.zip", // wrong ext
      bytes: new Uint8Array([1, 2, 3]),
      size: 3,
      package_digest: "d",
      semantic_digest: "sd",
      manifest: { workspaces: ["a"] },
      validation: {},
      summary: {},
    };
    const kernel = makeKernel(bad);
    render(createElement(ExportView, { kernel }));
    await waitFor(() => screen.getByTestId("export-preview"));
    await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
    await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("export-package")); });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeTruthy());
    expect(screen.queryByTestId("export-artifact")).toBeNull();
  });

  it("rejects artifact when size mismatches bytes.byteLength", async () => {
    const bad = {
      filename: "a.iwxa",
      bytes: new Uint8Array([1, 2, 3]),
      size: 999, // lies
      package_digest: "d",
      semantic_digest: "sd",
      manifest: { workspaces: ["a"] },
      validation: {},
      summary: {},
    };
    const kernel = makeKernel(bad);
    render(createElement(ExportView, { kernel }));
    await waitFor(() => screen.getByTestId("export-preview"));
    await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
    await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("export-package")); });

    await waitFor(() => expect(screen.queryByRole("alert")).toBeTruthy());
    expect(screen.queryByTestId("export-artifact")).toBeNull();
  });
});


describe("Export artifact authority binding", () => {
  const valid = {
  filename: "a.iwxa",
  bytes: new Uint8Array([1, 2, 3]),
  size: 3,
  package_digest: "digest-bound",
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
    package_digest: "digest-bound",
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

  it("rejects a package whose manifest workspace set differs from the selected export snapshot", async () => {
    const kernel = makeKernel({ ...valid, manifest: { ...valid.manifest, workspaces: ["other"] } });
    render(createElement(ExportView, { kernel }));
    await waitFor(() => screen.getByTestId("export-preview"));
    await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
    await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("export-package")); });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeTruthy());
    expect(screen.queryByTestId("export-artifact")).toBeNull();
  });

  it("rejects validation.ok=false and digest drift between artifact and manifest", async () => {
    for (const bad of [
      { ...valid, validation: { ...valid.validation, ok: false } },
      { ...valid, manifest: { ...valid.manifest, package_digest: "different" } },
    ]) {
      const kernel = makeKernel(bad);
      const rendered = render(createElement(ExportView, { kernel }));
      await waitFor(() => screen.getByTestId("export-preview"));
      await act(async () => { fireEvent.click(screen.getByTestId("export-preview")); });
      await waitFor(() => expect(screen.queryByTestId("export-preview-result")).toBeTruthy());
      await act(async () => { fireEvent.click(screen.getByTestId("export-package")); });
      await waitFor(() => expect(screen.queryByRole("alert")).toBeTruthy());
      expect(screen.queryByTestId("export-artifact")).toBeNull();
      rendered.unmount();
    }
  });
});
