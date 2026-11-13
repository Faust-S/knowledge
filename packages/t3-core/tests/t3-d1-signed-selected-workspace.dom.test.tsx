// @vitest-environment jsdom
// The signed first-run path only READS through the existing JIT ModuleContext,
// never provisions or enumerates the unsigned original T2 client.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { KernelFacade } from "@/workspace-contract";
import { SignedSelectedWorkspaceGate } from "@/workspace-host/bootstrap/SignedSelectedWorkspaceGate";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function kernel(rows: unknown[] | Promise<unknown[]>) {
  const listWorkspaces = vi.fn().mockImplementation(() => Promise.resolve(rows));
  const createWorkspace = vi.fn();
  return {
    value: { listWorkspaces, createWorkspace } as unknown as KernelFacade,
    listWorkspaces, createWorkspace,
  };
}
it("a ready signed Workspace is visible only after exact authorized Kernel read", async () => {
  const owner = kernel([{ workspace_id:"ws:organization-a", profile:"generic" }]);
  render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="selected-owner-content">Организация A</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("selected-owner-content");
  expect(owner.listWorkspaces).toHaveBeenCalledTimes(1);
  expect(owner.listWorkspaces).toHaveBeenCalledWith({ include_deleted:false });
  expect(owner.createWorkspace).not.toHaveBeenCalled();
});
it("missing selected Workspace displays concrete preparation step, never unsigned creation", async () => {
  const owner = kernel([]);
  render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="unexpected-content">Не показывать</p>
  </SignedSelectedWorkspaceGate>);
  const text = await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(text.textContent).toMatch(/ещё нет рабочей области/);
  expect(screen.queryByTestId("unexpected-content")).toBeNull();
  expect(owner.createWorkspace).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button",{name:"Проверить повторно"})));
  await waitFor(() => expect(owner.listWorkspaces).toHaveBeenCalledTimes(2));
  expect(owner.createWorkspace).not.toHaveBeenCalled();
});
it("denial cannot render signed children; ordinary site is unaffected", async () => {
  const owner = kernel(Promise.reject(Object.assign(new Error("denied"),{code:"T3_ACCESS_NOT_PERMITTED"})));
  const view = render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(screen.queryByTestId("workspace-visible")).toBeNull();
  view.rerender(<SignedSelectedWorkspaceGate required={false} kernel={owner.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  expect(screen.getByTestId("workspace-visible")).toBeTruthy();
});
it("late read from replaced corporate owner never reveals prior Workspace", async () => {
  let resolveOld!: (rows: unknown[]) => void;
  const oldPromise = new Promise<unknown[]>(resolve => { resolveOld = resolve; });
  const old = kernel(oldPromise);
  const fresh = kernel([]);
  const view = render(<SignedSelectedWorkspaceGate required kernel={old.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  view.rerender(<SignedSelectedWorkspaceGate required kernel={fresh.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  await act(async () => resolveOld([{workspace_id:"ws:previous-organization",profile:"generic"}]));
  expect(screen.queryByTestId("workspace-visible")).toBeNull();
  expect(old.createWorkspace).not.toHaveBeenCalled();
  expect(fresh.createWorkspace).not.toHaveBeenCalled();
});
