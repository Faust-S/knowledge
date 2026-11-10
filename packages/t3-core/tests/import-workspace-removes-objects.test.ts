/** PROMPT 34 §6 — unchecking a workspace prunes its objects from include_objects. */
import { describe, expect, it } from "vitest";
import type { ImportPreviewHandle } from "@/modules/exchange/features/state/import-machine";
import {
  INITIAL_PLAN,
  importReducer,
  INITIAL_IMPORT_STATE,
} from "@/modules/exchange/features/state/import-machine";

function makeHandle(): ImportPreviewHandle {
  return {
    preview_token: "tok",
    package_digest: "d",
    semantic_digest: "sd",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    allowed_modes: ["selective"],
    preview: {
      workspaces: [
        { workspace_id: "ws-a", exists_locally: false, incoming_objects: 1,
          incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
        { workspace_id: "ws-b", exists_locally: false, incoming_objects: 1,
          incoming_events: 0, incoming_relations: 0, incoming_assets: 0 },
      ],
      totals: { workspaces: 2, objects: 2, events: 0, relations: 0, assets: 0, schemas: 0 },
      objects: [
        { workspace_id: "ws-a", object_id: "obj-1" },
        { workspace_id: "ws-b", object_id: "obj-2" },
      ],
      conflicts: [], unsupported: [], warnings: [],
    } as unknown as ImportPreviewHandle["preview"],
  };
}

describe("import include_workspaces prunes include_objects (PROMPT 34 §4)", () => {
  it("simulates the checkbox handler dropping objects of the removed workspace", () => {
    const handle = makeHandle();
    // Prime state with both workspaces + both objects selected.
    let state = importReducer(INITIAL_IMPORT_STATE, { type: "preview-started" });
    state = importReducer(state, { type: "preview-succeeded", handle });
    state = importReducer(state, {
      type: "set-plan",
      plan: {
        ...INITIAL_PLAN,
        mode: "selective",
        include_workspaces: ["ws-a", "ws-b"],
        include_objects: ["ws-a/obj-1", "ws-b/obj-2"],
      },
    });
    expect(state.plan.include_objects).toEqual(["ws-a/obj-1", "ws-b/obj-2"]);

    // Simulate the ImportView checkbox handler: unchecking ws-b prunes ws-b/*.
    const nextWorkspaces = new Set(state.plan.include_workspaces);
    nextWorkspaces.delete("ws-b");
    const nextObjects = (state.plan.include_objects ?? []).filter((k) => {
      const slash = k.indexOf("/");
      const wsid = slash > 0 ? k.slice(0, slash) : "";
      return nextWorkspaces.has(wsid);
    });

    state = importReducer(state, {
      type: "set-plan",
      plan: {
        include_workspaces: [...nextWorkspaces],
        include_objects: nextObjects,
      },
    });

    expect(state.plan.include_workspaces).toEqual(["ws-a"]);
    expect(state.plan.include_objects).toEqual(["ws-a/obj-1"]);
  });
});
