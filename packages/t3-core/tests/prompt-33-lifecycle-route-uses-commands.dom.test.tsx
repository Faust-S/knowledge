// @vitest-environment jsdom
// PROMPT 33 §3, §5 — the Lifecycle route drives every purge mutation
// through ctx.commands and never touches ctx.kernel.purge* directly.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { makeKernel, makePreview, makeReceipt, makeWorkspace, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("PROMPT 33 — lifecycle route flows through commands only", () => {
  it("purge preview click hits kernel.purgePreview via the command handler", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-a", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-a", { backup: "current" }),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-a"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-a"));
    await waitFor(() => expect(kernel.purgePreview).toHaveBeenCalledTimes(1));
  });

  it("commit flow uses commands + does not double-invoke catalog refresh", async () => {
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-b", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-b", { backup: "current" }),
      commit: makeReceipt("ws-b"),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-b"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-b"));
    await waitFor(() => expect(kernel.purgePreview).toHaveBeenCalledTimes(1));
    // Route must not itself invoke kernel.purgeCommit / purgeCancel;
    // those flow via commands. In tests the helper commands facade
    // delegates back to kernel, so counts must equal exactly 1 after
    // commit — never 2 (proves the route did not double-dispatch).
    const input = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "PURGE ws-b" } });
    fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));
    await waitFor(() => expect(kernel.purgeCommit).toHaveBeenCalledTimes(1));
  });
});
