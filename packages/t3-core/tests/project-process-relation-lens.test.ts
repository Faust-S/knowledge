import { describe, expect, it } from "vitest";
import {
  buildProjectProcessResultOverview,
  projectWorkspaceRelationIndex,
  type WorkspaceRelationIndexEntry,
} from "../src/modules/base/features/workspace/relation-index-model";

function entry(
  relationId: string,
  fromId: string,
  fromSchemaId: string,
  toId: string,
  toSchemaId: string,
): WorkspaceRelationIndexEntry {
  return {
    relation: {
      relation_id: relationId,
      workspace_id: "w",
      from_object_id: fromId,
      to_object_id: toId,
      kind: "contains",
      created_at: "2026-09-15T00:00:00Z",
      created_by_service: "test",
    },
    fromSchemaId,
    toSchemaId,
  };
}

describe("Project / Process / Result canonical relation lens", () => {
  it("admits only declared graph schemas and derives overview from admitted canonical edges", () => {
    const entries = [
      entry("r1", "project-1", "project", "task-1", "task"),
      entry("r2", "task-1", "task", "process-1", "process"),
      entry("r3", "process-1", "process", "result-1", "analytical-result"),
      entry("r4", "project-1", "project", "note-1", "note"),
    ];

    const visible = projectWorkspaceRelationIndex(entries, "project-process-result", null);
    expect(visible.map((item) => item.relation.relation_id)).toEqual(["r1", "r2", "r3"]);
    expect(buildProjectProcessResultOverview(visible)).toEqual({
      edgeCount: 3,
      objectCount: 4,
      connectedObjectCount: 4,
      isolatedObjectCount: 0,
      schemaCounts: [
        { schemaId: "analytical-result", objectCount: 1 },
        { schemaId: "process", objectCount: 1 },
        { schemaId: "project", objectCount: 1 },
        { schemaId: "task", objectCount: 1 },
      ],
    });
  });
});
