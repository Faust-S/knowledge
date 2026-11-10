// @vitest-environment jsdom
/**
 * PROMPT 35 §3 — LOCK_UNAVAILABLE is retryable: preview stays,
 * challenge input is preserved, no cancel of the token.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { waitFor, cleanup, screen, fireEvent } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("lock retry (PROMPT 35 §3)", () => {
  it("keeps preview and input on LOCK_UNAVAILABLE", async () => {
    const preview = makePreview("ws-l");
    const commit = vi.fn(async () => {
      throw { code: "LOCK_UNAVAILABLE", message: "busy" };
    });
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-l", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview,
      commitImpl: commit as never,
    });
    renderTrash(kernel);

    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-l"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-l"));
    await waitFor(() => screen.getByTestId("lifecycle-purge-preview-data"));

    const input = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: preview.challenge } });
    fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));

    await waitFor(() => expect(commit).toHaveBeenCalled());
    // Preview still present.
    expect(screen.getByTestId("lifecycle-purge-preview-data")).toBeTruthy();
    // Challenge input retained (clearInput: false).
    await waitFor(() => {
      const el = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
      expect(el.value).toBe(preview.challenge);
    });
    // Live token was not cancelled — the retry is client-side only.
    expect(kernel.purgeCancel).not.toHaveBeenCalled();
  });
});
