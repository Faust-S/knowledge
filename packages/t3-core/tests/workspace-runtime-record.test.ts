// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useMemo } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { adapter } from "../src/kernel-client";
import { useWorkspaceContent } from "../src/modules/base/features/workspace/useWorkspaceContent";
import type { WorkspaceRecord } from "../src/kernel-client";

/**
 * PROMPT_04 — Baseline 1.2 getWorkspace returns WorkspaceRecord | null.
 *   - null  → not-found (never treated as unavailable/error).
 *   - error → error, with technical detail preserved.
 *   - missing capability → unavailable.
 */
describe("useWorkspaceContent — WorkspaceRecord states", () => {
  const ws: WorkspaceRecord = {
    workspace_id: "a", profile: "generic", capabilities: [], read_only: false,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };

  it("ready → exposes the raw WorkspaceRecord (no wrapper, no counts)", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws] });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.workspaceState).toBe("ready"));
    expect(result.current.workspace).toEqual(expect.objectContaining({ workspace_id: "a" }));
    const rec = result.current.workspace as unknown as Record<string, unknown>;
    expect("counts" in rec).toBe(false);
    expect("last_event_at" in rec).toBe(false);
  });

  it("null from getWorkspace → not-found", async () => {
    const session = createDevMockClient({ seedWorkspaces: [] });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "missing" }),
    );
    await waitFor(() => expect(result.current.workspaceState).toBe("not-found"));
    expect(result.current.workspace).toBeNull();
    expect(result.current.workspaceError).toBeNull();
  });

  it("getWorkspace throws → error with technical detail", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws] });
    const caps = computeCapabilities(session);
    vi.spyOn(adapter, "getWorkspace").mockRejectedValueOnce(new Error("rt boom"));
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.workspaceState).toBe("error"));
    expect(result.current.workspaceError).toMatch(/rt boom/);
  });

  it("missing t1.getWorkspace capability → unavailable", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws],
      grantedOperations: ["t1.listWorkspaces"],
    });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceContent({ kernel: useMemo(() => createKernelFacade({ session }), [session]), workspaceId: "a" }),
    );
    await waitFor(() => expect(result.current.workspaceState).toBe("unavailable"));
  });
});
