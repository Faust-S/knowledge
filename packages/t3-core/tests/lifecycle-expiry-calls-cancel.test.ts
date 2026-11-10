// @vitest-environment jsdom
/**
 * PROMPT 35 §4 — client-side expiry of a purge preview must invoke
 * `lifecycle.purge-cancel` so the kernel drops the server-side token.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { waitFor, cleanup, screen, fireEvent } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("purge expiry calls lifecycle.purge-cancel (PROMPT 35 §4)", () => {
  it("cancels the token via the command when preview.expires_at fires", async () => {
    // Short-lived preview so the client-side timer fires quickly.
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-e", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview: makePreview("ws-e", { expiresInMs: 30 }),
    });
    renderTrash(kernel);
    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-e"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-e"));
    await waitFor(() => screen.getByTestId("lifecycle-purge-preview-data"));

    // Wait for the client-side expiry timer to fire.
    await waitFor(
      () => expect(kernel.purgeCancel).toHaveBeenCalledWith("tok-ws-e"),
      { timeout: 2000 },
    );
  });
});
