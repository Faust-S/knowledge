// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { waitFor, cleanup } from "@testing-library/react";
import { makeKernel, makeWorkspace, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("trash loader does not do N+1 getWorkspace calls", () => {
  it("never calls getWorkspace even with many deleted rows", async () => {
    const kernel = makeKernel({
      workspaces: Array.from({ length: 25 }, (_, i) =>
        makeWorkspace(`ws-${i}`, { deletedAt: `2026-07-${(i % 28) + 1}T00:00:00Z` }),
      ),
    });
    renderTrash(kernel);
    await waitFor(() => expect(kernel.listWorkspaces).toHaveBeenCalled());
    expect(kernel.getWorkspace).not.toHaveBeenCalled();
  });
});
