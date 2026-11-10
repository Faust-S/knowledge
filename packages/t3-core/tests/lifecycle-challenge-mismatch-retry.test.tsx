// @vitest-environment jsdom
/**
 * PROMPT 35 §3 — PURGE_CHALLENGE_MISMATCH is retryable: the preview
 * MUST stay, the input MUST clear, and the flow returns to
 * `awaiting-challenge` (no `stale` / `expired` collapse).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { waitFor, cleanup, screen, fireEvent } from "@testing-library/react";
import { makeKernel, makeWorkspace, makePreview, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("challenge mismatch retry (PROMPT 35 §3)", () => {
  it("clears input, keeps preview, does NOT cancel the token", async () => {
    const preview = makePreview("ws-c");
    const commit = vi.fn(async () => {
      throw { code: "PURGE_CHALLENGE_MISMATCH", message: "no match" };
    });
    const kernel = makeKernel({
      workspaces: [makeWorkspace("ws-c", { deletedAt: "2026-07-01T00:00:00Z" })],
      preview,
      commitImpl: commit as never,
    });
    renderTrash(kernel);

    await waitFor(() => screen.getByTestId("lifecycle-purge-open-ws-c"));
    fireEvent.click(screen.getByTestId("lifecycle-purge-open-ws-c"));
    await waitFor(() => screen.getByTestId("lifecycle-purge-preview-data"));

    const input = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: preview.challenge } });
    fireEvent.click(screen.getByTestId("lifecycle-purge-commit"));

    // Preview data still present, dialog still open, and challenge input cleared.
    await waitFor(() => expect(commit).toHaveBeenCalled());
    await waitFor(() => {
      const el = screen.getByTestId("lifecycle-challenge-input") as HTMLInputElement;
      expect(el.value).toBe("");
    });
    expect(screen.getByTestId("lifecycle-purge-preview-data")).toBeTruthy();
    // Text-based `/stale/i` heuristic is gone → no cancel of the live token.
    expect(kernel.purgeCancel).not.toHaveBeenCalled();
  });
});
