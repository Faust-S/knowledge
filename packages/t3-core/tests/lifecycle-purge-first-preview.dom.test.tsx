// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("first purge preview never sets acknowledge_no_backup: true", () => {
  it("initial preview uses acknowledge_no_backup: false", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-x", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-x", { backup: "current" }),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-x"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-x"));
    await waitFor(() => expect(kernel.purgePreview).toHaveBeenCalled());
    expect(kernel.purgePreview).toHaveBeenCalledWith({
      workspace_id: "ws-x",
      acknowledge_no_backup: false,
    });
  });
});
