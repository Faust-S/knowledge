// @vitest-environment jsdom
/** §1 — Exchange home route unlocks when any T2 op is granted. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ExchangeHomeRoute from "@/modules/exchange/routes/ExchangeHomeRoute";
import type { OperationId } from "@/kernel-client";

vi.mock("@/workspace-host/rendering/ModuleRenderContext", () => ({
  useWorkspaceModuleRuntime: () => ({
    context: {
      kernel: {
        hasOperation: (op: OperationId) => op === "t2.importCancel",
        listWorkspaces: () => Promise.resolve([]),
      },
    },
  }),
}));

vi.mock("@/modules/exchange/features/packages/PackagesView", () => ({
  PackagesView: () => <div data-testid="packages-view" />,
}));

describe("Exchange home gating (§1)", () => {
  it("shows PackagesView when only importCancel is granted", () => {
    render(<ExchangeHomeRoute />);
    expect(screen.getByTestId("packages-view")).toBeTruthy();
  });
});
