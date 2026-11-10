// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { waitFor, cleanup } from "@testing-library/react";
import { makeKernel, makeWorkspace, renderTrash } from "./lifecycle/_helpers";

afterEach(() => cleanup());

describe("trash loader includes deleted", () => {
  it("calls listWorkspaces({ include_deleted: true }) on mount", async () => {
    const kernel = makeKernel({
      workspaces: [
        makeWorkspace("ws-a", { deletedAt: "2026-07-01T00:00:00Z" }),
        makeWorkspace("ws-b"),
      ],
    });
    renderTrash(kernel);
    await waitFor(() => {
      expect(kernel.listWorkspaces).toHaveBeenCalledWith({ include_deleted: true });
    });
  });
});
