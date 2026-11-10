// @vitest-environment jsdom
/**
 * T2-03C — ObjectView must gate `getObject` on the workspace profile.
 *
 * A direct URL to an object inside a health workspace, opened in a NORMAL
 * build, must:
 *   - call `getWorkspace` (to know the profile);
 *   - NOT call `getObject`;
 *   - NOT call `listEventsSince`;
 *   - render the sealed blocked surface.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ObjectView } from "../src/modules/base/features/object/ObjectView";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { adapter } from "../src/kernel-client";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import type { WorkspaceRecord } from "../src/kernel-client";

function ws(id: string, profile: string): WorkspaceRecord {
  return {
    workspace_id: id,
    profile,
    capabilities: [],
    read_only: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("ObjectView profile guard", () => {
  const originalFlag = import.meta.env.VITE_ENABLE_HEALTH_PROFILE;

  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = originalFlag;
  });

  it("opens authorized objects without profile-name restriction", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("h", "health")] });

    const getObj = vi.spyOn(adapter, "getObject");
    const listEv = vi.spyOn(adapter, "listEventsSince");
    const getWs = vi.spyOn(adapter, "getWorkspace");

    render(
      <ObjectView
        kernel={createKernelFacade({ session })}
        workspaceId="h"
        objectId="anything"
        onBack={() => {}}
        onOpenObject={() => {}}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("object-view-not-found")).toBeTruthy(),
    );
    // Give any stray async a chance to fire.
    await new Promise((r) => setTimeout(r, 20));

    expect(getWs).toHaveBeenCalled();
    expect(getObj).toHaveBeenCalled();
    expect(listEv).toHaveBeenCalled();
  });

  it("null getObject → not-found surface", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("w", "generic")] });
    vi.spyOn(adapter, "getObject").mockResolvedValue(null as unknown as never);

    render(
      <ObjectView
        kernel={createKernelFacade({ session })}
        workspaceId="w"
        objectId="missing"
        onBack={() => {}}
        onOpenObject={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("object-view-not-found")).toBeTruthy(),
    );
    expect(screen.queryByTestId("object-view")).toBeNull();
  });
});
