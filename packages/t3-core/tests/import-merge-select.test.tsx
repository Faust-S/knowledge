// @vitest-environment jsdom
/**
 * PROMPT 32 §4 — For mode "merge", the target_workspace picker is a
 * <select> populated from local, non-read-only workspaces returned by
 * kernel.listWorkspaces. No free-text input is allowed.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import type { KernelFacade, CommandsFacade } from "@/workspace-contract";
import type {
  SecureImportPreview,
  ImportPreview,
} from "@/kernel-client/contracts/v1";
import type { WorkspaceRecord } from "@/kernel-client";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";

const preview: ImportPreview = {
  totals: { files: 0, workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  workspaces: [{ workspace_id: "src", exists_locally: false, incoming_objects: 0,
    incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
} as unknown as ImportPreview;

const secure: SecureImportPreview = {
  preview_token: "t", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["merge"], preview,
};

const local: WorkspaceRecord[] = [
  { workspace_id: "writable-a", profile: "generic", schema_version: "1.0.0",
    created_at: "", updated_at: "", created_by_service: "s", updated_by_service: "s",
    read_only: false } as unknown as WorkspaceRecord,
  { workspace_id: "readonly-b", profile: "generic", schema_version: "1.0.0",
    created_at: "", updated_at: "", created_by_service: "s", updated_by_service: "s",
    read_only: true } as unknown as WorkspaceRecord,
];

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };

describe("merge target select (PROMPT 32 §4)", () => {
  afterEach(cleanup);

  it("renders a <select> populated with writable local workspaces only", async () => {
    const kernel = {
      hasOperation: (op: string) =>
        ["t2.importPreview", "t2.importCommit", "t2.importCancel", "t1.listWorkspaces"].includes(op),
      importPreview: vi.fn(async () => secure),
      importCancel: vi.fn(async () => undefined),
      listWorkspaces: vi.fn(async () => local),
    } as unknown as KernelFacade;

    const r = render(<ImportView kernel={kernel} commands={commands} />);
    const file = r.container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
    const f = new File([new Blob([new Uint8Array([1])])], "p.iwxa");
    await act(async () => {
      Object.defineProperty(file, "files", { value: [f], configurable: true });
      file.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const target = r.container.querySelector<HTMLSelectElement>(
      "[data-testid='import-target-workspace']",
    );
    expect(target).not.toBeNull();
    expect(target!.tagName).toBe("SELECT");

    const values = Array.from(target!.querySelectorAll("option")).map((o) => o.value);
    expect(values).toContain("writable-a");
    expect(values).not.toContain("readonly-b");

    await act(async () => {
      fireEvent.change(target!, { target: { value: "writable-a" } });
    });
    expect(target!.value).toBe("writable-a");
  });
});
