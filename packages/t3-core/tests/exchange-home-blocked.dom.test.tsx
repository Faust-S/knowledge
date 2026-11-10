// @vitest-environment jsdom
/** §1 — Exchange home renders operation-not-granted when no T2 ops are present. */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ExchangeHomeRoute from "@/modules/exchange/routes/ExchangeHomeRoute";

vi.mock("@/workspace-host/rendering/ModuleRenderContext", () => ({
  useWorkspaceModuleRuntime: () => ({
    context: {
      kernel: {
        hasOperation: () => false,
        listWorkspaces: () => Promise.resolve([]),
      },
    },
  }),
}));

describe("Exchange home blocked (§1)", () => {
  it("shows operation-not-granted panel", () => {
    render(<ExchangeHomeRoute />);
    expect(screen.getByTestId("operation-not-granted")).toBeTruthy();
  });
});
