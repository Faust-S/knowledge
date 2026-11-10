// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { KernelFacade } from "../src/workspace-contract";
import { WorkspaceRelationIndex } from "../src/modules/base/features/workspace/WorkspaceRelationIndex";

function object(id: string, schema: string): ObjectRecord { return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} }; }
function relation(id: string, from: string, to: string): RelationRecord { return { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind: "contains", created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" }; }
function facade(objects: readonly ObjectRecord[], onWrite: () => void): KernelFacade {
  const byId = new Map(objects.map((item) => [item.object_id, item])); const edge = relation("r1", "a", "b"); const writes = () => { onWrite(); throw new Error("read-only graph must not write"); };
  return { hasOperation: (operation: Parameters<KernelFacade["hasOperation"]>[0]) => operation === "t1.getObject", grantedOperations: ["t1.getObject"], grantedLevels: ["T1"], sessionInfo: { mode: "test", contract_version: "1.2.0", runtime_version: "test", service_id: "test" }, getObject: vi.fn(async (_workspaceId: string, objectId: string) => { const source = byId.get(objectId); if (!source) return null; return { object: source, relations: { outgoing: objectId === "a" ? [edge] : [], incoming: objectId === "b" ? [edge] : [] } } as ObjectWithRelations; }), listWorkspaces: vi.fn(), getWorkspace: vi.fn(), createWorkspace: writes, listObjects: vi.fn(), listEventsSince: vi.fn(), putObject: writes, deleteObject: writes, softDeleteWorkspace: writes, restoreWorkspace: writes, purgePreview: writes, purgeCommit: writes, purgeCancel: writes, exportPreview: writes, exportPackage: writes, confirmExport: writes, importPreview: writes, importCommit: writes, importCancel: writes, authorizationForWorkspace: vi.fn(), hasCapability: vi.fn() } as unknown as KernelFacade;
}
afterEach(() => cleanup());
describe("Project / Process / Result focus navigation", () => {
  it("focuses connected and isolated objects without creating writes", async () => {
    const objects = [object("a", "project"), object("b", "task"), object("c", "process")]; let writeCalls = 0; const onOpen = vi.fn();
    render(<WorkspaceRelationIndex kernel={facade(objects, () => { writeCalls += 1; })} workspaceId="w" objects={objects} enabled={true} onOpenObject={onOpen} />);
    await screen.findByTestId("workspace-relation-index-list"); fireEvent.click(screen.getByTestId("relation-index-preset-project-process-result"));
    const overview = screen.getByTestId("relation-index-project-process-overview"); expect(overview.textContent).toContain("3 объектов в контуре"); expect(overview.textContent).toContain("2 связанных"); expect(overview.textContent).toContain("1 без canonical связей");
    const focus = screen.getByTestId("relation-index-project-process-focus") as HTMLSelectElement; fireEvent.change(focus, { target: { value: "b" } });
    const summary = screen.getByTestId("relation-index-project-process-focus-summary"); expect(summary.textContent).toContain("task"); expect(summary.textContent).toContain("1 входящих"); expect(summary.textContent).toContain("0 исходящих"); expect(summary.textContent).toContain("1 соседних объектов");
    fireEvent.click(screen.getByTestId("relation-index-project-process-open-focus")); expect(onOpen).toHaveBeenCalledWith("w", "b");
    fireEvent.change(focus, { target: { value: "c" } }); expect(screen.getByTestId("relation-index-project-process-focus-summary").textContent).toContain("0 соседних объектов"); expect(screen.getByTestId("workspace-relation-index-empty")).toBeTruthy(); expect(writeCalls).toBe(0);
  });
});
