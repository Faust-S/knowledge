// @vitest-environment jsdom
/**
 * T2-03B — WorkspaceView surface: profile of the WORKSPACE drives
 * sections; domain profile is not accepted; empty/search/section
 * empty-states are distinct; pagination normalises; events failure does
 * not hide objects; export shows only with capability.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { WorkspaceView } from "../src/modules/base/features/workspace/WorkspaceView";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { adapter } from "../src/kernel-client";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import { ViewerRegistry } from "../src/workspace-host/registries/ViewerRegistry";
import type { ObjectRecord, WorkspaceRecord } from "../src/kernel-client";

function ws(id: string, profile: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    workspace_id: id, profile, capabilities: [], read_only: false,
    created_at: "2026-01-01T10:00:00Z", updated_at: "2026-02-01T10:00:00Z",
    ...extra,
  };
}
function obj(w: string, id: string, schema = "note", updated = "2026-02-01T10:00:00Z"): ObjectRecord {
  return {
    workspace_id: w, object_id: id, schema_id: schema, schema_version: "1.0.0",
    created_by_service: "s", updated_by_service: "s",
    created_at: updated, updated_at: updated, revision: 1, data: { title: id },
    deleted: false, deleted_at: undefined,
  };
}

let viewerRegistry = new ViewerRegistry();
function setupGenericRenderers() {
  for(const [schemaId,label,mark] of [["note","Заметка","r-note"],["project","Проект","r-project"]]){
   viewerRegistry.registerMany("test-module",[{contributionId:"test."+schemaId,ownerModuleId:"test-module",requiredOperations:[],
    contribution:{kind:"viewer",id:"test."+schemaId,moduleId:"test-module",requiredOperations:[],profileId:"generic",schemaId,
     schemaVersionRange:"*",surface:"preview",label,loader:async()=>({default:({data}:{data:unknown})=><div data-testid={mark}>{String((data as {title?:string}).title??"")}</div>})}}]);
  }
}

describe("WorkspaceView — profile-driven catalog", () => {
  beforeEach(() => { viewerRegistry=new ViewerRegistry(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("uses WorkspaceRecord.profile (not any domain default) and renders sections with counts", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wA", "generic")],
      seedObjects: [obj("wA", "n1", "note"), obj("wA", "p1", "project"), obj("wA", "n2", "note")],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wA"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("active-profile-label")).toBeInTheDocument());
    expect(screen.getByTestId("active-profile-label").textContent).toBe("Универсальный");

    const nav = await screen.findByTestId("object-section-nav");
    // First (catch-all) `all` is initial and shows every object.
    expect(within(nav).getByTestId("section-tab-all")).toHaveAttribute("aria-selected", "true");
    expect(within(nav).getByTestId("section-tab-all").textContent).toContain("(3)");
    expect(within(nav).getByTestId("section-tab-documents").textContent).toContain("(2)");
    expect(within(nav).getByTestId("section-tab-projects").textContent).toContain("(1)");
  });

  it("shows the fallback banner and uses generic renderers when profile is unknown", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wU", "mystery-profile")],
      seedObjects: [obj("wU", "n1", "note")],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wU"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    const banner = await screen.findByTestId("workspace-profile-fallback");
    expect(banner.textContent).toContain("mystery-profile");
    expect(await screen.findByTestId("r-note")).toBeInTheDocument();
  });

  it("empty workspace shows the shell-empty state (not a section empty state)", async () => {
    const session = createDevMockClient({ seedWorkspaces: [ws("wE", "generic")] });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wE"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    expect(await screen.findByTestId("workspace-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("section-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-empty")).not.toBeInTheDocument();
  });

  it("search-empty differs from section-empty and resets via the button", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wS", "generic")],
      seedObjects: [obj("wS", "alpha", "note")],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wS"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    const search = await screen.findByPlaceholderText("Найти по идентификатору или типу");
    fireEvent.change(search, { target: { value: "zzz-nomatch" } });
    expect(await screen.findByTestId("search-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Сбросить поиск/ }));
    await waitFor(() => expect(screen.queryByTestId("search-empty")).not.toBeInTheDocument());
  });

  it("shows only a section-empty state when a normal section has no objects", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wZ", "generic")],
      seedObjects: [obj("wZ", "n1", "note")],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wZ"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    // Switch to the "projects" tab which has 0 items.
    const nav = await screen.findByTestId("object-section-nav");
    fireEvent.click(within(nav).getByTestId("section-tab-projects"));
    expect(await screen.findByTestId("section-empty")).toBeInTheDocument();
  });

  it("events error is inline and does not hide the object list", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wErr", "generic")],
      seedObjects: [obj("wErr", "n1", "note")],
    });
    const caps = computeCapabilities(session);
    vi.spyOn(adapter, "listEventsSince").mockRejectedValue(new Error("kernel down"));
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wErr"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    expect(await screen.findByTestId("r-note")).toBeInTheDocument();
    expect(await screen.findByTestId("events-error")).toBeInTheDocument();
  });

  it("export action appears only with canExportPackage", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wX", "generic")],
      seedObjects: [obj("wX", "n1", "note")],
      grantedOperations: ["t1.listWorkspaces", "t1.getWorkspace", "t1.listObjects", "t1.listEventsSince"],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wX"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    await screen.findByTestId("r-note");
    expect(screen.queryByTestId("workspace-export-action")).not.toBeInTheDocument();
  });

  it("does not surface session.mode or raw ISO in the main metadata block", async () => {
    const session = createDevMockClient({
      seedWorkspaces: [ws("wISO", "generic", {
        created_at: "2026-05-11T13:45:00Z",
        updated_at: "2026-05-12T14:00:00Z",
      })],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wISO"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    const header = (await screen.findByTestId("workspace-view")).querySelector("header")!;
    // ISO strings live only inside <details>; not in the main dl block.
    const main = header.querySelector("dl")!;
    expect(main.textContent ?? "").not.toContain("2026-05-11T13:45:00Z");
    expect(main.textContent ?? "").not.toContain("2026-05-12T14:00:00Z");
    // "Только чтение" / "Доступно для изменений" — not session.mode.
    expect(screen.getByTestId("workspace-read-only-badge").textContent).toMatch(
      /Только чтение|Доступно для изменений/,
    );
    expect(header.textContent ?? "").not.toContain(session.mode);
  });

  it("has no create/edit/delete object controls", async () => {
    setupGenericRenderers();
    const session = createDevMockClient({
      seedWorkspaces: [ws("wRO", "generic")],
      seedObjects: [obj("wRO", "n1", "note")],
    });
    const caps = computeCapabilities(session);
    render(
      <WorkspaceView
        viewerRegistry={viewerRegistry} kernel={createKernelFacade({ session })} currentShellServiceId="svc" workspaceId="wRO"
        onOpenObject={() => {}} onExportThis={() => {}} onBack={() => {}}
      />,
    );
    await screen.findByTestId("r-note");
    for (const label of [/Создать объект/i, /Редактировать объект/i, /Удалить объект/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
