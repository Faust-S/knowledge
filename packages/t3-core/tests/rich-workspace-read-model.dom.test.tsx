// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRecord, ObjectRecord, WorkspaceRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";
import { RichWorkspaceReadModel } from "../src/modules/base/features/workspace/RichWorkspaceReadModel";
import { WorkspaceMethodWorkflowPanel,type WorkspaceMethodWorkflowBinding } from "../src/modules/base/features/workspace/WorkspaceMethodWorkflowPanel";
import type { WorkspaceMethodInputOverview,WorkspaceMethodHandoffPreview,WorkspaceMethodNativeInspection,WorkspaceMethodStageInspection,WorkspaceMethodStageReader,WorkspaceMethodMaterialEvidence } from "../src/t3/workspace-method-stage-reader.mjs";

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

function savedViewFixture(viewId: string, name: string, revision = 7, query = "note-1"): ObjectRecord {
  return { ...objects[0], object_id: "saved-view:" + viewId,
    schema_id: "iwxa.workspace.internal.saved-view", schema_version: "1.0.0", revision,
    data: { version: 1, view_id: viewId, name, profile_id: "generic", logical_area_id: "notes", query } };
}

describe("Saved view identity and lifecycle", () => {
  const legacy = savedViewFixture("view-33df4422", "research-1bz9n7f-dpq");
  it("creates a distinct saved view when two different names shared the old 32-bit ID", async () => {
    const invoke = vi.fn(async (_id: string, _args?: unknown) => ({ ok: true }));
    const commands = { has: (id: string) => id === "workspace.view-state.save", invoke };
    render(<RichWorkspaceReadModel workspace={workspace} objects={[...objects, legacy]} events={events}
      profileDefinition={profile} commands={commands} onOpenObject={() => {}} />);
    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "research-1153a0-1t3y" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("workspace.view-state.save");
    expect(invoke.mock.calls[0][1]).toMatchObject({ workspaceId: "w", name: "research-1153a0-1t3y",
      baseRevision: 0, viewId: expect.stringMatching(/^view-[0-9a-f]{32}$/) });
  });

  it("explicitly edits and renames a legacy record using its original identity and revision", async () => {
    const invoke = vi.fn(async (_id: string, _args?: unknown) => ({ ok: true }));
    const commands = { has: (id: string) => id === "workspace.view-state.save", invoke };
    render(<RichWorkspaceReadModel workspace={workspace} objects={[...objects, legacy]} events={events}
      profileDefinition={profile} commands={commands} onOpenObject={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Изменить сохранённый вид research-1bz9n7f-dpq" }));
    expect((screen.getByLabelText("Название рабочего вида") as HTMLInputElement).value).toBe("research-1bz9n7f-dpq");
    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "New name" } });
    fireEvent.change(screen.getByLabelText("Поиск по ID и типу объекта"), { target: { value: "task-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1]).toMatchObject({ viewId: "view-33df4422", baseRevision: 7, name: "New name", query: "task-1" });
  });

  it("refuses a stale explicit edit instead of silently taking a newer base revision", async () => {
    const invoke = vi.fn(async (_id: string, _args?: unknown) => ({ ok: true }));
    const commands = { has: (id: string) => id === "workspace.view-state.save", invoke };
    const refresh = vi.fn(async () => {});
    const props = {workspace, events, profileDefinition: profile, commands, onRefreshObjects: refresh, onOpenObject: () => {}};
    const { rerender } = render(<RichWorkspaceReadModel {...props} objects={[...objects, legacy]} />);
    fireEvent.click(screen.getByRole("button", { name: "Изменить сохранённый вид research-1bz9n7f-dpq" }));
    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "Changed" } });
    rerender(<RichWorkspaceReadModel {...props} objects={[...objects, {...legacy, revision: 8}]} />);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("rich-workspace-persisted-view-error")).toBeTruthy());
  });

  it("reconciles an unknown create through its exact readback without a second write", async () => {
    let saved: ObjectRecord | undefined;
    const invoke = vi.fn(async (_id: string, args?: unknown) => {
      const data = args as { viewId: string; name: string; logicalAreaId: string | null; query: string };
      saved = savedViewFixture(data.viewId, data.name, 1, data.query);
      saved.data = {...(saved.data as Record<string, unknown>), logical_area_id: data.logicalAreaId};
      throw new Error("lost ACK");
    });
    const commands = { has: (id: string) => id === "workspace.view-state.save", invoke };
    const props = {workspace, events, profileDefinition: profile, commands, onOpenObject: () => {}};
    const { rerender } = render(<RichWorkspaceReadModel {...props} objects={objects} />);
    fireEvent.change(screen.getByLabelText("Название рабочего вида"), { target: { value: "Recovered view" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect(screen.getByTestId("rich-workspace-persisted-view-error")).toBeTruthy());
    expect(saved).toBeDefined();
    rerender(<RichWorkspaceReadModel {...props} objects={[...objects, saved!]} />);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить в Workspace" }));
    await waitFor(() => expect((screen.getByLabelText("Название рабочего вида") as HTMLInputElement).value).toBe(""));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("Revision-bound working view composition", () => {
  const presentation = {
    version: 1, mode: "compare", selected: [{object_id:"note-1",revision:1},{object_id:"task-1",revision:1}],
    detail: {object_id:"note-1",revision:1},
  };
  function savedComparison(): ObjectRecord {
    const record = savedViewFixture("view-compare", "Study comparison", 1, "");
    return {...record, data: {...(record.data as Record<string, unknown>), logical_area_id:null, presentation}};
  }
  it("saves current selected objects and view mode with their exact revisions", async () => {
    const invoke = vi.fn(async (_id: string, _args?: unknown) => ({ ok: true }));
    const commands = { has: (id: string) => id === "workspace.view-state.save", invoke };
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events}
      profileDefinition={profile} commands={commands} onOpenObject={() => {}} />);
    fireEvent.click(screen.getByLabelText("Выбрать note-1"));
    fireEvent.click(screen.getByLabelText("Выбрать task-1"));
    fireEvent.click(screen.getByLabelText("Показать детали note-1"));
    fireEvent.click(screen.getByRole("button", {name:"Сравнение"}));
    fireEvent.change(screen.getByLabelText("Название рабочего вида"), {target:{value:"Study"}});
    fireEvent.click(screen.getByRole("button", {name:"Сохранить в Workspace"}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1]).toMatchObject({presentation});
  });

  it("restores saved comparison and removes a changed reference even after the view is opened", () => {
    const record=savedComparison();
    const props={workspace,events,profileDefinition:profile,onOpenObject:()=>{}};
    const {rerender}=render(<RichWorkspaceReadModel {...props} objects={[...objects,record]} />);
    fireEvent.click(screen.getByRole("button",{name:"Применить сохранённый вид Study comparison"}));
    expect(screen.getByRole("button",{name:"Сравнение"}).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("rich-workspace-compare").querySelector("table")).toBeTruthy();
    rerender(<RichWorkspaceReadModel {...props} objects={[{...objects[0],revision:2},objects[1],record]} />);
    expect(screen.getByTestId("rich-workspace-view-restoration-warning").textContent).toContain("Изменилось материалов: 1");
    expect(screen.getByTestId("rich-workspace-compare").querySelector("table")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Принять доступные материалы"}));
    expect(screen.queryByTestId("rich-workspace-view-restoration-warning")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Объекты"}));
    expect((screen.getByLabelText("Выбрать note-1") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Выбрать task-1") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps a session-only working view composition without any owner mutation", () => {
    const invoke=vi.fn(async (_id:string,_args?:unknown)=>({ok:true}));
    const commands={has:()=>true,invoke};
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={events}
      profileDefinition={profile} commands={commands} onOpenObject={()=>{}} />);
    fireEvent.click(screen.getByLabelText("Выбрать note-1"));
    fireEvent.click(screen.getByLabelText("Выбрать task-1"));
    fireEvent.click(screen.getByRole("button",{name:"Сравнение"}));
    fireEvent.change(screen.getByLabelText("Название рабочего вида"),{target:{value:"Session comparison"}});
    fireEvent.click(screen.getByRole("button",{name:"Вид на эту вкладку"}));
    fireEvent.change(screen.getByLabelText("Поиск по ID и типу объекта"),{target:{value:"note"}});
    fireEvent.click(screen.getByRole("button",{name:"Применить рабочий вид Session comparison"}));
    expect(screen.getByTestId("rich-workspace-compare").querySelector("table")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });
});


describe("bounded history rendering", () => {
  it("distinguishes deferred from empty and can navigate all authorized historical events", () => {
    const journal: EventRecord[] = Array.from({ length: 121 }, (_, index) => ({
      event_id: "history-" + String(index).padStart(3, "0"), event_type: "UPDATED", workspace_id: "w",
      service_id: "svc", object_id: "note-1", occurred_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), payload: {},
    }));
    const props = { workspace, objects, profileDefinition: profile, onOpenObject: () => {} };
    const { rerender } = render(<RichWorkspaceReadModel {...props} events={[]} historyState="idle" />);
    expect(screen.getByTestId("rich-workspace-event-count").textContent).toBe("—");
    expect(screen.getByTestId("rich-workspace-history-status").textContent).toContain("История не загружена");
    expect(screen.queryAllByTestId("rich-workspace-event")).toHaveLength(0);
    rerender(<RichWorkspaceReadModel {...props} events={journal} historyState="ready" />);
    expect(screen.getByTestId("rich-workspace-event-count").textContent).toBe("121");
    expect(screen.getAllByTestId("rich-workspace-event")).toHaveLength(50);
    expect(screen.getByTestId("workspace-history-window").textContent).toContain("1–50 из 121");
    fireEvent.click(screen.getByTestId("workspace-history-next"));
    expect(screen.getAllByTestId("rich-workspace-event")).toHaveLength(50);
    fireEvent.click(screen.getByTestId("workspace-history-next"));
    expect(screen.getAllByTestId("rich-workspace-event")).toHaveLength(21);
    expect(screen.getByTestId("workspace-history-window").textContent).toContain("101–121 из 121");
    rerender(<RichWorkspaceReadModel {...props} events={journal.slice(0, 2)} historyState="ready" />);
    expect(screen.getAllByTestId("rich-workspace-event")).toHaveLength(2);
    expect(screen.queryByTestId("workspace-history-next")).toBeNull();
  });
});


describe("W05.7 saved method Workflow read-only surface",()=>{
  const projectRef={family:"iwxa.project",objectId:"project",recordId:"project-1",revision:1};
  const a={family:"iwxa.work",objectId:"research.analyse",recordId:"analyse-1",revision:1};
  const b={family:"iwxa.work",objectId:"research.review",recordId:"review-1",revision:1};
  const report:WorkspaceMethodInputOverview={schema:"IWXA_T2_WORKSPACE_METHOD_INPUT_OVERVIEW_V1",workspaceId:"w",projectId:"research",
    projectRef,stages:[
      {stepId:"analyse",name:"Анализ материалов",actor:"agent",workRef:a,state:"INPUT_REFERENCES_VERIFIED",inputBasisDigest:"a".repeat(64),
        directPredecessorStepIds:[],prerequisiteCount:0,materialIssues:[]},
      {stepId:"review",name:"Проверка результатов",actor:"human",workRef:b,state:"PREDECESSOR_RESULTS_REQUIRED",inputBasisDigest:"b".repeat(64),
        directPredecessorStepIds:["analyse"],prerequisiteCount:1,materialIssues:[]},
    ],materials:[],counts:{total:2,inputReferencesVerified:2,materialReviewRequired:0,predecessorResultsRequired:1,rootInputsVerified:1},
    completeMethodCurrentVerified:true,atomicSnapshot:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false,executionStatusObserved:false};
  const source={...objects[0],object_id:"accepted-result",schema_id:"iwxa.agent.accepted-result",schema_version:"1.0.0",revision:1,data:{secret:"private result body"}};
  const ref={workspace_id:"w",object_id:source.object_id,schema_id:"iwxa.agent.accepted-result" as const,revision:1};
  const makeInspection=(stepId:string):WorkspaceMethodStageInspection=>({
    state:"NO_PREDECESSOR_RESULTS_REQUIRED",stageInput:{state:"INPUT_REFERENCES_VERIFIED",basis:{workspaceId:"w",projectId:"research",stepId,stageRef:stepId==="analyse"?a:b},
      inputBasisDigest:(stepId==="analyse"?"a":"b").repeat(64)},results:[],executionAuthority:false,writeAuthorized:false,resultReuseProven:false,exactInputBindingProven:false,atomicSnapshot:false});
  function fixture(){
    const overview=vi.fn(async()=>report);
    const previewHandoff=vi.fn(async(input:Parameters<WorkspaceMethodStageReader["previewHandoff"]>[0]):Promise<WorkspaceMethodHandoffPreview>=>({
      schema:"IWXA_T2_WORKSPACE_METHOD_STAGE_HANDOFF_PREVIEW_V1",state:"INPUTS_PREPARED_OWNER_SELECTION_REQUIRED",inspection:makeInspection(input.stepId),
      candidateDigest:"a".repeat(64),requiredOriginalOwnerChecks:["ORIGINAL_SIGNED_TASK_BINDING"],
      signedTaskIssued:false,taskCreated:false,contentBindingProven:false,exactInputBindingProven:false,dispatchAuthorized:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false}));
    const recoverContinuation=vi.fn(async():Promise<WorkspaceMethodNativeInspection>=>({...makeInspection("review"),
      nativeContinuationState:"ORIGINAL_RECIPIENT_OBSERVED_TARGET_WORK_BINDING_UNPROVEN",targetWorkBound:false,dispatchAuthorized:false,
      nativeContinuation:{predecessorStepId:"analyse",preview:{status:"RECOVER_ONLY",operationId:"op-1",recipientId:"iwxa.atlas",reference:ref},
        receipt:{status:"OWNER_READBACK_CONFIRMED",operationId:"op-1",resultRef:"atlas:result"}}}));
    const reader:WorkspaceMethodStageReader={overview,previewHandoff,recoverContinuation,previewContinuation:recoverContinuation,
      inspect:vi.fn(async()=>makeInspection("analyse"))};
    const binding:WorkspaceMethodWorkflowBinding={workspaceId:"w",projectId:"research",expected:{projectRef,workRefs:[a,b]},
      reader,contextEpoch:"epoch-1",nativeRecipientLabel:"Atlas"};
    return {binding,overview,previewHandoff,recoverContinuation};
  }
  it("mounts saved Workflow in actual Rich Workspace only for a trusted current binding and explicitly reads original overview",async()=>{
    const f=fixture(),props={workspace,objects,events,profileDefinition:profile,onOpenObject:vi.fn()};
    const ui=render(<RichWorkspaceReadModel {...props}/>);
    expect(screen.queryByTestId("workspace-method-workflow")).toBeNull();
    ui.rerender(<RichWorkspaceReadModel {...props} methodWorkflow={f.binding}/>);
    expect(f.overview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    expect(f.overview).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected});
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByTestId("workflow-handoff-preview");
    expect(screen.getByText("Задача не создана. Запуск не выполнялся.")).toBeTruthy();
    expect(f.previewHandoff).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"analyse",resultSelections:[]});
    ui.rerender(<RichWorkspaceReadModel {...props} methodWorkflow={f.binding} catalogReady={false}/>);
    expect(screen.queryByTestId("workspace-method-workflow")).toBeNull();
  });
  it("selects exact admitted predecessor Result from canvas and recovers original native receipt without issuing a Task",async()=>{
    const f=fixture();
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source,{...source,object_id:"foreign",workspace_id:"other"}]}
      selectedObjectIds={[source.object_id,"foreign"]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect(screen.queryByText(/private result body/)).toBeNull();
    const select=screen.getByLabelText("Результат: Анализ материалов");
    expect(select.querySelectorAll("option")).toHaveLength(2);
    fireEvent.change(select,{target:{value:JSON.stringify([source.object_id,1])}});
    fireEvent.change(screen.getByLabelText("Предшественник для проверки передачи"),{target:{value:"analyse"}});
    fireEvent.click(screen.getByRole("button",{name:"Проверить квитанцию"}));
    await screen.findByText("Оригинальная квитанция подтверждена.");
    expect(f.recoverContinuation).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"review",predecessorStepId:"analyse",resultSelections:[{stepId:"analyse",reference:ref}]});
    expect(screen.getByText("Квитанция получателя не подтверждает выполнение выбранной работы.")).toBeTruthy();
    expect(f.previewHandoff).not.toHaveBeenCalled();
  });
  it("hides late original readback on signed context epoch change and never displays old Work",async()=>{
    const f=fixture();let release:(v:WorkspaceMethodInputOverview)=>void=()=>{};
    f.overview.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const ui=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={{...f.binding,contextEpoch:"epoch-2"}} objects={[]} selectedObjectIds={[]}/>);
    release(report);
    await waitFor(()=>expect(screen.queryByText(/Работ: 2/)).toBeNull());
    expect(screen.queryByTestId("workflow-handoff-preview")).toBeNull();
  });
  it("refuses mismatched original source revision instead of showing a different method",async()=>{
    const f=fixture();f.overview.mockResolvedValueOnce({...report,projectRef:{...projectRef,recordId:"other"}});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByRole("alert");
    expect(screen.queryByText(/Работ: 2/)).toBeNull();
    expect(f.previewHandoff).not.toHaveBeenCalled();
  });
  it("invalidates verified overview on an observed material revision change, not an unrelated catalog edit",async()=>{
    const f=fixture(),material={...objects[0],object_id:"material",revision:1},other={...objects[0],object_id:"unrelated"};
    f.overview.mockResolvedValue({...report,materials:[{object_id:"material",revision:1,state:"CURRENT",current:null}]});
    const ui=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[material,other]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[material,{...other,revision:2}]} selectedObjectIds={[]}/>);
    expect(screen.getByText(/Работ: 2/)).toBeTruthy();
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[{...material,revision:2},other]} selectedObjectIds={[]}/>);
    expect(screen.queryByText(/Работ: 2/)).toBeNull();
    await screen.findByText("Материалы изменились. Проверьте входы заново.");
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[material,other]} selectedObjectIds={[]}/>);
    expect(screen.queryByText(/Работ: 2/)).toBeNull();
  });
  it("does not resurrect a late native receipt after the externally selected Result disappears and returns",async()=>{
    const f=fixture();let release:(v:WorkspaceMethodNativeInspection)=>void=()=>{};
    const saved=await f.recoverContinuation();f.recoverContinuation.mockClear();
    f.recoverContinuation.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const ui=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[source.object_id]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.change(screen.getByLabelText("Результат: Анализ материалов"),{target:{value:JSON.stringify([source.object_id,1])}});
    fireEvent.change(screen.getByLabelText("Предшественник для проверки передачи"),{target:{value:"analyse"}});
    fireEvent.click(screen.getByRole("button",{name:"Проверить квитанцию"}));
    expect(f.recoverContinuation).toHaveBeenCalledTimes(1);
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[]}/>);
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[source.object_id]}/>);
    fireEvent.change(screen.getByLabelText("Результат: Анализ материалов"),{target:{value:JSON.stringify([source.object_id,1])}});
    fireEvent.change(screen.getByLabelText("Предшественник для проверки передачи"),{target:{value:"analyse"}});
    release(saved);
    await waitFor(()=>expect(screen.queryByTestId("workflow-native-receipt")).toBeNull());
    expect(f.recoverContinuation).toHaveBeenCalledTimes(1);
  });
  it("refuses a recipient receipt that names a different original Result reference",async()=>{
    const f=fixture(),saved=await f.recoverContinuation();f.recoverContinuation.mockClear();
    f.recoverContinuation.mockResolvedValueOnce({...saved,nativeContinuation:{...saved.nativeContinuation!,
      preview:{...saved.nativeContinuation!.preview,reference:{...ref,revision:2}}}});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[source.object_id]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.change(screen.getByLabelText("Результат: Анализ материалов"),{target:{value:JSON.stringify([source.object_id,1])}});
    fireEvent.change(screen.getByLabelText("Предшественник для проверки передачи"),{target:{value:"analyse"}});
    fireEvent.click(screen.getByRole("button",{name:"Проверить квитанцию"}));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-native-receipt")).toBeNull();
  });

  it("explicitly verifies visible material content without selecting a predecessor or dispatching a task",async()=>{
    const f=fixture();
    const inspectMaterialEvidence=vi.fn(async():Promise<WorkspaceMethodMaterialEvidence>=>({
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:makeInspection("review").stageInput,materialEvidenceDigest:"c".repeat(64),
      observation:{materials:[{private:"private fixture body"}],counts:{materials:1,assets:2,assetBytes:5,canonicalBytes:9}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false}));
    const binding={...f.binding,reader:{...f.binding.reader,inspectMaterialEvidence}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.click(screen.getByRole("button",{name:"Проверить содержимое и вложения"}));
    await screen.findByTestId("workflow-material-evidence");
    expect(screen.getByText("Материалов: 1. Вложений: 2.")).toBeTruthy();
    expect(screen.queryByText(/private fixture body/)).toBeNull();
    expect(inspectMaterialEvidence).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"review",resultSelections:[]});
    expect(f.previewHandoff).not.toHaveBeenCalled();expect(f.recoverContinuation).not.toHaveBeenCalled();
  });

  it("prepares one combined handoff when original material capability is available, without reading a cached digest",async()=>{
    const f=fixture();
    const materialEvidence:WorkspaceMethodMaterialEvidence={
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:makeInspection("analyse").stageInput,materialEvidenceDigest:"d".repeat(64),
      observation:{materials:[],counts:{materials:1,assets:2,assetBytes:5,canonicalBytes:9}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false};
    const standalone=vi.fn(async()=>materialEvidence),original=await f.previewHandoff({workspaceId:"w",projectId:"research",expected:f.binding.expected,stepId:"analyse"});
    f.previewHandoff.mockClear();
    f.previewHandoff.mockResolvedValueOnce({...original,materialEvidenceRequested:true,materialEvidence});
    const binding={...f.binding,reader:{...f.binding.reader,inspectMaterialEvidence:standalone}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByTestId("workflow-handoff-preview");
    expect(screen.getByText(/Проверено доступное содержимое: материалов 1, вложений 2/)).toBeTruthy();
    expect(f.previewHandoff).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"analyse",resultSelections:[],includeMaterialEvidence:true});
    expect(standalone).not.toHaveBeenCalled();expect(f.recoverContinuation).not.toHaveBeenCalled();
  });
  it("does not accept a reference-only response as a content-evidenced handoff",async()=>{
    const f=fixture();
    const binding={...f.binding,reader:{...f.binding.reader,inspectMaterialEvidence:vi.fn(async()=>{throw Error("not called");})}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-handoff-preview")).toBeNull();
  });

  it("saves a personal root stage only through the installed draft capability and recovers uncertainty without resend",async()=>{
    const f=fixture(),original=await f.previewHandoff({workspaceId:"w",projectId:"research",expected:f.binding.expected,stepId:"analyse"});
    const materialEvidence:WorkspaceMethodMaterialEvidence={
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:makeInspection("analyse").stageInput,materialEvidenceDigest:"d".repeat(64),
      observation:{materials:[],counts:{materials:1,assets:0,assetBytes:0,canonicalBytes:9}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false};
    const digest="e".repeat(64);
    f.previewHandoff.mockResolvedValueOnce({...original,subjectKind:"PERSONAL",candidateDigest:digest,materialEvidenceRequested:true,materialEvidence});
    const createPersonalDraft=vi.fn(async()=>{throw Error("lost acknowledgement");});
    const recoverPersonalDraft=vi.fn(async()=>({state:"DRAFT_ALREADY_PRESENT" as const,candidateDigest:digest,workspaceId:"w",projectId:"research",
      stepId:"analyse",agentWorkspaceId:"personal",draftDigest:"a".repeat(64),draftSaved:true,taskCreated:false as const,
      executionPerformed:false as const,modelInvoked:false as const,allAssetsProven:false as const,exactInputBindingProven:false as const}));
    const binding={...f.binding,reader:{...f.binding.reader,inspectMaterialEvidence:vi.fn(async()=>materialEvidence),createPersonalDraft,recoverPersonalDraft}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    fireEvent.click(await screen.findByRole("button",{name:"Передать в черновик Agent"}));
    const recovery=await screen.findByRole("button",{name:"Проверить черновик Agent"});
    expect(screen.queryByRole("button",{name:"Передать в черновик Agent"})).toBeNull();
    fireEvent.click(recovery);
    await screen.findByText("Тот же черновик Agent найден. Задача не запущена.");
    const expected={workspaceId:"w",projectId:"research",expected:f.binding.expected,stepId:"analyse",resultSelections:[],expectedCandidateDigest:digest};
    expect(createPersonalDraft).toHaveBeenCalledExactlyOnceWith(expected);
    expect(recoverPersonalDraft).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it("checks explicitly selected original accepted personal Task without saving a draft or claiming Work completion",async()=>{
    const f=fixture(),original=await f.previewHandoff({workspaceId:"w",projectId:"research",expected:f.binding.expected,stepId:"analyse"});
    const materialEvidence:WorkspaceMethodMaterialEvidence={
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:makeInspection("analyse").stageInput,materialEvidenceDigest:"d".repeat(64),
      observation:{materials:[],counts:{materials:1,assets:0,assetBytes:0,canonicalBytes:9}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false};
    const digest="e".repeat(64),taskId="TASK-fixture";
    f.previewHandoff.mockResolvedValueOnce({...original,subjectKind:"PERSONAL",candidateDigest:digest,materialEvidenceRequested:true,materialEvidence});
    const createPersonalDraft=vi.fn(async()=>{throw Error("must not save");});
    const inspectPersonalTask=vi.fn(async()=>({state:"ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED" as const,
      taskId,candidateDigest:digest,workspaceId:"w",projectId:"research",stepId:"analyse",agentWorkspaceId:"personal",
      resultId:"RES-fixture",taskDigest:digest,reviewId:"REV-fixture",acceptedDigest:digest,acceptedSummarySha256:digest,
      snapshotId:"CSN-fixture",snapshotDigest:digest,projectionDigest:digest,bundleDigest:digest,
      declaredDraftInputsVerified:true as const,allAssetsProven:false as const,exactInputBindingProven:false as const,
      workCompleted:false as const,resultReuseProven:false as const,executionAuthority:false as const,writeAuthorized:false as const}));
    const binding={...f.binding,personalTaskId:taskId,reader:{...f.binding.reader,inspectMaterialEvidence:vi.fn(async()=>materialEvidence),
      createPersonalDraft,recoverPersonalDraft:createPersonalDraft,inspectPersonalTask}};
    const view=render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    fireEvent.click(await screen.findByRole("button",{name:"Проверить принятую задачу Agent"}));
    await screen.findByTestId("workflow-personal-task-match");
    expect(inspectPersonalTask).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"analyse",resultSelections:[],expectedCandidateDigest:digest,taskId});
    expect(createPersonalDraft).not.toHaveBeenCalled();
    view.rerender(<WorkspaceMethodWorkflowPanel binding={{...binding,personalTaskId:"TASK-other"}} objects={[]} selectedObjectIds={[]}/>);
    expect(screen.queryByTestId("workflow-personal-task-match")).toBeNull();
  });

});
