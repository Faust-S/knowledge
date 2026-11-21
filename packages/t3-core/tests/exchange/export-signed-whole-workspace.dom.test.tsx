// @vitest-environment jsdom
import {describe,expect,it} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import {ExportView} from "@/modules/exchange/features/packages/ExportView";
import type {KernelFacade} from "@/workspace-contract";

const mockKernel=()=>({
  hasOperation:(id:string)=>id==="t2.exportPreview",
  listWorkspaces:async()=>[
    {workspace_id:"company:one",profile:"generic",deleted_at:null},
    {workspace_id:"company:two",profile:"generic",deleted_at:null},
  ],
}) as unknown as KernelFacade;

describe("signed original company Exchange exports only one complete Workspace",()=>{
  it("fails closed without a selected signed Workspace even if two exist",async()=>{
    render(<ExportView kernel={mockKernel()} signedWorkspaceScope scopedWorkspaceId={null}/>);
    await waitFor(()=>expect(screen.getByText(/Подписанная Workspace компании ещё не выбрана/)).toBeTruthy());
    expect((screen.getByTestId("export-preview") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("company:one")).toBeNull();
    expect(screen.queryByText("company:two")).toBeNull();
    expect(screen.queryByText("Что включить в пакет")).toBeNull();
  });

  it("locks original Workspace and all content flags when the signed scope is known",async()=>{
    render(<ExportView kernel={mockKernel()} signedWorkspaceScope scopedWorkspaceId="company:one"/>);
    await waitFor(()=>expect(screen.getByText("company:one")).toBeTruthy());
    expect(screen.queryByText("company:two")).toBeNull();
    expect(screen.getByTestId("export-whole-workspace-scope")).toBeTruthy();
    expect(screen.queryByTestId("export-include_history")).toBeNull();
    expect(screen.queryByTestId("export-include_assets")).toBeNull();
    expect(screen.queryByTestId("export-include_relations")).toBeNull();
    expect(screen.queryByTestId("export-include_schemas")).toBeNull();
    await waitFor(()=>expect((screen.getByTestId("export-preview") as HTMLButtonElement).disabled).toBe(false));
  });
});
