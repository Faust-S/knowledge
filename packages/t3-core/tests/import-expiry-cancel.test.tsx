// @vitest-environment jsdom
/**
 * PROMPT 32 §6 — when the preview token expires client-side, ImportView
 * clears the local token AND calls kernel.importCancel(token) so the
 * kernel never keeps a dangling preview slot.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { KernelFacade, CommandsFacade } from "@/workspace-contract";
import type { SecureImportPreview, ImportPreview } from "@/kernel-client/contracts/v1";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";

const preview: ImportPreview = {
  totals: { files: 0, workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  workspaces: [{ workspace_id: "a", exists_locally: false, incoming_objects: 0,
    incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
} as unknown as ImportPreview;

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };

describe("import token expiry cancel (PROMPT 32 §6)", () => {
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it("calls importCancel(token) when the client-side expiry fires", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const secure: SecureImportPreview = {
      preview_token: "tok-expiring", package_digest: "d", semantic_digest: "sd",
      expires_at: new Date(Date.now() + 1000).toISOString(),
      allowed_modes: ["selective"], preview,
    };
    const kernel = {
      hasOperation: (op: string) =>
        ["t2.importPreview", "t2.importCommit", "t2.importCancel"].includes(op),
      importPreview: vi.fn(async () => secure),
      importCancel: cancel,
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

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(cancel).toHaveBeenCalledWith("tok-expiring");
    const view = r.container.querySelector("[data-testid='import-view']") as HTMLElement;
    expect(view.getAttribute("data-import-state")).toBe("expired");
  });
});
