// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { KernelFacade } from "../src/workspace-contract";
import { WorkspaceRelationIndex } from "../src/modules/base/features/workspace/WorkspaceRelationIndex";

function object(id: string, schema: string): ObjectRecord {
  return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} };
}

function relation(id: string, from: string, to: string): RelationRecord {
  return { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind: "contains", created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" };
}

function facade(objects: readonly ObjectRecord[], relations: readonly RelationRecord[], onWrite: () => void): KernelFacade {
  const byId = new Map(objects.map((item) => [item.object_id, item]));
  const writes = () => { onWrite(); throw new Error("connectivity view must remain read-only"); };
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

describe("Project / Process / Result connectivity UI", () => {
  it("shows structural components and focused reachability without inferring workflow state or writing", async () => {
    const objects = [
      object("a", "project"), object("b", "task"), object("c", "process"),
      object("d", "analytical-result"), object("e", "route"), object("z", "process"),
    ];
    const relations = [relation("r-ab", "a", "b"), relation("r-bc", "b", "c"), relation("r-de", "d", "e")];
    let writeCalls = 0;
    render(<WorkspaceRelationIndex kernel={facade(objects, relations, () => { writeCalls += 1; })} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await screen.findByTestId("workspace-relation-index-list");
    fireEvent.click(screen.getByTestId("relation-index-preset-project-process-result"));

    const summary = screen.getByTestId("relation-index-project-process-connectivity-summary");
    expect(summary.textContent).toContain("3 structural component");
    expect(summary.textContent).toContain("5 объектов в многовершинных компонентах");
    expect(summary.textContent).toContain("1 singleton-компонент");

    const focus = screen.getByTestId("relation-index-project-process-focus") as HTMLSelectElement;
    fireEvent.change(focus, { target: { value: "b" } });
    const connectedFocus = screen.getByTestId("relation-index-project-process-focused-connectivity");
    expect(connectedFocus.textContent).toContain("3 объектов в structural component");
    expect(connectedFocus.textContent).toContain("2 достижимых других объектов");
    expect(connectedFocus.textContent).toContain("3 объектов вне компоненты");

    fireEvent.change(focus, { target: { value: "z" } });
    const isolatedFocus = screen.getByTestId("relation-index-project-process-focused-connectivity");
    expect(isolatedFocus.textContent).toContain("1 объектов в structural component");
    expect(isolatedFocus.textContent).toContain("0 достижимых других объектов");
    expect(isolatedFocus.textContent).toContain("5 объектов вне компоненты");
    expect(screen.getByTestId("relation-index-project-process-boundary").textContent).toContain("не являются стадиями процесса");
    expect(writeCalls).toBe(0);
  });
});
