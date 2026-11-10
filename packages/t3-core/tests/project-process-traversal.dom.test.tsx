// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { KernelFacade } from "../src/workspace-contract";
import { WorkspaceRelationIndex } from "../src/modules/base/features/workspace/WorkspaceRelationIndex";

function object(id: string, schema: string): ObjectRecord {
  return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} };
}
function relation(id: string, from: string, to: string, kind = "contains"): RelationRecord {
  return { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind, created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" };
}
function facade(objects: readonly ObjectRecord[]): KernelFacade {
  const byId = new Map(objects.map((item) => [item.object_id, item]));
  const ab = relation("r-ab", "a", "b");
  const bc = relation("r-bc", "b", "c", "executes-as");
  return {
    hasOperation: (operation: Parameters<KernelFacade["hasOperation"]>[0]) => operation === "t1.getObject",
    grantedOperations: ["t1.getObject"], grantedLevels: ["T1"],
    sessionInfo: { mode: "test", contract_version: "1.2.0", runtime_version: "test", service_id: "test" },
    getObject: vi.fn(async (_workspaceId: string, objectId: string) => {
      const source = byId.get(objectId); if (!source) return null;
      return { object: source, relations: { outgoing: objectId === "a" ? [ab] : objectId === "b" ? [bc] : [], incoming: objectId === "b" ? [ab] : objectId === "c" ? [bc] : [] } } as ObjectWithRelations;
    }),
    listWorkspaces: vi.fn(), getWorkspace: vi.fn(), createWorkspace: vi.fn(), listObjects: vi.fn(), listEventsSince: vi.fn(), putObject: vi.fn(), deleteObject: vi.fn(), softDeleteWorkspace: vi.fn(), restoreWorkspace: vi.fn(), purgePreview: vi.fn(), purgeCommit: vi.fn(), purgeCancel: vi.fn(), exportPreview: vi.fn(), exportPackage: vi.fn(), confirmExport: vi.fn(), importPreview: vi.fn(), importCommit: vi.fn(), importCancel: vi.fn(), authorizationForWorkspace: vi.fn(), hasCapability: vi.fn(),
  } as unknown as KernelFacade;
}

afterEach(() => cleanup());

describe("Project / Process graph traversal", () => {
  it("moves focus across canonical neighbors and restores previous focus", async () => {
    const objects = [object("a", "project"), object("b", "task"), object("c", "process")];
    render(<WorkspaceRelationIndex kernel={facade(objects)} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await screen.findByTestId("workspace-relation-index-list");
    fireEvent.click(screen.getByTestId("relation-index-preset-project-process-result"));
    const focus = screen.getByTestId("relation-index-project-process-focus") as HTMLSelectElement;
    fireEvent.change(focus, { target: { value: "b" } });
    const focusButtons = screen.getAllByTestId("relation-index-project-process-focus-context-object");
    fireEvent.click(focusButtons[0]);
    expect(focus.value).toBe("a");
    expect(screen.getByTestId("relation-index-project-process-focus-back")).toBeTruthy();
    fireEvent.click(screen.getByTestId("relation-index-project-process-focus-back"));
    expect(focus.value).toBe("b");
    fireEvent.change(focus, { target: { value: "c" } });
    expect(screen.queryByTestId("relation-index-project-process-focus-back")).toBeNull();
  });
});
