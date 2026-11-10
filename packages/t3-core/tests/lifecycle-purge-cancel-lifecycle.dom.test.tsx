// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { waitFor, cleanup, screen, fireEvent } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("token lifecycle — cancel on unmount and workspace switch", () => {
  it("unmount cancels the active purge token", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-u", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-u"),
    });
    const view = renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-u"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-u"));
    await waitFor(() => expect(kernel.purgePreview).toHaveBeenCalled());
    // Allow the effect that mirrors preview.token → purgeRef to run.
    await waitFor(() => screen.getByTestId("lifecycle-purge-preview-data"));
    view.unmount();
    await waitFor(() => expect(kernel.purgeCancel).toHaveBeenCalledWith("tok-ws-u"));
  });

  it("switching workspaces cancels the prior token", async () => {
    const kernel = makeKernel({
      workspaces: [
        makeWorkspace("ws-a", { deletedAt: "2026-07-02T00:00:00Z" }),
        makeWorkspace("ws-b", { deletedAt: "2026-07-01T00:00:00Z" }),
      ],
      previewImpl: async (input) => makePreview(input.workspace_id),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-a"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-a"));
    await waitFor(() => expect(kernel.purgePreview).toHaveBeenCalledWith({
      workspace_id: "ws-a", acknowledge_no_backup: false,
    }));
    await waitFor(() => screen.getByTestId("lifecycle-purge-preview-data"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-b"));
    await waitFor(() => expect(kernel.purgeCancel).toHaveBeenCalledWith("tok-ws-a"));
  });
});
