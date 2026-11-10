// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import type { ImportPreview, SecureImportPreview } from "@/kernel-client/contracts/v1";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };
const preview = {
  totals: { files: 0, workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  workspaces: [{ workspace_id: "a", exists_locally: false, incoming_objects: 0, incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
} as unknown as ImportPreview;
const secure: SecureImportPreview = {
  preview_token: "tok-1",
  package_digest: "pkg",
  semantic_digest: "sem",
  expires_at: "2099-01-01T00:00:00Z",
  allowed_modes: ["selective"],
  preview,
};

function kernel(cancelResult: boolean): KernelFacade {
  return {
    hasOperation: (op: string) => ["t2.importPreview", "t2.importCommit", "t2.importCancel"].includes(op),
    importPreview: vi.fn(async () => secure),
    importCancel: vi.fn(async () => cancelResult),
    importCommit: vi.fn(),
    listWorkspaces: vi.fn(async () => []),
  } as unknown as KernelFacade;
}

afterEach(() => cleanup());

describe("Import cancel authority", () => {
  it("retains the preview and surfaces an error when Runtime does not confirm cancellation", async () => {
    const k = kernel(false);
    const rendered = render(<ImportView kernel={k} commands={commands} />);
    const input = rendered.container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
    const file = new File([new Uint8Array([1])], "a.iwxa");
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      fireEvent.change(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("import-preview")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("import-cancel"));
      await Promise.resolve();
    });

    expect(k.importCancel).toHaveBeenCalledWith("tok-1");
    expect(screen.queryByTestId("import-preview")).toBeTruthy();
    expect(screen.getByTestId("import-error").textContent).toContain("IMPORT_CANCEL_NOT_CONFIRMED");
    expect(screen.getByTestId("import-view").getAttribute("data-import-state")).toBe("preview-ready");
  });

  it("clears the preview only after Runtime confirms cancellation", async () => {
    const k = kernel(true);
    const rendered = render(<ImportView kernel={k} commands={commands} />);
    const input = rendered.container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
    const file = new File([new Uint8Array([1])], "a.iwxa");
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      fireEvent.change(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("import-preview")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByTestId("import-cancel"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("import-view").getAttribute("data-import-state")).toBe("cancelled"));
    expect(screen.queryByTestId("import-preview")).toBeNull();
  });
});
