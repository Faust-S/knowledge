// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { KernelFacade } from "../src/workspace-contract";
import { WorkspaceRelationIndex } from "../src/modules/base/features/workspace/WorkspaceRelationIndex";
import { useWorkspaceRelationIndex } from "../src/modules/base/features/workspace/useWorkspaceRelationIndex";

function object(id: string, schema = "note"): ObjectRecord {
  return {
    workspace_id: "w",
    object_id: id,
    schema_id: schema,
    schema_version: "1",
    created_by_service: "svc",
    updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    revision: 1,
    data: {},
    extensions: {},
  };
}

function relation(id: string, from: string, to: string, kind = "linked-to"): RelationRecord {
  return {
    relation_id: id,
    workspace_id: "w",
    from_object_id: from,
    to_object_id: to,
    kind,
    created_at: "2026-01-01T00:00:00Z",
    created_by_service: "svc",
  };
}

function facade(options: {
  objects: readonly ObjectRecord[];
  granted?: boolean;
  delayMs?: number;
  failObjectId?: string;
  onConcurrency?: (value: number) => void;
  onWrite?: () => void;
  relationKind?: string;
}): KernelFacade {
  const byId = new Map(options.objects.map((o) => [o.object_id, o]));
  const r = relation("r1", "a", "b", options.relationKind);
  let inFlight = 0;
  const writes = () => {
    options.onWrite?.();
    throw new Error("P0 must not write");
  };
  return {
    hasOperation: (op: Parameters<KernelFacade["hasOperation"]>[0]) => options.granted !== false && op === "t1.getObject",
    grantedOperations: options.granted === false ? [] : ["t1.getObject"],
    grantedLevels: ["T1"],
    sessionInfo: { mode: "test", contract_version: "1.2.0", runtime_version: "test", service_id: "test" },
    getObject: vi.fn(async (_workspaceId: string, id: string) => {
      inFlight += 1;
      options.onConcurrency?.(inFlight);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      inFlight -= 1;
      if (id === options.failObjectId) throw new Error("expected fixture read failure");
      const o = byId.get(id);
      if (!o) return null;
      return {
        object: o,
        relations: {
          outgoing: id === "a" ? [r] : [],
          incoming: id === "b" ? [r] : [],
        },
      } as ObjectWithRelations;
    }),
    listWorkspaces: vi.fn(), getWorkspace: vi.fn(), createWorkspace: writes,
    listObjects: vi.fn(), listEventsSince: vi.fn(), putObject: writes, deleteObject: writes,
    softDeleteWorkspace: writes, restoreWorkspace: writes, purgePreview: writes,
    purgeCommit: writes, purgeCancel: writes, exportPreview: writes, exportPackage: writes,
    confirmExport: writes, importPreview: writes, importCommit: writes, importCancel: writes,
    authorizationForWorkspace: vi.fn(), hasCapability: vi.fn(),
  } as unknown as KernelFacade;
}

function RelationIndexProbe(props: {
  kernel: KernelFacade;
  workspaceId: string;
  objects: readonly ObjectRecord[];
  onRender: (snapshot: { workspaceId: string; state: string; relationIds: string[] }) => void;
}) {
  const controller = useWorkspaceRelationIndex({
    kernel: props.kernel,
    workspaceId: props.workspaceId,
    objects: props.objects,
    enabled: true,
  });
  props.onRender({
    workspaceId: props.workspaceId,
    state: controller.state,
    relationIds: controller.model?.entries.map((entry) => entry.relation.relation_id) ?? [],
  });
  return null;
}

afterEach(() => cleanup());

describe("WorkspaceRelationIndex P0", () => {
  it("loads read-only relation data, filters in memory and navigates existing objects", async () => {
    const objects = [object("a", "note"), object("b", "task")];
    let writeCalls = 0;
    const kernel = facade({ objects, onWrite: () => { writeCalls += 1; } });
    const onOpen = vi.fn();
    render(<WorkspaceRelationIndex kernel={kernel} workspaceId="w" objects={objects} enabled={true} onOpenObject={onOpen} />);

    await screen.findByTestId("workspace-relation-index-list");
    expect(screen.getByTestId("workspace-relation-index-count").textContent).toContain("1");
    expect(kernel.getObject).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId("relation-index-preset-same-schema"));
    expect(screen.getByTestId("workspace-relation-index-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("relation-index-preset-all"));
    const toButton = await screen.findByTestId("relation-index-open-to");
    fireEvent.click(toButton);
    expect(onOpen).toHaveBeenCalledWith("w", "b");
    expect(kernel.getObject).toHaveBeenCalledTimes(2);
    expect(writeCalls).toBe(0);
  });

  it("keeps sibling relations available when one source read fails and exposes diagnostics", async () => {
    const objects = [object("a", "note"), object("b", "task"), object("c", "note")];
    const kernel = facade({ objects, failObjectId: "c" });
    render(<WorkspaceRelationIndex kernel={kernel} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await screen.findByTestId("workspace-relation-index-list");
    const diagnostics = await screen.findByTestId("workspace-relation-index-diagnostics");
    expect(diagnostics.textContent).toContain("Ошибок чтения источников: 1");
    expect(screen.getByTestId("workspace-relation-index-count").textContent).toContain("1");
  });

  it("does not call getObject when capability is unavailable", async () => {
    const objects = [object("a")];
    const kernel = facade({ objects, granted: false });
    render(<WorkspaceRelationIndex kernel={kernel} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await screen.findByTestId("workspace-relation-index-unavailable");
    expect(kernel.getObject).not.toHaveBeenCalled();
  });

  it("never exposes a settled model from the previous workspace during a workspace switch", async () => {
    const objects = [object("a", "note"), object("b", "task")];
    const kernel = facade({ objects });
    const snapshots: Array<{ workspaceId: string; state: string; relationIds: string[] }> = [];
    const { rerender } = render(
      <RelationIndexProbe
        kernel={kernel}
        workspaceId="w"
        objects={objects}
        onRender={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    await waitFor(() =>
      expect(
        snapshots.some(
          (snapshot) => snapshot.workspaceId === "w" && snapshot.relationIds.includes("r1"),
        ),
      ).toBe(true),
    );

    snapshots.length = 0;
    rerender(
      <RelationIndexProbe
        kernel={kernel}
        workspaceId="w2"
        objects={objects}
        onRender={(snapshot) => snapshots.push(snapshot)}
      />,
    );

    await waitFor(() =>
      expect(
        snapshots.some(
          (snapshot) => snapshot.workspaceId === "w2" && snapshot.state !== "loading",
        ),
      ).toBe(true),
    );
    expect(
      snapshots.some(
        (snapshot) => snapshot.workspaceId === "w2" && snapshot.relationIds.includes("r1"),
      ),
    ).toBe(false);
  });

  it("clears a stale kind filter when refreshed admitted data no longer contains that kind", async () => {
    const objects = [object("a", "note"), object("b", "task")];
    const firstKernel = facade({ objects, relationKind: "first-kind" });
    const secondKernel = facade({ objects, relationKind: "second-kind" });
    const { rerender } = render(
      <WorkspaceRelationIndex
        kernel={firstKernel}
        workspaceId="w"
        objects={objects}
        enabled={true}
        onOpenObject={() => {}}
      />,
    );

    await screen.findByTestId("workspace-relation-index-list");
    const filter = screen.getByTestId("relation-index-kind-filter") as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: "first-kind" } });
    expect(filter.value).toBe("first-kind");

    rerender(
      <WorkspaceRelationIndex
        kernel={secondKernel}
        workspaceId="w"
        objects={objects}
        enabled={true}
        onOpenObject={() => {}}
      />,
    );

    await waitFor(() => {
      const refreshed = screen.getByTestId("relation-index-kind-filter") as HTMLSelectElement;
      expect(refreshed.value).toBe("");
      expect(Array.from(refreshed.options).map((option) => option.value)).toEqual([
        "",
        "second-kind",
      ]);
    });
    expect(screen.getByTestId("workspace-relation-index-list")).toBeTruthy();
  });

  it("keeps getObject fan-out at four or fewer", async () => {
    const objects = Array.from({ length: 12 }, (_, index) => object(index === 0 ? "a" : index === 1 ? "b" : `o${index}`));
    let peak = 0;
    const kernel = facade({ objects, delayMs: 5, onConcurrency: (value) => { peak = Math.max(peak, value); } });
    render(<WorkspaceRelationIndex kernel={kernel} workspaceId="w" objects={objects} enabled={true} onOpenObject={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId("workspace-relation-index-loading")).toBeNull());
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
