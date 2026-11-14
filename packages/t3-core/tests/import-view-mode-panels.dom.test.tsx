// @vitest-environment jsdom
/** §11 — merge target and new-workspace map panels appear conditionally. */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import type { SecureImportPreview } from "@/kernel-client/contracts/v1";

const secure: SecureImportPreview = {
  preview_token: "tok", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective", "merge", "new-workspace"],
  preview: {
    workspaces: [{ workspace_id: "src-a", exists_locally: false,
      incoming_objects: 0, incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
    totals: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    objects: [], conflicts: [], unsupported: [], warnings: [],
  } as unknown as SecureImportPreview["preview"],
};

function kernel(preview: SecureImportPreview = secure): KernelFacade {
  return {
    hasOperation: () => true,
    importPreview: vi.fn(async () => preview),
    importCommit: vi.fn(),
    importCancel: vi.fn(async () => {}),
    listWorkspaces: vi.fn(async () => []),
  } as unknown as KernelFacade;
}

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };

async function primePreview(preview: SecureImportPreview = secure) {
  const k = kernel(preview);
  const { container } = render(<ImportView kernel={k} commands={commands} />);
  const input = container.querySelector('input[type="file"]')!;
  const file = new File([new Uint8Array([1])], "a.iwxa");
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
  // wait for preview
  await screen.findByTestId("import-mode");
  return { k };
}

describe("Import UI mode panels (§11)", () => {
  it("displays the exact original Kernel incompatibilities instead of an empty heading", async () => {
    const preview = {
      ...secure,
      preview: {
        ...secure.preview,
        schemas: [{ schema_id: "domain:invoice", schema_version: "1.0.0",
          object_count: 1, status: "missing" }],
        unsupported: [
          { kind: "unknown_schema", schema_id: "unknown:invoice",
            schema_version: "2.0.0", object_count: 4 },
          { kind: "extension_field", path: "data.extra", sample: "private-value" },
        ],
      },
    } as SecureImportPreview;
    await primePreview(preview);
    const status = screen.getByTestId("import-incompatible-schemas").textContent ?? "";
    expect(status).toContain("domain:invoice@1.0.0");
    const unsupported = screen.getByTestId("import-unsupported").textContent ?? "";
    expect(unsupported).toContain("unknown:invoice@2.0.0");
    expect(unsupported).toContain("data.extra");
    expect(unsupported).not.toContain("private-value");
    expect((screen.getByTestId("import-commit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows merge target panel when merge selected", async () => {
    await primePreview();
    fireEvent.change(screen.getByTestId("import-mode"), { target: { value: "merge" } });
    expect(screen.getByTestId("import-merge-target")).toBeTruthy();
  });
  it("shows workspace_id_map inputs when new-workspace selected", async () => {
    await primePreview();
    fireEvent.change(screen.getByTestId("import-mode"), { target: { value: "new-workspace" } });
    expect(screen.getByTestId("import-ws-map")).toBeTruthy();
    const inp = screen.getByTestId("import-ws-map-src-a") as HTMLInputElement;
    expect(inp.value).toBe("src-a-imported");
  });
});
