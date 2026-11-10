// @vitest-environment jsdom
/**
 * PROMPT 32 §7 — commit failures are classified by kernel error.code.
 * "expired" | "invalid" | "consumed" | "stale" drop the token and
 * surface `expired`; other codes fall into a recoverable error state.
 *
 * The classifier is not exported, so we exercise the observable
 * ImportView behaviour: after a failing importCommit, the machine
 * state must reflect the correct terminal status.
 */
import { describe, expect, it, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type {
  KernelFacade,
  CommandsFacade,
} from "@/workspace-contract";
import type {
  SecureImportPreview,
  ImportPreview,
} from "@/kernel-client/contracts/v1";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";

const preview: ImportPreview = {
  totals: { files: 0, workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  workspaces: [
    { workspace_id: "a", exists_locally: false, incoming_objects: 0,
      incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
  ],
  schemas: [], objects: [], conflicts: [], unsupported: [], warnings: [],
} as unknown as ImportPreview;

function secure(exp = new Date(Date.now() + 60_000).toISOString()): SecureImportPreview {
  return {
    preview_token: "tok", package_digest: "d", semantic_digest: "sd",
    expires_at: exp, allowed_modes: ["selective"], preview,
  };
}

function makeFile(): File {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" });
  return new File([blob], "p.iwxa", { type: "application/octet-stream" });
}

function makeKernel(
  commitError: unknown,
  ops = ["t2.importPreview", "t2.importCommit", "t2.importCancel"],
): KernelFacade {
  return {
    hasOperation: (op: string) => ops.includes(op),
    importPreview: vi.fn(async () => secure()),
    importCommit: vi.fn(async () => { throw commitError; }),
    importCancel: vi.fn(async () => undefined),
    listWorkspaces: vi.fn(async () => []),
  } as unknown as KernelFacade;
}

const commands: CommandsFacade = {
  has: () => false,
  invoke: async () => undefined,
};

async function driveCommit(kernel: KernelFacade) {
  const { container } = render(<ImportView kernel={kernel} commands={commands} />);
  const fileInput = container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
  await act(async () => {
    Object.defineProperty(fileInput, "files", { value: [makeFile()], configurable: true });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  // Wait a microtask for the preview promise to settle.
  await act(async () => { await Promise.resolve(); });
  const commit = container.querySelector<HTMLButtonElement>("[data-testid='import-commit']")!;
  await act(async () => {
    commit.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

describe("import error codes (PROMPT 32 §7)", () => {
  afterEach(cleanup);

  it("PREVIEW_EXPIRED ⇒ expired terminal state", async () => {
    const kernel = makeKernel({ code: "PREVIEW_EXPIRED" });
    const c = await driveCommit(kernel);
    const view = c.querySelector("[data-testid='import-view']") as HTMLElement;
    expect(view.getAttribute("data-import-state")).toBe("expired");
  });

  it("PLAN_NOT_IN_PREVIEW ⇒ plan error, not expired (token dropped)", async () => {
    const kernel = makeKernel({ code: "PLAN_NOT_IN_PREVIEW" });
    const c = await driveCommit(kernel);
    const view = c.querySelector("[data-testid='import-view']") as HTMLElement;
    expect(view.getAttribute("data-import-state")).toBe("error");
    expect(c.querySelector("[data-testid='import-error']")?.textContent).toContain("PLAN_NOT_IN_PREVIEW");
    expect(c.querySelector("[data-testid='import-expired']")).toBeNull();
  });

  it("LOCK_UNAVAILABLE ⇒ recoverable preview-ready state (not expired)", async () => {
    const kernel = makeKernel({ code: "LOCK_UNAVAILABLE", message: "locked" });
    const c = await driveCommit(kernel);
    const view = c.querySelector("[data-testid='import-view']") as HTMLElement;
    expect(view.getAttribute("data-import-state")).toBe("preview-ready");
  });
});

import { afterEach } from "vitest";
