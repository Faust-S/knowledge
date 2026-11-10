import { describe, expect, it } from "vitest";
import type { ObjectRecord, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceRelationIndexEntry } from "../src/modules/base/features/workspace/relation-index-model";
import { buildProjectProcessResultConnectivity } from "../src/modules/base/features/workspace/project-process-connectivity";

function object(id: string, schema: string): ObjectRecord {
  return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} };
}

function entry(id: string, from: string, to: string): WorkspaceRelationIndexEntry {
  const relation: RelationRecord = { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind: "contains", created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" };
  return { relation, fromSchemaId: "project", toSchemaId: "task" };
}

describe("Project / Process / Result structural connectivity", () => {
  const objects = [
    object("a", "project"), object("b", "task"), object("c", "process"),
    object("d", "analytical-result"), object("e", "route"), object("ignored", "note"),
  ];
  const entries = [entry("r-ab", "a", "b"), entry("r-bc", "b", "c"), entry("r-de", "d", "e")];

  it("builds deterministic connected components and keeps no-edge objects as singleton components", () => {
    const result = buildProjectProcessResultConnectivity(entries, objects, null);
    expect(result.objectCount).toBe(5);
    expect(result.componentCount).toBe(2);
    expect(result.connectedObjectCount).toBe(5);
    expect(result.isolatedObjectCount).toBe(0);
    expect(result.components).toEqual([{ objectIds: ["a", "b", "c"] }, { objectIds: ["d", "e"] }]);
  });

  it("reports focused reachability and objects outside the focused component", () => {
    const result = buildProjectProcessResultConnectivity(entries, [...objects, object("z", "process")], "b");
    expect(result.componentCount).toBe(3);
    expect(result.isolatedObjectCount).toBe(1);
    expect(result.focusedComponentObjectCount).toBe(3);
    expect(result.focusedReachableObjectCount).toBe(2);
    expect(result.outsideFocusedComponentObjectCount).toBe(3);
  });

  it("treats an isolated focused object as an honest one-object component", () => {
    const result = buildProjectProcessResultConnectivity(entries, [...objects, object("z", "process")], "z");
    expect(result.focusedComponentObjectCount).toBe(1);
    expect(result.focusedReachableObjectCount).toBe(0);
    expect(result.outsideFocusedComponentObjectCount).toBe(5);
  });

  it("ignores focus outside admitted PPR objects", () => {
    expect(buildProjectProcessResultConnectivity(entries, objects, "ignored").focusedObjectId).toBeNull();
  });
});
