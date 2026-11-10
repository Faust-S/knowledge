// @vitest-environment jsdom
/**
 * PROMPT 32 §1 — After a successful importCommit, ImportView invokes
 * `workspace.catalog.refresh` through the commands facade with
 * reason="import.committed". A refresh failure MUST NOT surface as an
 * import error.
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

const secure: SecureImportPreview = {
  preview_token: "tok", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective"], preview,
};

function kernelOk(): KernelFacade {
  return {
    hasOperation: (op: string) =>
      ["t2.importPreview", "t2.importCommit", "t2.importCancel"].includes(op),
    importPreview: vi.fn(async () => secure),
    importCommit: vi.fn(async () => ({
      import_id: "i1", mode: "selective", conflict_policy: "fail",
      committed_at: "2026-07-25T00:00:00Z", package_digest: "d", semantic_digest: "sd",
      applied: { objects_inserted: 0, objects_updated: 0, objects_skipped: 0, events: 0 },
    })),
    importCancel: vi.fn(async () => undefined),
    listWorkspaces: vi.fn(async () => []),
  } as unknown as KernelFacade;
}

function makeFile(): File {
  return new File([new Blob([new Uint8Array([1])])], "p.iwxa");
}

async function drive(kernel: KernelFacade, commands: CommandsFacade) {
  const r = render(<ImportView kernel={kernel} commands={commands} />);
  const file = r.container.querySelector<HTMLInputElement>("[data-testid='import-file']")!;
  await act(async () => {
    Object.defineProperty(file, "files", { value: [makeFile()], configurable: true });
    file.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
  const commit = r.container.querySelector<HTMLButtonElement>("[data-testid='import-commit']")!;
  await act(async () => {
    commit.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return r.container;
}

describe("import.committed → commands.invoke (PROMPT 32 §1)", () => {
  afterEach(cleanup);

  it("invokes workspace.catalog.refresh with reason=import.committed", async () => {
    const invoke = vi.fn(async () => undefined);
    const commands: CommandsFacade = {
      has: (id) => id === "workspace.catalog.refresh",
      invoke,
    };
    const c = await drive(kernelOk(), commands);
    expect(invoke).toHaveBeenCalledWith("workspace.catalog.refresh", {
      reason: "import.committed",
    });
    expect(c.querySelector("[data-testid='import-receipt']")).not.toBeNull();
  });

  it("a refresh failure does not surface as an import error", async () => {
    const commands: CommandsFacade = {
      has: () => true,
      invoke: async () => { throw new Error("catalog boom"); },
    };
    const c = await drive(kernelOk(), commands);
    expect(c.querySelector("[data-testid='import-receipt']")).not.toBeNull();
    expect(c.querySelector("[data-testid='import-error']")).toBeNull();
  });

  it("skips the invocation when the command is not registered", async () => {
    const invoke = vi.fn(async () => undefined);
    const commands: CommandsFacade = { has: () => false, invoke };
    await drive(kernelOk(), commands);
    expect(invoke).not.toHaveBeenCalled();
  });
});
