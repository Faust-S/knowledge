// @vitest-environment jsdom
/** PROMPT 34 §6 — user can select an individual object key in selective mode. */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportView } from "@/modules/exchange/features/packages/ImportView";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import type { SecureImportPreview } from "@/kernel-client/contracts/v1";

const secure: SecureImportPreview = {
  preview_token: "tok", package_digest: "d", semantic_digest: "sd",
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  allowed_modes: ["selective"],
  preview: {
    workspaces: [{ workspace_id: "ws-a", exists_locally: false,
      incoming_objects: 2, incoming_events: 0, incoming_relations: 0, incoming_assets: 0 }],
    totals: { workspaces: 1, objects: 2, events: 0, relations: 0, assets: 0, schemas: 0 },
    objects: [
      { workspace_id: "ws-a", object_id: "obj-1", schema_id: "s", schema_version: "1.0.0", incoming_revision: 1 },
      { workspace_id: "ws-a", object_id: "obj-2", schema_id: "s", schema_version: "1.0.0", incoming_revision: 1 },
    ],
    conflicts: [], unsupported: [], warnings: [],
  } as unknown as SecureImportPreview["preview"],
};

function kernel(): KernelFacade {
  return {
    hasOperation: () => true,
    importPreview: vi.fn(async () => secure),
    importCommit: vi.fn(),
    importCancel: vi.fn(async () => {}),
    listWorkspaces: vi.fn(async () => []),
  } as unknown as KernelFacade;
}

const commands: CommandsFacade = { has: () => false, invoke: async () => undefined };

describe("Import selective object UI (PROMPT 34 §5)", () => {
  it("lets the user toggle an individual object key", async () => {
    const { container } = render(<ImportView kernel={kernel()} commands={commands} />);
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "a.iwxa")] });
    fireEvent.change(input);
    await screen.findByTestId("import-objects");

    const cb = screen.getByTestId("import-object-ws-a/obj-1") as HTMLInputElement;
    expect(cb.disabled).toBe(false);
    fireEvent.click(cb);
    expect((screen.getByTestId("import-object-ws-a/obj-1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("import-object-ws-a/obj-2") as HTMLInputElement).checked).toBe(false);
  });
});
