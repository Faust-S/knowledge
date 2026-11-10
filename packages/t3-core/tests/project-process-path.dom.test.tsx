// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { KernelFacade } from "../src/workspace-contract";
import { WorkspaceRelationIndex } from "../src/modules/base/features/workspace/WorkspaceRelationIndex";

function object(id: string, schema: string): ObjectRecord {
  return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} };
}

function relation(id: string, from: string, to: string, kind: string): RelationRecord {
  return { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind, created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" };
}

function facade(objects: readonly ObjectRecord[], relations: readonly RelationRecord[], onWrite: () => void): KernelFacade {
  const byId = new Map(objects.map((item) => [item.object_id, item]));
  const writes = () => { onWrite(); throw new Error("canonical path must remain read-only"); };
  return {
    hasOperation: (operation: Parameters<KernelFacade["hasOperation"]>[0]) => operation === "t1.getObject",
    grantedOperations: ["t1.getObject"], grantedLevels: ["T1"],
    sessionInfo: { mode: "test", contract_version: "1.2.0", runtime_version: "test", service_id: "test" },
    getObject: vi.fn(async (_workspaceId: string, objectId: string) => {
      const source = byId.get(objectId); if (!source) return null;
      return { object: source, relations: { outgoing: relations.filter((edge) => edge.from_object_id === objectId), incoming: relations.filter((edge) => edge.to_object_id === objectId) } } as ObjectWithRelations;
    }),
    listWorkspaces: vi.fn(), getWorkspace: vi.fn(), createWorkspace: writes, listObjects: vi.fn(), listEventsSince: vi.fn(), putObject: writes, deleteObject: writes, softDeleteWorkspace: writes, restoreWorkspace: writes, purgePreview: writes, purgeCommit: writes, purgeCancel: writes, exportPreview: writes, exportPackage: writes, confirmExport: writes, importPreview: writes, importCommit: writes, importCancel: writes, authorizationForWorkspace: vi.fn(), hasCapability: vi.fn(),
  } as unknown as KernelFacade;
}

afterEach(() => cleanup());

describe("Project / Process / Result canonical path UI", () => {
  it("shows deterministic hops, preserves stored direction, refocuses path nodes and fails closed for disconnected targets", async () => {
    const objects = [object("a", "project"), object("b", "task"), object("c", "process"), object("d", "analytical-result")];
    const relations = [relation("r-ab", "a", "b", "contains"), relation("r-bc", "b", "c", "executes-as")];
    let writeCalls = 0;
    render(<WorkspaceRelationIndex kernel={facade(objects, relations, () => { writeCalls += 1; })} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await screen.findByTestId("workspace-relation-index-list");
    fireEvent.click(screen.getByTestId("relation-index-preset-project-process-result"));
    const focus = screen.getByTestId("relation-index-project-process-focus") as HTMLSelectElement;
    fireEvent.change(focus, { target: { value: "c" } });
    const target = screen.getByTestId("relation-index-project-process-path-target") as HTMLSelectElement;
    fireEvent.change(target, { target: { value: "a" } });
    const result = screen.getByTestId("relation-index-project-process-path-result");
    expect(result.textContent).toContain("2 переходов");
    expect(result.textContent).toContain("r-bc");
    expect(result.textContent).toContain("r-ab");
    expect(result.textContent).toContain("RelationRecord: b → c");
    expect(result.textContent).toContain("против направления записи");
    const pathObjects = screen.getAllByTestId("relation-index-project-process-focus-path-object");
    fireEvent.click(pathObjects[pathObjects.length - 1]);
    expect(focus.value).toBe("a");
    expect(screen.getByTestId("relation-index-project-process-focus-back")).toBeTruthy();
    fireEvent.change(target, { target: { value: "d" } });
    expect(screen.getByTestId("relation-index-project-process-no-path")).toBeTruthy();
    expect(writeCalls).toBe(0);
  });
});
