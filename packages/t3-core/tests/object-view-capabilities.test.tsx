// @vitest-environment jsdom
/**
 * T2-03C — capability gating in ObjectView.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ObjectView } from "../src/modules/base/features/object/ObjectView";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import type { WorkspaceRecord } from "../src/kernel-client";

function ws(profile: string): WorkspaceRecord {
  return {
    workspace_id: "w", profile, capabilities: [], read_only: false,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ObjectView capability gating", () => {
  it("shows workspace-unavailable when canGetWorkspace is missing", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("generic")],
      grantedOperations: [], // strips all t1 ops
    });
    render(
      <ObjectView
        kernel={createKernelFacade({ session })}
        workspaceId="w"
        objectId="o"
        onBack={() => {}}
        onOpenObject={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("object-view-workspace-unavailable")).toBeTruthy(),
    );
  });

  it("shows object-unavailable when canGetObject is missing", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("generic")],
      grantedOperations: ["t1.getWorkspace"], // no getObject
    });
    render(
      <ObjectView
        kernel={createKernelFacade({ session })}
        workspaceId="w"
        objectId="o"
        onBack={() => {}}
        onOpenObject={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("object-view-object-unavailable")).toBeTruthy(),
    );
  });
});
