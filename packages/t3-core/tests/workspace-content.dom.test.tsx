// @vitest-environment jsdom
/**
 * T2-03A — useWorkspaceContent axis independence + health gate.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useMemo } from "react";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useWorkspaceContent } from "../src/modules/base/features/workspace/useWorkspaceContent";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { adapter } from "../src/kernel-client";
import type { ObjectRecord, WorkspaceRecord } from "../src/kernel-client";

function ws(id: string, profile: string): WorkspaceRecord {
  return {
    workspace_id: id, profile, capabilities: [], read_only: false,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}
function obj(w: string, id: string, schema = "note", deleted = false, updated = "2026-01-01T00:00:00Z"): ObjectRecord {
  return {
    workspace_id: w, object_id: id, schema_id: schema, schema_version: "1",
    created_by_service: "s", updated_by_service: "s",
    created_at: updated, updated_at: updated, revision: 1, data: { title: id },
    deleted, deleted_at: deleted ? updated : null,
  };
}

describe("useWorkspaceContent", () => {
  const originalFlag = import.meta.env.VITE_ENABLE_HEALTH_PROFILE;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup(); vi.restoreAllMocks();
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = originalFlag;
  });

  it("loads summary, then objects and events after profile activation", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("a", "personal")],
      seedObjects: [obj("a", "o1"), obj("a", "o2")],
    });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.workspaceState).toBe("ready"));
    await waitFor(() =>
      expect(result.current.profile.status === "ready" || result.current.profile.status === "fallback").toBe(true),
    );
    await waitFor(() => expect(result.current.objectsState).toBe("ready"));
    expect(result.current.objects.map((o) => o.object_id).sort()).toEqual(["o1", "o2"]);
  });

  it("excludes deleted objects even if the kernel returned them", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("a", "generic")] });
    const caps = computeCapabilities(session);
    vi.spyOn(adapter, "listObjects").mockResolvedValueOnce([
      obj("a", "keep"),
      obj("a", "gone", "note", true),
    ]);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.objectsState).toBe("ready"));
    expect(result.current.objects.map((o) => o.object_id)).toEqual(["keep"]);
  });

  it("fails closed when listObjects returns duplicate live object ids", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("a", "generic")] });
    const first = obj("a", "dup", "note");
    const second = { ...obj("a", "dup", "task"), revision: 2 };
    vi.spyOn(adapter, "listObjects").mockResolvedValueOnce([first, second, obj("a", "safe")]);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.objectsState).toBe("ready"));
    expect(result.current.objects.map((o) => o.object_id)).toEqual(["safe"]);
    expect(result.current.objectIntegrityWarnings.filter((warning) => warning.objectId === "dup")).toEqual([
      { objectId: "dup", reason: "duplicate-object-id" },
      { objectId: "dup", reason: "duplicate-object-id" },
    ]);
  });

  it("sanitizes foreign, malformed and duplicate event ids before metadata and timeline readback", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("a", "generic")] });
    vi.spyOn(adapter, "listEventsSince").mockResolvedValueOnce([
      { event_id: "ok", event_type: "object.saved", workspace_id: "a", service_id: "svc", occurred_at: "2026-01-02T00:00:00Z", payload: {} },
      { event_id: "foreign", event_type: "object.saved", workspace_id: "other", service_id: "svc", occurred_at: "2026-01-03T00:00:00Z", payload: {} },
      { event_id: "dup", event_type: "object.saved", workspace_id: "a", service_id: "svc", occurred_at: "2026-01-04T00:00:00Z", payload: {} },
      { event_id: "dup", event_type: "object.changed", workspace_id: "a", service_id: "svc", occurred_at: "2026-01-05T00:00:00Z", payload: {} },
      { event_id: "bad-time", event_type: "object.saved", workspace_id: "a", service_id: "svc", occurred_at: "not-a-date", payload: {} },
    ] as never);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.eventsState).toBe("ready"));
    expect(result.current.events.map((event) => event.event_id)).toEqual(["ok"]);
    expect(result.current.eventIntegrityWarnings.map((warning) => warning.reason).sort()).toEqual([
      "duplicate-event-id",
      "duplicate-event-id",
      "invalid-occurred-at",
      "workspace-mismatch",
    ]);
  });

  it("does not let an older listObjects request overwrite newer post-mutation readback", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("a", "generic")] });
    let releaseOld!: (value: ObjectRecord[]) => void;
    const oldResponse = new Promise<ObjectRecord[]>((resolve) => { releaseOld = resolve; });
    const listObjects = vi.spyOn(adapter, "listObjects")
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce([obj("a", "fresh", "note", false, "2026-01-02T00:00:00Z")]);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(listObjects).toHaveBeenCalledTimes(1));

    await act(async () => { await result.current.refreshObjects(); });
    expect(result.current.objects.map((item) => item.object_id)).toEqual(["fresh"]);

    await act(async () => {
      releaseOld([obj("a", "stale", "note", false, "2026-01-01T00:00:00Z")]);
      await oldResponse;
      await Promise.resolve();
    });
    expect(result.current.objects.map((item) => item.object_id)).toEqual(["fresh"]);
  });

  it("does not let an older listEventsSince request overwrite newer readback", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("a", "generic")] });
    type Event = Awaited<ReturnType<typeof adapter.listEventsSince>>[number];
    let releaseOld!: (value: Event[]) => void;
    const oldResponse = new Promise<Event[]>((resolve) => { releaseOld = resolve; });
    const event = (id: string, at: string): Event => ({
      event_id: id, event_type: "object.saved", workspace_id: "a", service_id: "svc", occurred_at: at, payload: {},
    });
    const listEvents = vi.spyOn(adapter, "listEventsSince")
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce([event("fresh-event", "2026-01-02T00:00:00Z")]);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1));

    await act(async () => { await result.current.refreshEvents(); });
    expect(result.current.events.map((item) => item.event_id)).toEqual(["fresh-event"]);

    await act(async () => {
      releaseOld([event("stale-event", "2026-01-01T00:00:00Z")]);
      await oldResponse;
      await Promise.resolve();
    });
    expect(result.current.events.map((item) => item.event_id)).toEqual(["fresh-event"]);
  });

  it("events error does not affect objects state", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("a", "generic")],
      seedObjects: [obj("a", "o1")],
    });
    const caps = computeCapabilities(session);
    vi.spyOn(adapter, "listEventsSince").mockRejectedValue(new Error("events boom"));
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.objectsState).toBe("ready"));
    await waitFor(() => expect(result.current.eventsState).toBe("error"));
    expect(result.current.objects.length).toBe(1);
    expect(result.current.eventsError).toMatch(/events boom/);
  });

  it("does not hide Workspace data solely because the profile is health", async () => {
    const session=createDevMockClient({seedWorkspaces:[ws("h","health")]});
    const listObj=vi.spyOn(adapter,"listObjects"), listEv=vi.spyOn(adapter,"listEventsSince");
    const {result}=renderHook(()=>useWorkspaceContent({kernel:useMemo(()=>createKernelFacade({session}),[session]),workspaceId:"h"}));
    await waitFor(()=>expect(result.current.profile.status).toBe("ready"));
    await waitFor(()=>expect(result.current.objectsState).toBe("ready"));
    expect(listObj).toHaveBeenCalled();
    expect(listEv).toHaveBeenCalled();
  });

  it("does not call getObject for list items", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("a", "generic")],
      seedObjects: [obj("a", "o1"), obj("a", "o2"), obj("a", "o3")],
    });
    const caps = computeCapabilities(session);
    const getSpy = vi.spyOn(adapter, "getObject");
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.objectsState).toBe("ready"));
    expect(getSpy).not.toHaveBeenCalled();
  });
});
