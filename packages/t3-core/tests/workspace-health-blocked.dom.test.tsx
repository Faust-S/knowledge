// @vitest-environment jsdom
/**
 * Health is an ordinary Workspace profile; authorized history loads on demand.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { WorkspaceView } from "../src/modules/base/features/workspace/WorkspaceView";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { adapter } from "../src/kernel-client";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import type { WorkspaceRecord } from "../src/kernel-client";

const origFlag = import.meta.env.VITE_ENABLE_HEALTH_PROFILE;

function ws(): WorkspaceRecord {
  return {
    workspace_id: "wH", profile: "health", capabilities: ["sensitivity:sensitive"],
    read_only: false, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
  };
}

describe("Workspace health profile is ordinary user presentation", () => {
  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = "false";
  });
  afterEach(() => {
    cleanup(); vi.restoreAllMocks();
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE = origFlag;
  });

  it("shows the workspace without automatic profile-name blocking", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws()] });
    const listObjects = vi.spyOn(adapter, "listObjects");
    const listEvents = vi.spyOn(adapter, "listEventsSince");

    render(
      <WorkspaceView
        kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wH"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );

    expect(await screen.findByTestId("workspace-view")).toBeInTheDocument();
    await waitFor(()=>expect(listObjects).toHaveBeenCalled());
    expect(listEvents).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-history-deferred")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workspace-load-history"));
    await waitFor(()=>expect(listEvents).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.queryByTestId("workspace-history-deferred")).not.toBeInTheDocument());
    expect(screen.queryByTestId("events-error")).not.toBeInTheDocument();
  });
});
