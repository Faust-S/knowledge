// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRecord, ObjectRecord, WorkspaceRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";
import { RichWorkspaceReadModel } from "../src/modules/base/features/workspace/RichWorkspaceReadModel";

const profile: WorkspaceProfileDefinition = {
  id: "generic",
  label: "Generic",
  description: "fixture",
  logoText: "G",
  accent: "#000000",
  sections: [
    { id: "notes", title: "Заметки", schemaIds: ["note"], emptyTitle: "none", emptyDescription: "none" },
    { id: "tasks", title: "Задачи", schemaIds: ["task"], emptyTitle: "none", emptyDescription: "none" },
  ],
  unknownObjectsSection: { title: "Other", description: "Other" },
};
const workspace: WorkspaceRecord = {
  workspace_id: "w", profile: "generic", capabilities: [],
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
};
const objects: ObjectRecord[] = [
  { object_id: "note-1", workspace_id: "w", schema_id: "note", schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", revision: 1, data: { secret: "do-not-search-me" }, extensions: {} },
  { object_id: "task-1", workspace_id: "w", schema_id: "task", schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", revision: 1, data: {}, extensions: {} },
];
const events: EventRecord[] = [
  { event_id: "e2", event_type: "CORRECTION", workspace_id: "w", service_id: "svc", object_id: "note-1", occurred_at: "2026-01-02T10:00:00Z", causation_id: "e1", payload: {} },
  { event_id: "e1", event_type: "UPDATED", workspace_id: "w", service_id: "svc", object_id: "note-1", occurred_at: "2026-01-01T10:00:00Z", payload: {} },
];

afterEach(() => cleanup());

describe("G4-S1 RichWorkspaceReadModel DOM", () => {
  it("renders one-workspace logical areas, no-write previews and full history", () => {
    const open = vi.fn();
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events} profileDefinition={profile} onOpenObject={open} />);
    expect(screen.getByTestId("rich-workspace-read-model")).toBeTruthy();
    expect(screen.getAllByTestId("rich-workspace-area")).toHaveLength(2);
    expect(screen.getAllByTestId("rich-workspace-event")).toHaveLength(2);
    expect(screen.getByText(/Persisted Saved View остаётся у существующего owner/)).toBeTruthy();
    expect(screen.queryByTestId("rich-workspace-owner-commands")).toBeNull();
    expect(screen.queryByTestId("rich-workspace-creation-preview")).toBeNull();
    expect(screen.getByText(/не является семантическим порядком/)).toBeTruthy();
  });

  it("omnibar never searches payload and navigates only an admitted object", () => {
    const open = vi.fn();
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events} profileDefinition={profile} onOpenObject={open} />);
    const input = screen.getByLabelText("Поиск по ID и типу объекта");
    fireEvent.change(input, { target: { value: "do-not-search-me" } });
    expect(screen.getByText("Совпадений нет.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "note-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("w", "note-1");
  });

  it("logical-area filter never creates or switches physical Workspace identity", () => {
    const open = vi.fn();
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events} profileDefinition={profile} onOpenObject={open} />);
    fireEvent.click(screen.getByRole("button", { name: /Заметки/ }));
    expect(screen.getAllByText("note-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("task-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(open).toHaveBeenCalledWith("w", "note-1");
  });

  it("uses no browser persistence while filtering and navigating", () => {
    const storageProto = Object.getPrototypeOf(window.localStorage) as Storage;
    const getItem = vi.spyOn(storageProto, "getItem");
    const setItem = vi.spyOn(storageProto, "setItem");
    const removeItem = vi.spyOn(storageProto, "removeItem");
    const clear = vi.spyOn(storageProto, "clear");
    const open = vi.fn();
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events} profileDefinition={profile} onOpenObject={open} />);
    fireEvent.change(screen.getByLabelText("Поиск по ID и типу объекта"), { target: { value: "note-1" } });
    fireEvent.click(screen.getByRole("button", { name: /Заметки/ }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));
    expect(open).toHaveBeenCalledWith("w", "note-1");
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("implements T2.5 P2 as explicit prepare then owner-command invoke without payload draft", async () => {
    const commandProfile: WorkspaceProfileDefinition = {
      ...profile,
      objectOwnerCommands: [{
        id: "notes.review",
        label: "Проверить заметку",
        commandId: "notes.review.execute",
        schemaIds: ["note"],
        selectionSize: 1,
        sameSchema: true,
      }],
    };
    const invoke = vi.fn(async (_id: string, args?: unknown) => ({ ok: true, args }));
    const commands = {
      has: vi.fn((id: string) => id === "notes.review.execute"),
      invoke,
    };
    render(
      <RichWorkspaceReadModel
        workspace={workspace}
        objects={objects}
        events={events}
        profileDefinition={commandProfile}
        commands={commands}
        onOpenObject={() => {}}
      />,
    );
    expect(screen.getByText("INVALID_SELECTION_SIZE")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Выбрать note-1"));
    expect(screen.getByText("READY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Подготовить команду Проверить заметку" }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Выполнить подготовленную команду Проверить заметку" }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("notes.review.execute");
    expect(invoke.mock.calls[0][1]).toEqual({
      workspaceId: "w",
      objects: [{ objectId: "note-1", schemaId: "note", revision: 1 }],
    });
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toContain("do-not-search-me");
  });

  it("reports timeline unavailable instead of fabricating effective/knowledge time", () => {
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={[]} eventsAvailable={false} profileDefinition={profile} onOpenObject={() => {}} />);
    expect(screen.getByText(/События не предоставлены ядром/)).toBeTruthy();
    expect(screen.getByText(/effective-time \/ knowledge-time/)).toBeTruthy();
  });
});


  it("does not let a saved-view completion from the previous Workspace control the new Workspace UI", async () => {
    let resolveOld!: () => void;
    const oldPending = new Promise<void>((resolve) => { resolveOld = resolve; });
    let invocation = 0;
    const invoke = vi.fn(async () => {
      invocation += 1;
      if (invocation === 1) await oldPending;
      return { ok: true };
    });
    const commands = {
      has: vi.fn((id: string) => id === "workspace.view-state.save"),
      invoke,
    };
    const workspaceB: WorkspaceRecord = { ...workspace, workspace_id: "w-b" };
    const { rerender } = render(
      <RichWorkspaceReadModel
        workspace={workspace}
        objects={objects}
        events={events}
        profileDefinition={profile}
        commands={commands}
        onOpenObject={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "A view" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Сохранить в Workspace" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <RichWorkspaceReadModel
        workspace={workspaceB}
        objects={[]}
        events={[]}
        profileDefinition={profile}
        commands={commands}
        onOpenObject={() => {}}
      />,
    );
    await waitFor(() => expect((screen.getByRole("button", { name: "Сохранить в Workspace" }) as HTMLButtonElement).disabled).toBe(true));

    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "B view" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Сохранить в Workspace" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1]).toMatchObject({ workspaceId: "w-b", name: "B view" });

    resolveOld();
    await Promise.resolve();
    await Promise.resolve();
    expect((screen.getByLabelText("Название рабочего вида") as HTMLInputElement).value).toBe("");
    expect(screen.queryByTestId("rich-workspace-persisted-view-error")).toBeNull();
  });
