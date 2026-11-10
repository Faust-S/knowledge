// @vitest-environment jsdom
/**
 * PROMPT 32 §5 — For mode "new-workspace" the seeded `-imported`
 * mapping is editable per row. Typing in the input MUST update the
 * plan.workspace_id_map for that source workspace and MUST NOT snap
 * back to the seed.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import type { KernelFacade, CommandsFacade } from "@/workspace-contract";
import type { SecureImportPreview, ImportPreview } from "@/kernel-client/contracts/v1";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";

const preview: ImportPreview = {
  totals: { files: 0, workspaces: 2, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  workspaces: [
    { workspace_id: "src-a", exists_locally: false, incoming_objects: 0,
      incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
    { workspace_id: "src-b", exists_locally: false, incoming_objects: 0,
      incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
  ],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
} as unknown as ImportPreview;

const secure: SecureImportPreview = {
  preview_token: "t", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective", "new-workspace"], preview,
};

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };

describe("new-workspace mapping input (PROMPT 32 §5)", () => {
  afterEach(cleanup);

  it("seeds `<id>-imported` and lets the user overwrite each row", async () => {
    const kernel = {
      hasOperation: (op: string) =>
        ["t2.importPreview", "t2.importCommit", "t2.importCancel"].includes(op),
      importPreview: vi.fn(async () => secure),
      importCancel: vi.fn(async () => undefined),
      listWorkspaces: vi.fn(async () => []),
    } as unknown as KernelFacade;

    const r = render(<ImportView kernel={kernel} commands={commands} />);
    const file = r.container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
    const f = new File([new Blob([new Uint8Array([1])])], "p.iwxa");
    await act(async () => {
      Object.defineProperty(file, "files", { value: [f], configurable: true });
      file.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    // Switch to new-workspace mode to trigger seeding.
    const modeSelect = r.container.querySelector<HTMLSelectElement>(
      "[data-testid='import-mode']",
    )!;
    await act(async () => {
      fireEvent.change(modeSelect, { target: { value: "new-workspace" } });
    });

    const inputA = r.container.querySelector<HTMLInputElement>(
      "[data-testid='import-ws-map-src-a']",
    );
    const inputB = r.container.querySelector<HTMLInputElement>(
      "[data-testid='import-ws-map-src-b']",
    );
    expect(inputA).not.toBeNull();
    expect(inputA!.value).toBe("src-a-imported");
    expect(inputB!.value).toBe("src-b-imported");

    await act(async () => {
      fireEvent.change(inputA!, { target: { value: "custom-a" } });
    });

    const afterA = r.container.querySelector<HTMLInputElement>(
      "[data-testid='import-ws-map-src-a']",
    )!;
    const afterB = r.container.querySelector<HTMLInputElement>(
      "[data-testid='import-ws-map-src-b']",
    )!;
    expect(afterA.value).toBe("custom-a");
    expect(afterB.value).toBe("src-b-imported");
  });
});
