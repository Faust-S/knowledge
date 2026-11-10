// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, makeReceipt, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("purge receipt displays normative removed counts", () => {
  it("shows removed.workspaces .. removed.outbox after commit succeeds", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-r", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-r"),
      commit: makeReceipt("ws-r"),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-r"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-r"));
    await waitFor(() => screen.getByTestId("lifecycle-challenge-input"));
    fireEvent.change(screen.getByTestId("lifecycle-challenge-input"), {
      target: { value: "PURGE ws-r" },
    });
    fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));
    const receiptEl = await screen.findByTestId("lifecycle-purge-receipt");
    for (const k of [
      "removed.workspaces", "removed.objects", "removed.events",
      "removed.relations", "removed.assets", "removed.permissions",
      "removed.service_state", "removed.outbox", "workspace_id",
    ]) {
      expect(receiptEl.textContent).toContain(k);
    }
  });
});
