import { describe, expect, it } from "vitest";
import type { WorkspaceRelationIndexEntry } from "../src/modules/base/features/workspace/relation-index-model";
import { buildProjectProcessResultNeighbors } from "../src/modules/base/features/workspace/project-process-neighbors";

function entry(id: string, from: string, to: string, kind: string, fromSchemaId: string, toSchemaId: string): WorkspaceRelationIndexEntry {
  return {
    relation: { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind, created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" },
    fromSchemaId,
    toSchemaId,
  };
}

describe("Project / Process / Result neighbors", () => {
  it("projects deterministic incoming and outgoing canonical neighbors", () => {
    const entries = [
      entry("r-task-process", "task-1", "process-1", "executes-as", "task", "process"),
      entry("r-project-task", "project-1", "task-1", "contains", "project", "task"),
    ];
    expect(buildProjectProcessResultNeighbors(entries, "task-1")).toEqual([
      { relationId: "r-project-task", relationKind: "contains", direction: "incoming", neighborObjectId: "project-1", neighborSchemaId: "project" },
      { relationId: "r-task-process", relationKind: "executes-as", direction: "outgoing", neighborObjectId: "process-1", neighborSchemaId: "process" },
    ]);
    expect(buildProjectProcessResultNeighbors(entries, "isolated")).toEqual([]);
    expect(buildProjectProcessResultNeighbors(entries, null)).toEqual([]);
  });
});
