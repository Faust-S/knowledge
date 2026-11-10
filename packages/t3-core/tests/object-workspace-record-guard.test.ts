// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { adapter } from "../src/kernel-client";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { useObjectDetail } from "../src/modules/base/features/object/useObjectDetail";
import type { WorkspaceRecord, ObjectRecord } from "../src/kernel-client";

/**
 * PROMPT_04 — ObjectView data controller must fetch the parent
 * WorkspaceRecord BEFORE any object payload, and must not call
 * getObject when the workspace does not exist.
 */
describe("useObjectDetail — workspace record guards object fetch", () => {
  const ws: WorkspaceRecord = {
    workspace_id: "a", profile: "generic", capabilities: [], read_only: false,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  const obj: ObjectRecord = {
    workspace_id: "a", object_id: "o1", schema_id: "note", schema_version: "1",
    created_by_service: "s", updated_by_service: "s",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    revision: 1, data: { title: "o1" }, deleted: false, deleted_at: null,
  };

  it("workspace not-found short-circuits getObject", async () => {
    const session = createDevMockClient({ seedWorkspaces: [], seedObjects: [] });
    const spy = vi.spyOn(adapter, "getObject");
    const { result } = renderHook(() =>
      useObjectDetail({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "missing", objectId: "o1" }),
    );
    await waitFor(() => expect(result.current.status).toBe("workspace-not-found"));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.workspace).toBeNull();
  });

  it("workspace record loads before getObject", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws], seedObjects: [obj] });
    const order: string[] = [];
    const gw = vi.spyOn(adapter, "getWorkspace");
    gw.mockImplementation(async (s, id) => {
      order.push("getWorkspace");
      const orig = createDevMockClient({ seedWorkspaces: [ws] });
      return orig.t1.getWorkspace(id);
    });
    const go = vi.spyOn(adapter, "getObject");
    go.mockImplementation(async (s, wsId, oid) => {
      order.push("getObject");
      return { object: obj, relations: { outgoing: [], incoming: [] } };
    });
    const { result } = renderHook(() =>
      useObjectDetail({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a", objectId: "o1" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const firstGw = order.indexOf("getWorkspace");
    const firstGo = order.indexOf("getObject");
    expect(firstGw).toBeGreaterThanOrEqual(0);
    expect(firstGo).toBeGreaterThan(firstGw);
    expect(result.current.workspace?.workspace_id).toBe("a");
  });
});
