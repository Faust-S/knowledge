// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventRecord, ObjectRecord, WorkspaceRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";
import { RichWorkspaceReadModel } from "../src/modules/base/features/workspace/RichWorkspaceReadModel";
import { WorkspaceMethodWorkflowPanel,type WorkspaceMethodWorkflowBinding } from "../src/modules/base/features/workspace/WorkspaceMethodWorkflowPanel";
import type { WorkspaceMethodInputOverview,WorkspaceMethodHandoffPreview,WorkspaceMethodNativeInspection,WorkspaceMethodStageInspection,WorkspaceMethodStageReader,WorkspaceMethodMaterialEvidence,WorkspaceMethodCorporateTaskReferenceInspection } from "../src/t3/workspace-method-stage-reader.mjs";

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

  it("opens the original program picker and confirms only a verified Work preview, never executes from Workspace",async()=>{
    const f=fixture();
    const selected={workspaceId:"w",projectId:"research",stepId:"analyse",expected:f.binding.expected,
      sourceAsset:{objectId:"material",assetId:"asset",revision:1,name:"problem.json"},
      program:{providerId:"ORTOOLS_ALLOCATION_V1",operation:"allocate",parameters:{specification:"{}"},connectionEpoch:"native-epoch",trustedCodeConfirmed:false}};
    const preview={state:"ORIGINAL_PROGRAM_WORK_PREVIEW_READY" as const,workspaceId:"w",projectId:"research",stepId:"analyse",
      projectRef,workRef:a,candidateDigest:"a".repeat(64),previewDigest:"b".repeat(64),requestId:"workflow-"+"c".repeat(64),
      agentWorkspaceId:"personal",providerId:selected.program.providerId,operation:selected.program.operation,
      source:{...selected.sourceAsset,objectRevision:1,mime:"application/json",bytes:16,sha256:"d".repeat(64)},
      nativeSource:{name:"problem.json",bytes:16,sha256:"d".repeat(64)},predecessorCount:0,fleetAssignmentCount:0,trustedCodeConfirmed:false,
      taskCreated:false as const,executionPerformed:false as const,executionAuthority:false as const,workCompleted:false as const,finalHumanAcceptanceProven:false as const};
    const receipt={state:"READY_FOR_REVIEW" as const,workspaceId:"w",projectId:"research",stepId:"analyse",candidateDigest:preview.candidateDigest,
      previewDigest:preview.previewDigest,requestId:preview.requestId,agentWorkspaceId:"personal",taskId:"TASK-U01-"+"e".repeat(20),reused:false,
      executionPerformed:false as const,executionAuthority:false as const,workCompleted:false as const,finalHumanAcceptanceProven:false as const};
    const port={selectInputs:vi.fn(async()=>selected),preview:vi.fn(async()=>preview),prepare:vi.fn(async()=>receipt),openTask:vi.fn(async()=>{})};
    const binding={...f.binding,reader:{...f.binding.reader,overview:async()=>({...report,stages:[{...report.stages[0],actor:"program" as const},report.stages[1]]})},programWork:port};
    const view=render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByTestId("workflow-program-work");
    expect(screen.queryByRole("button",{name:"Создать задачу Agent"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Выбрать программу и материалы"}));await screen.findByTestId("workflow-program-preview");
    expect(port.prepare).not.toHaveBeenCalled();expect(port.preview).toHaveBeenCalledWith(selected);
    fireEvent.click(screen.getByRole("button",{name:"Создать задачу Agent"}));await screen.findByTestId("workflow-program-task-receipt");
    expect(port.prepare).toHaveBeenCalledWith({selection:selected,requestId:preview.requestId,previewDigest:preview.previewDigest});
    expect(port.openTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Открыть задачу Agent"}));await waitFor(()=>expect(port.openTask).toHaveBeenCalledWith(receipt));
    view.rerender(<WorkspaceMethodWorkflowPanel binding={{...binding,contextEpoch:"other-epoch"}} objects={[]} selectedObjectIds={[]}/>);
    expect(screen.queryByTestId("workflow-program-task-receipt")).toBeNull();
  });
  it("compares the selected method with original creation only on request and hides stale readback",async()=>{
    const f=fixture();
    type Comparison=Awaited<ReturnType<NonNullable<WorkspaceMethodStageReader["compareCreation"]>>>;
    const report:Comparison={
      schema:"IWXA_T2_WORKSPACE_METHOD_REVISION_COMPARISON_V1",state:"CHANGES_PROPOSED",
      comparisonBasis:"ORIGINAL_CREATION_TO_SELECTED_CURRENT",workspaceId:"w",projectId:"research",
      beforeSelection:{projectRef:{...projectRef,revision:1},workRefs:[{...a,revision:1},{...b,revision:1}]},
      afterSelection:f.binding.expected,currentHeadVerified:true,
      projectChanges:[],projectCompositionChanged:false,displayOrderChanged:false,projectIntentChanged:false,
      materialChanges:[],unassignedMaterialChanges:[],stepChanges:[{stepId:"analyse",operation:"CHANGED",changedFields:["INSTRUCTION"],beforeIndex:0,afterIndex:0,reviewRequired:true}],
      changedStepIds:["analyse"],dependencyChanges:[],materialImpactStepIds:[],affectedStepIds:["analyse","review"],
      sourceRevisionSetChanged:true,sourceRevisionChanges:{project:{before:projectRef,after:projectRef,changed:false},works:[]},
      reviewRequired:true,atomicSnapshot:false,writeAuthorized:false,executionAuthority:false,resultReuseProven:false,
      stageDetails:[{stepId:"analyse",before:{id:"analyse",name:"Анализ материалов",actor:"agent",instruction:"Исходная инструкция",dependsOn:[],materialIds:[]},
        after:{id:"analyse",name:"Анализ материалов",actor:"agent",instruction:"Новая инструкция",dependsOn:[],materialIds:[]}}],
    };
    const compareCreation=vi.fn(async()=>report);
    const binding={...f.binding,reader:{...f.binding.reader,compareCreation}};
    const ui=render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    expect(compareCreation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Сравнить с исходной редакцией"}));
    await screen.findByTestId("workflow-creation-comparison");
    expect(screen.getByText("Исходная инструкция")).toBeTruthy();
    expect(screen.getByText("Новая инструкция")).toBeTruthy();
    expect(compareCreation).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected});
    expect(f.overview).not.toHaveBeenCalled();
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={{...binding,contextEpoch:"epoch-2"}} objects={[]} selectedObjectIds={[]}/>);
    expect(screen.queryByTestId("workflow-creation-comparison")).toBeNull();
  });
  it("creates and opens only an owner-confirmed independent method and clears source task selections",async()=>{
    const f=fixture(),target="project-"+"a".repeat(32);
    const selection={projectRef:{...projectRef,objectId:"project:w:"+target,recordId:"variant-project",revision:1},
      workRefs:[{...a,objectId:"work:w:"+target+".analyse",recordId:"variant-analyse",revision:1},
        {...b,objectId:"work:w:"+target+".review",recordId:"variant-review",revision:1}]};
    const createAlternative=vi.fn(async()=>({state:"CREATED" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,
      selection,executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const}));
    const recoverAlternative=vi.fn(async()=>({...await createAlternative(),state:"RECOVERED" as const}));
    const binding={...f.binding,personalTaskId:"TASK-source",personalResultSelections:[],
      reader:{...f.binding.reader,createAlternative,recoverAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    expect(createAlternative).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Создать независимый вариант"}));
    await screen.findByTestId("workflow-alternative-receipt");
    expect(createAlternative).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected});
    fireEvent.click(screen.getByRole("button",{name:"Открыть вариант"}));
    expect(screen.getByText("Проект: "+target+" · ред. 1")).toBeTruthy();
    expect(screen.queryByTestId("workflow-alternative-receipt")).toBeNull();
    expect(f.overview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Вернуться к исходному проекту"}));
    expect(screen.getByText("Проект: research · ред. "+projectRef.revision)).toBeTruthy();
  });
  it("recovers uncertain alternative by original target ID rather than creating a second one",async()=>{
    const f=fixture(),target="project-"+"b".repeat(32);
    const createAlternative=vi.fn(async()=>({state:"OUTCOME_UNKNOWN" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,
      selection:null,executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const}));
    const recoverAlternative=vi.fn(async()=>({...await createAlternative.mock.results[0].value,state:"NOT_FOUND" as const}));
    const binding={...f.binding,reader:{...f.binding.reader,createAlternative,recoverAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Создать независимый вариант"}));
    await screen.findByTestId("workflow-alternative-receipt");
    expect((screen.getByRole("button",{name:"Создать независимый вариант"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Восстановить вариант"}));
    await screen.findByText("Запись пока не найдена. Повторная запись не выполнялась.");
    expect(recoverAlternative).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,targetProjectId:target});
    expect(createAlternative).toHaveBeenCalledTimes(1);
  });
  it("does not offer recovery of an alternative refused before its first write",async()=>{
    const f=fixture(),target="project-"+"c".repeat(32);
    const createAlternative=vi.fn(async()=>({state:"MATERIAL_REVIEW_REQUIRED" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,
      selection:null,executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const}));
    const recoverAlternative=vi.fn(async()=>({...await createAlternative.mock.results[0].value,state:"NOT_FOUND" as const}));
    const binding={...f.binding,reader:{...f.binding.reader,createAlternative,recoverAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Создать независимый вариант"}));
    await screen.findByText("Проверьте редакции материалов. Вариант не создан.");
    expect(screen.queryByRole("button",{name:"Восстановить вариант"})).toBeNull();
    expect((screen.getByRole("button",{name:"Создать независимый вариант"}) as HTMLButtonElement).disabled).toBe(false);
    expect(recoverAlternative).not.toHaveBeenCalled();
  });
  it("keeps the original partial target while its materials require review",async()=>{
    const f=fixture(),target="project-"+"d".repeat(32);
    const createAlternative=vi.fn(async()=>({state:"OUTCOME_UNKNOWN" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,
      selection:null,executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const}));
    const recoverAlternative=vi.fn(async(_request:{workspaceId:string;projectId:string;expected:typeof f.binding.expected;targetProjectId:string})=>({...await createAlternative.mock.results[0].value,state:"RECOVERY_MATERIAL_REVIEW_REQUIRED" as const}));
    const binding={...f.binding,reader:{...f.binding.reader,createAlternative,recoverAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Создать независимый вариант"}));
    await screen.findByTestId("workflow-alternative-receipt");
    fireEvent.click(screen.getByRole("button",{name:"Восстановить вариант"}));
    await screen.findByText("Проверьте редакции материалов незавершённого варианта. Новый вариант не создаётся.");
    expect(screen.getByText("Проект: "+target)).toBeTruthy();
    expect((screen.getByRole("button",{name:"Создать независимый вариант"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Восстановить вариант"}));
    await waitFor(()=>expect(recoverAlternative).toHaveBeenCalledTimes(2));
    for(const [request] of recoverAlternative.mock.calls)expect(request).toEqual({workspaceId:"w",projectId:"research",expected:f.binding.expected,targetProjectId:target});
    expect(createAlternative).toHaveBeenCalledTimes(1);
  });
  it("opens an explicitly selected saved edited alternative using current original refs without the transient origin selection",async()=>{
    const f=fixture(),target="saved-research-option";
    const selection={projectRef:{...projectRef,objectId:"project:w:"+target,recordId:"edited-variant-project",revision:2},
      workRefs:[{...a,objectId:"work:w:"+target+".analyse",recordId:"edited-variant-work",revision:3}]};
    const flags={executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const};
    const createAlternative=vi.fn(async()=>({...flags,state:"USER_CANCELLED" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,selection:null}));
    const recoverAlternative=vi.fn(async()=>({...await createAlternative.mock.results[0].value,state:"NOT_FOUND" as const}));
    const reopenSavedAlternative=vi.fn(async()=>({...flags,state:"OPENED" as const,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,selection}));
    const binding={...f.binding,personalTaskId:"TASK-source",personalResultSelections:[],
      reader:{...f.binding.reader,createAlternative,recoverAlternative,reopenSavedAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Идентификатор сохранённого варианта"}),{target:{value:target}});
    fireEvent.click(screen.getByRole("button",{name:"Открыть сохранённый вариант"}));
    await screen.findByText("Проект: "+target+" · ред. 2");
    expect(reopenSavedAlternative).toHaveBeenCalledWith({workspaceId:"w",projectId:"research",targetProjectId:target});
    expect(createAlternative).not.toHaveBeenCalled();expect(recoverAlternative).not.toHaveBeenCalled();
    expect(f.overview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Вернуться к исходному проекту"}));
    expect(screen.getByText("Проект: research · ред. "+projectRef.revision)).toBeTruthy();
  });
  it("retains the original saved partial target for every explicit recovery",async()=>{
    const f=fixture(),target="saved-partial-option";
    const selection={projectRef:{...projectRef,objectId:"project:w:"+target,recordId:"saved-variant-project",revision:1},
      workRefs:[{...a,objectId:"work:w:"+target+".analyse",recordId:"saved-variant-work",revision:1}]};
    const flags={executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const};
    const base={...flags,workspaceId:"w",sourceProjectId:"research",targetProjectId:target};
    const createAlternative=vi.fn(async()=>({...base,state:"USER_CANCELLED" as const,selection:null}));
    const recoverAlternative=vi.fn(async()=>({...base,state:"NOT_FOUND" as const,selection:null}));
    const reopenSavedAlternative=vi.fn<NonNullable<WorkspaceMethodStageReader["reopenSavedAlternative"]>>()
      .mockResolvedValueOnce({...base,state:"RECOVERY_REQUIRED",selection:null})
      .mockResolvedValueOnce({...base,state:"RECOVERED",selection});
    const binding={...f.binding,reader:{...f.binding.reader,createAlternative,recoverAlternative,reopenSavedAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Идентификатор сохранённого варианта"}),{target:{value:target}});
    fireEvent.click(screen.getByRole("button",{name:"Открыть сохранённый вариант"}));
    await screen.findByText("Осталась незавершённая запись варианта.");
    expect((screen.getByRole("button",{name:"Создать независимый вариант"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button",{name:"Открыть сохранённый вариант"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox",{name:"Идентификатор сохранённого варианта"}) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Восстановить вариант"}));
    await screen.findByText("Проект: "+target+" · ред. 1");
    expect(reopenSavedAlternative.mock.calls).toEqual([[{workspaceId:"w",projectId:"research",targetProjectId:target}],[{workspaceId:"w",projectId:"research",targetProjectId:target}]]);
    expect(createAlternative).not.toHaveBeenCalled();expect(recoverAlternative).not.toHaveBeenCalled();
  });
  it("does not lock or create when an explicit saved-target lookup finds no original Project",async()=>{
    const f=fixture(),target="not-saved";
    const flags={executionAuthority:false as const,newAuthorityGranted:false as const,resultReuseProven:false as const,sourceModified:false as const};
    const base={...flags,workspaceId:"w",sourceProjectId:"research",targetProjectId:target,selection:null};
    const createAlternative=vi.fn(async()=>({...base,state:"USER_CANCELLED" as const}));
    const recoverAlternative=vi.fn(async()=>({...base,state:"NOT_FOUND" as const}));
    const reopenSavedAlternative=vi.fn(async()=>({...base,state:"NOT_FOUND" as const}));
    const binding={...f.binding,reader:{...f.binding.reader,createAlternative,recoverAlternative,reopenSavedAlternative}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Идентификатор сохранённого варианта"}),{target:{value:target}});
    fireEvent.click(screen.getByRole("button",{name:"Открыть сохранённый вариант"}));
    await screen.findByText("Сохранённый вариант не найден.");
    expect((screen.getByRole("button",{name:"Создать независимый вариант"}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button",{name:"Восстановить вариант"})).toBeNull();
    expect(createAlternative).not.toHaveBeenCalled();expect(recoverAlternative).not.toHaveBeenCalled();
  });
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
    expect(screen.getByText("Подготовка передачи сама не создаёт и не запускает задачу.")).toBeTruthy();
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
      snapshotId:"CSN-fixture",snapshotDigest:digest,projectionDigest:digest,bundleDigest:digest,nativeSystemSourceCount:1,nativeSystemSourcesDigest:digest,
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


  function dependentPersonalFixture(){
    const f=fixture(),digest="e".repeat(64),taskId="TASK-root";
    const originalOverview:WorkspaceMethodInputOverview={...report,stages:report.stages.map(row=>({...row,actor:"agent" as const}))};
    f.overview.mockResolvedValue(originalOverview);
    const materialEvidence:WorkspaceMethodMaterialEvidence={
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:makeInspection("review").stageInput,materialEvidenceDigest:"d".repeat(64),
      observation:{materials:[],counts:{materials:1,assets:0,assetBytes:0,canonicalBytes:9}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false};
    const preview:WorkspaceMethodHandoffPreview={
      schema:"IWXA_T2_WORKSPACE_METHOD_STAGE_HANDOFF_PREVIEW_V1",
      state:"PERSONAL_PRIOR_RESULTS_OBSERVED_DECLARED_INPUTS_MATCHED",subjectKind:"PERSONAL",
      inspection:makeInspection("review"),candidateDigest:digest,materialEvidenceRequested:true,materialEvidence,
      personalResultSelections:[{stepId:"analyse",taskId}],
      personalResults:[{stepId:"analyse",canonicalWorkRef:a,acceptedTask:{
        taskId,resultId:"RES-root",reviewId:"REV-root",acceptedDigest:digest,acceptedSummarySha256:digest,
        candidateDigest:digest,agentWorkspaceId:"personal"}}],
      requiredOriginalOwnerChecks:["ORIGINAL_PERSONAL_TASK_AND_CONTEXT_BINDING"],
      signedTaskIssued:false,taskCreated:false,contentBindingProven:false,exactInputBindingProven:false,
      dispatchAuthorized:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false};
    f.previewHandoff.mockResolvedValue(preview);
    const createPersonalDraft=vi.fn(async()=>({state:"DRAFT_CONFIRMED" as const,candidateDigest:digest,
      workspaceId:"w",projectId:"research",stepId:"review",agentWorkspaceId:"personal",
      draftDigest:"a".repeat(64),draftSaved:true,taskCreated:false as const,executionPerformed:false as const,
      modelInvoked:false as const,allAssetsProven:false as const,exactInputBindingProven:false as const}));
    const inspectPersonalTask=vi.fn(async()=>{throw Error("not called");});
    const binding:WorkspaceMethodWorkflowBinding={...f.binding,personalResultSelections:[{stepId:"analyse",taskId}],
      reader:{...f.binding.reader,inspectMaterialEvidence:vi.fn(async()=>materialEvidence),
        createPersonalDraft,recoverPersonalDraft:createPersonalDraft,inspectPersonalTask}};
    return {...f,binding,preview,digest,taskId,createPersonalDraft,inspectPersonalTask};
  }
  it("uses trusted selected personal predecessor Tasks rather than corporate publication, and forwards exact selections to the composer",async()=>{
    const f=dependentPersonalFixture();
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[source.object_id]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect(screen.getByTestId("workflow-personal-prerequisites").textContent).toContain("TASK-root");
    expect(screen.queryByLabelText("Результат: Анализ материалов")).toBeNull();
    expect(screen.queryByRole("button",{name:"Проверить квитанцию"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByText("Передаётся точное принятое текстовое содержимое результатов: 1.");
    fireEvent.click(await screen.findByRole("button",{name:"Передать в черновик Agent"}));
    await screen.findByText("Черновик Agent сохранён. Задача не запущена.");
    const expected={workspaceId:"w",projectId:"research",expected:f.binding.expected,stepId:"review",
      resultSelections:[],personalResultSelections:f.binding.personalResultSelections};
    expect(f.previewHandoff).toHaveBeenCalledExactlyOnceWith({...expected,includeMaterialEvidence:true});
    expect(f.createPersonalDraft).toHaveBeenCalledExactlyOnceWith({...expected,expectedCandidateDigest:f.digest});
    expect(f.inspectPersonalTask).not.toHaveBeenCalled();
    expect(f.recoverContinuation).not.toHaveBeenCalled();
  });
  it("does not prepare a personal chain with missing or duplicate prerequisite selections",async()=>{
    const f=dependentPersonalFixture();
    const view=render(<WorkspaceMethodWorkflowPanel binding={{...f.binding,personalResultSelections:[]}} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect((screen.getByRole("button",{name:"Подготовить передачу"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("workflow-personal-prerequisites").textContent).toContain("Не выбрана");
    view.rerender(<WorkspaceMethodWorkflowPanel binding={{...f.binding,personalResultSelections:[
      {stepId:"analyse",taskId:"TASK-root"},{stepId:"analyse",taskId:"TASK-other"}]}} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect((screen.getByRole("button",{name:"Подготовить передачу"}) as HTMLButtonElement).disabled).toBe(true);
    expect(f.previewHandoff).not.toHaveBeenCalled();
  });
  it("rejects a predecessor receipt with another Task or canonical Work revision",async()=>{
    const f=dependentPersonalFixture();
    f.previewHandoff.mockResolvedValueOnce({...f.preview,personalResults:f.preview.personalResults!.map(row=>({
      ...row,canonicalWorkRef:{...row.canonicalWorkRef,revision:2}}))});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-handoff-preview")).toBeNull();
    expect(f.createPersonalDraft).not.toHaveBeenCalled();
  });
  it("does not expose a late personal chain receipt after selected original Tasks change",async()=>{
    const f=dependentPersonalFixture();let release:(v:WorkspaceMethodHandoffPreview)=>void=()=>{};
    f.previewHandoff.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const view=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    expect(f.previewHandoff).toHaveBeenCalledTimes(1);
    view.rerender(<WorkspaceMethodWorkflowPanel binding={{...f.binding,personalResultSelections:[{stepId:"analyse",taskId:"TASK-other"}]}}
      objects={[]} selectedObjectIds={[]}/>);
    release(f.preview);
    await waitFor(()=>expect(screen.queryByTestId("workflow-handoff-preview")).toBeNull());
    expect(screen.queryByRole("button",{name:"Передать в черновик Agent"})).toBeNull();
  });


  it("recovers the exact current Work association from a selected accepted Task without requiring a handoff preview or draft",async()=>{
    const f=dependentPersonalFixture(),taskId="TASK-review",digest=f.digest;
    const recoverPersonalTask=vi.fn(async()=>({state:"ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED" as const,
      workspaceId:"w",projectId:"research",stepId:"review",candidateDigest:digest,agentWorkspaceId:"personal",taskId,
      resultId:"RES-review",taskDigest:digest,reviewId:"REV-review",acceptedDigest:digest,acceptedSummarySha256:digest,
      snapshotId:"CSN-review",snapshotDigest:digest,projectionDigest:digest,bundleDigest:digest,
      nativeSystemSourceCount:1,nativeSystemSourcesDigest:digest,
      declaredDraftInputsVerified:true as const,allAssetsProven:false as const,exactInputBindingProven:false as const,
      workCompleted:false as const,resultReuseProven:false as const,executionAuthority:false as const,writeAuthorized:false as const,
      recoveredFromOriginalTask:true as const,canonicalWorkRef:b,personalResultSelections:[{stepId:"analyse",taskId:"TASK-root"}]}));
    const binding={...f.binding,personalTaskId:taskId,personalResultSelections:[],reader:{...f.binding.reader,recoverPersonalTask}};
    const view=render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect((screen.getByRole("button",{name:"Подготовить передачу"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Восстановить связь с работой"}));
    const recovered=await screen.findByTestId("workflow-personal-task-recovered");
    expect(recovered.textContent).toContain("Анализ материалов: TASK-root");
    expect(recovered.textContent).toContain("Выполнение работы не засчитано. Данные не изменены.");
    expect(recoverPersonalTask).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",
      expected:f.binding.expected,stepId:"review",taskId});
    expect(f.previewHandoff).not.toHaveBeenCalled();expect(f.createPersonalDraft).not.toHaveBeenCalled();
    view.rerender(<WorkspaceMethodWorkflowPanel binding={{...binding,personalTaskId:"TASK-other"}} objects={[]} selectedObjectIds={[]}/>);
    expect(screen.queryByTestId("workflow-personal-task-recovered")).toBeNull();
  });
  it("does not display a recovered personal binding for the wrong canonical Work record",async()=>{
    const f=dependentPersonalFixture(),digest=f.digest,taskId="TASK-review";
    const recoverPersonalTask=vi.fn(async()=>({state:"ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED" as const,
      workspaceId:"w",projectId:"research",stepId:"review",candidateDigest:digest,agentWorkspaceId:"personal",taskId,
      resultId:"RES-review",taskDigest:digest,reviewId:"REV-review",acceptedDigest:digest,acceptedSummarySha256:digest,
      snapshotId:"CSN-review",snapshotDigest:digest,projectionDigest:digest,bundleDigest:digest,
      nativeSystemSourceCount:1,nativeSystemSourcesDigest:digest,
      declaredDraftInputsVerified:true as const,allAssetsProven:false as const,exactInputBindingProven:false as const,
      workCompleted:false as const,resultReuseProven:false as const,executionAuthority:false as const,writeAuthorized:false as const,
      recoveredFromOriginalTask:true as const,canonicalWorkRef:{...b,recordId:"other"},personalResultSelections:[{stepId:"analyse",taskId:"TASK-root"}]}));
    const binding={...f.binding,personalTaskId:taskId,reader:{...f.binding.reader,recoverPersonalTask}};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    fireEvent.click(screen.getByRole("button",{name:"Восстановить связь с работой"}));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-personal-task-recovered")).toBeNull();
    expect(f.createPersonalDraft).not.toHaveBeenCalled();
  });


  it("lets the user select only direct accepted Tasks and displays the fully verified recovered chain",async()=>{
    const f=dependentPersonalFixture(),c={family:"iwxa.work",objectId:"research.finish",recordId:"finish-1",revision:1};
    const overview:WorkspaceMethodInputOverview={...report,stages:[
      ...report.stages.map(row=>({...row,actor:"agent" as const})),
      {stepId:"finish",name:"Заключение",actor:"agent",workRef:c,state:"PREDECESSOR_RESULTS_REQUIRED",
        inputBasisDigest:"c".repeat(64),directPredecessorStepIds:["review"],prerequisiteCount:2,materialIssues:[]}],
      counts:{total:3,inputReferencesVerified:3,materialReviewRequired:0,predecessorResultsRequired:2,rootInputsVerified:1}};
    f.overview.mockResolvedValue(overview);
    const inspection:WorkspaceMethodStageInspection={...makeInspection("review"),stageInput:{
      state:"INPUT_REFERENCES_VERIFIED",basis:{workspaceId:"w",projectId:"research",stepId:"finish",stageRef:c},
      inputBasisDigest:"c".repeat(64)}};
    const direct=[{stepId:"review",taskId:"TASK-review"}];
    const preview:WorkspaceMethodHandoffPreview={...f.preview,inspection,
      materialEvidence:{...f.preview.materialEvidence!,stageInput:inspection.stageInput},
      personalResultSelections:[{stepId:"analyse",taskId:"TASK-root"},...direct],
      personalResults:[{...f.preview.personalResults![0],stepId:"review",canonicalWorkRef:b,
        acceptedTask:{...f.preview.personalResults![0].acceptedTask,taskId:"TASK-review"}}]};
    f.previewHandoff.mockResolvedValue(preview);
    const binding={...f.binding,expected:{projectRef,workRefs:[a,b,c]},personalResultSelections:direct};
    render(<WorkspaceMethodWorkflowPanel binding={binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 3/);
    fireEvent.click(screen.getByRole("button",{name:/Заключение/}));
    const choices=screen.getByTestId("workflow-personal-prerequisites");
    expect(choices.textContent).toContain("Анализ материалов: Из сохранённой цепочки");
    expect(choices.textContent).toContain("Проверка результатов: TASK-review");
    const button=screen.getByRole("button",{name:"Подготовить передачу"});
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText("Проверено предшествующих задач: 2.");
    expect(f.previewHandoff).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",expected:binding.expected,
      stepId:"finish",resultSelections:[],personalResultSelections:direct,includeMaterialEvidence:true});
    expect(f.createPersonalDraft).not.toHaveBeenCalled();
  });

  function corporateFixture(){
    const f=fixture(),digest="e".repeat(64),materialDigest="d".repeat(64),taskId="task:workflow";
    const inspection=makeInspection("analyse");
    const materialEvidence:WorkspaceMethodMaterialEvidence={
      schema:"IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1",state:"VISIBLE_MATERIAL_CONTENT_OBSERVED",
      stageInput:inspection.stageInput,materialEvidenceDigest:materialDigest,
      observation:{materials:[],counts:{materials:0,assets:0,assetBytes:0,canonicalBytes:0}},
      atomicSnapshot:false,allAssetsProven:false,contentBindingProven:false,exactInputBindingProven:false,
      writeAuthorized:false,executionAuthority:false,resultReuseProven:false,dispatchAuthorized:false};
    const preview:WorkspaceMethodHandoffPreview={
      schema:"IWXA_T2_WORKSPACE_METHOD_STAGE_HANDOFF_PREVIEW_V1",state:"INPUTS_PREPARED_OWNER_SELECTION_REQUIRED",
      subjectKind:"CORP",inspection,candidateDigest:digest,materialEvidenceRequested:true,materialEvidence,
      requiredOriginalOwnerChecks:["ORIGINAL_SIGNED_TASK_BINDING"],signedTaskIssued:false,taskCreated:false,
      contentBindingProven:false,exactInputBindingProven:false,dispatchAuthorized:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false};
    f.previewHandoff.mockResolvedValue(preview);
    const receipt:WorkspaceMethodCorporateTaskReferenceInspection={
      state:"SIGNED_CORPORATE_TASK_CURRENT_REFERENCE_MATCHED",taskId,taskRevisionId:"b".repeat(64),packageSha256:"c".repeat(64),
      recipientId:"person:worker",workflowInput:{schema:"IWXA_T3_WORKFLOW_INPUT_REFERENCE/1",workspaceId:"w",projectId:"research",
        stepId:"analyse",projectRef,workRef:a,inputBasisDigest:inspection.stageInput.inputBasisDigest!,
        materialEvidenceDigest:materialDigest,candidateDigest:digest,taskTextSha256:"f".repeat(64)},
      declaredReferenceMatched:true,exactInputBindingProven:false,allAssetsProven:false,workCompleted:false,executionAuthority:false,writeAuthorized:false,resultReuseProven:false};
    const inspectCorporateTaskReference=vi.fn(async():Promise<WorkspaceMethodCorporateTaskReferenceInspection>=>receipt);
    const binding:WorkspaceMethodWorkflowBinding={...f.binding,corporateTaskId:taskId,
      reader:{...f.binding.reader,inspectMaterialEvidence:vi.fn(async()=>materialEvidence),inspectCorporateTaskReference}};
    return {...f,binding,preview,digest,receipt,inspectCorporateTaskReference};
  }
  async function prepareCorporatePanel(){
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));
    await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    return screen.findByRole("button",{name:"Сопоставить подписанное задание"});
  }
  it("matches a trusted selected corporate Task only through the original signed reader and shows no execution claim",async()=>{
    const f=corporateFixture();
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    expect(f.inspectCorporateTaskReference).not.toHaveBeenCalled();
    fireEvent.click(await prepareCorporatePanel());
    await screen.findByTestId("workflow-corporate-reference-match");
    expect(f.inspectCorporateTaskReference).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",
      expected:f.binding.expected,stepId:"analyse",resultSelections:[],taskId:f.receipt.taskId,expectedCandidateDigest:f.digest});
    expect(screen.getByText("Работа не засчитана выполненной. Фактические входы исполнителя ещё требуют проверки.")).toBeTruthy();
    expect(screen.queryByTestId("workflow-personal-draft")).toBeNull();
    expect(f.recoverContinuation).not.toHaveBeenCalled();
  });
  it("rejects a signed reference for different material or work revision even when the reader reports a match",async()=>{
    const f=corporateFixture();
    f.inspectCorporateTaskReference.mockResolvedValue({...f.receipt,workflowInput:{...f.receipt.workflowInput,workRef:{...a,revision:2}}});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(await prepareCorporatePanel());
    await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-corporate-reference-match")).toBeNull();
  });
  it("clears a corporate reference when the original selected Task changes during readback",async()=>{
    const f=corporateFixture();let release:(r:WorkspaceMethodCorporateTaskReferenceInspection)=>void=()=>{};
    f.inspectCorporateTaskReference.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const ui=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(await prepareCorporatePanel());
    expect(f.inspectCorporateTaskReference).toHaveBeenCalledTimes(1);
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={{...f.binding,corporateTaskId:"task:other"}} objects={[]} selectedObjectIds={[]}/>);
    release(f.receipt);
    await waitFor(()=>expect(screen.queryByTestId("workflow-corporate-reference-match")).toBeNull());
    expect(screen.queryByRole("button",{name:"Сопоставить подписанное задание"})).toBeNull();
  });
  it("does not offer a corporate comparison for a personal handoff",async()=>{
    const f=corporateFixture();f.previewHandoff.mockResolvedValue({...f.preview,subjectKind:"PERSONAL"});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));await screen.findByTestId("workflow-handoff-preview");
    expect(screen.queryByRole("button",{name:"Сопоставить подписанное задание"})).toBeNull();
    expect(f.inspectCorporateTaskReference).not.toHaveBeenCalled();
  });

  it("recovers the original corporate signed reference without a redundant handoff preview",async()=>{
    const f=corporateFixture();
    const recoverCorporateTaskReference=vi.fn(async()=>({...f.receipt,recoveredFromOriginalTask:true as const}));
    render(<WorkspaceMethodWorkflowPanel binding={{...f.binding,reader:{...f.binding.reader,recoverCorporateTaskReference}}}
      objects={[]} selectedObjectIds={[]}/>);
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 2/);
    fireEvent.click(screen.getByRole("button",{name:"Восстановить связь с подписанным заданием"}));
    await screen.findByTestId("workflow-corporate-reference-recovered");
    expect(recoverCorporateTaskReference).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",
      expected:f.binding.expected,stepId:"analyse",resultSelections:[],taskId:f.receipt.taskId});
    expect(f.previewHandoff).not.toHaveBeenCalled();expect(f.inspectCorporateTaskReference).not.toHaveBeenCalled();
    expect(screen.getByText("Работа не засчитана выполненной. Данные не изменены.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:/Проверка результатов/}));
    expect(screen.queryByTestId("workflow-corporate-reference-recovered")).toBeNull();
  });


  function dependentCorporateFixture(){
    const f=corporateFixture(),c={family:"iwxa.work",objectId:"research.finish",recordId:"finish-1",revision:1};
    const all:WorkspaceMethodInputOverview={...report,stages:[...report.stages.map(row=>({...row,actor:"agent" as const})),
      {stepId:"finish",name:"Заключение",actor:"agent",workRef:c,state:"PREDECESSOR_RESULTS_REQUIRED",
        inputBasisDigest:"c".repeat(64),directPredecessorStepIds:["review"],prerequisiteCount:2,materialIssues:[]}],
      counts:{total:3,inputReferencesVerified:3,materialReviewRequired:0,predecessorResultsRequired:2,rootInputsVerified:1}};
    f.overview.mockResolvedValue(all);
    const inspection:WorkspaceMethodStageInspection={...makeInspection("review"),stageInput:{
      state:"INPUT_REFERENCES_VERIFIED",basis:{workspaceId:"w",projectId:"research",stepId:"finish",stageRef:c},inputBasisDigest:"c".repeat(64)}};
    const selections=[
      {stepId:"analyse",acceptanceId:"1".repeat(64),resultRevisionId:"2".repeat(64)},
      {stepId:"review",acceptanceId:"3".repeat(64),resultRevisionId:"4".repeat(64)}];
    const evidence={...selections[1],packageSha256:"5".repeat(64),taskId:"task:review",taskRevisionId:"6".repeat(64),
      taskPackageSha256:"7".repeat(64),resultSha256:"8".repeat(64),organizationId:"org:example",workspaceId:"w",executorId:"person:worker",
      workflowInput:{...f.receipt.workflowInput,stepId:"review",workRef:b,inputBasisDigest:"b".repeat(64)},
      exactInputBindingProven:false as const,workCompleted:false as const};
    const preview:WorkspaceMethodHandoffPreview={...f.preview,state:"CORPORATE_PRIOR_RESULTS_OBSERVED_SIGNED_REFERENCES_MATCHED",inspection,
      materialEvidence:{...f.preview.materialEvidence!,stageInput:inspection.stageInput},corporateResultSelections:selections,
      corporateResults:[{stepId:"review",canonicalWorkRef:b,acceptedResult:evidence}]};
    f.previewHandoff.mockResolvedValue(preview);
    const receipt:WorkspaceMethodCorporateTaskReferenceInspection={...f.receipt,workflowInput:{...f.receipt.workflowInput,
      stepId:"finish",workRef:c,inputBasisDigest:"c".repeat(64)}};
    f.inspectCorporateTaskReference.mockResolvedValue(receipt);
    const recoverCorporateTaskReference=vi.fn(async()=>({...receipt,recoveredFromOriginalTask:true as const}));
    const binding:WorkspaceMethodWorkflowBinding={...f.binding,expected:{projectRef,workRefs:[a,b,c]},
      corporateResultSelections:selections,reader:{...f.binding.reader,recoverCorporateTaskReference}};
    return {...f,binding,selections,preview,receipt,recoverCorporateTaskReference};
  }
  async function selectCorporateFinish(){
    fireEvent.click(screen.getByRole("button",{name:"Проверить входы"}));await screen.findByText(/Работ: 3/);
    fireEvent.click(screen.getByRole("button",{name:/Заключение/}));
  }
  it("shows selected exact corporate accepted Result lineage, not Atlas publication controls, and forwards complete selections",async()=>{
    const f=dependentCorporateFixture();
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[source]} selectedObjectIds={[source.object_id]}/>);
    await selectCorporateFinish();
    const choices=screen.getByTestId("workflow-corporate-prerequisites");
    expect(choices.textContent).toContain("Анализ материалов: Результат 222222222222");
    expect(choices.textContent).toContain("Проверка результатов: Результат 444444444444");
    expect(screen.queryByLabelText("Результат: Проверка результатов")).toBeNull();
    expect(screen.queryByLabelText("Предшественник для проверки передачи")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByText("Проверено принятых редакций предшествующих работ: 2.");
    expect(f.previewHandoff).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"finish",resultSelections:[],corporateResultSelections:f.selections,includeMaterialEvidence:true});
    fireEvent.click(screen.getByRole("button",{name:"Сопоставить подписанное задание"}));
    await screen.findByTestId("workflow-corporate-reference-match");
    expect(f.inspectCorporateTaskReference).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",expected:f.binding.expected,
      stepId:"finish",resultSelections:[],corporateResultSelections:f.selections,taskId:f.receipt.taskId,expectedCandidateDigest:f.digest});
    expect(screen.queryByTestId("workflow-personal-draft")).toBeNull();expect(f.recoverContinuation).not.toHaveBeenCalled();
  });
  it("requires all original corporate ancestor selections, including indirect, and never falls back to the canvas",async()=>{
    const f=dependentCorporateFixture();
    render(<WorkspaceMethodWorkflowPanel binding={{...f.binding,corporateResultSelections:[f.selections[1]]}}
      objects={[source]} selectedObjectIds={[source.object_id]}/>);
    await selectCorporateFinish();
    expect(screen.getByTestId("workflow-corporate-prerequisites").textContent).toContain("Анализ материалов: Не выбран");
    expect((screen.getByRole("button",{name:"Подготовить передачу"}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button",{name:"Восстановить связь с подписанным заданием"}) as HTMLButtonElement).disabled).toBe(true);
    expect(f.previewHandoff).not.toHaveBeenCalled();expect(f.recoverCorporateTaskReference).not.toHaveBeenCalled();
  });
  it("discards the exact corporate reference when an accepted predecessor selection changes while reading",async()=>{
    const f=dependentCorporateFixture();let release:(value:WorkspaceMethodCorporateTaskReferenceInspection&{recoveredFromOriginalTask:true})=>void=()=>{};
    f.recoverCorporateTaskReference.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const ui=render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    await selectCorporateFinish();
    fireEvent.click(screen.getByRole("button",{name:"Восстановить связь с подписанным заданием"}));
    expect(f.recoverCorporateTaskReference).toHaveBeenCalledExactlyOnceWith({workspaceId:"w",projectId:"research",
      expected:f.binding.expected,stepId:"finish",resultSelections:[],corporateResultSelections:f.selections,taskId:f.receipt.taskId});
    ui.rerender(<WorkspaceMethodWorkflowPanel binding={{...f.binding,corporateResultSelections:[
      f.selections[0],{...f.selections[1],resultRevisionId:"9".repeat(64)}]}} objects={[]} selectedObjectIds={[]}/>);
    release({...f.receipt,recoveredFromOriginalTask:true});
    await waitFor(()=>expect(screen.queryByTestId("workflow-corporate-reference-recovered")).toBeNull());
    expect(f.previewHandoff).not.toHaveBeenCalled();
  });
  it("refuses original accepted Result metadata for a different selected revision rather than showing a matched handoff",async()=>{
    const f=dependentCorporateFixture();
    const row=f.preview.corporateResults![0];
    f.previewHandoff.mockResolvedValue({...f.preview,corporateResults:[{...row,acceptedResult:{...row.acceptedResult,resultRevisionId:"9".repeat(64)}}]});
    render(<WorkspaceMethodWorkflowPanel binding={f.binding} objects={[]} selectedObjectIds={[]}/>);
    await selectCorporateFinish();
    fireEvent.click(screen.getByRole("button",{name:"Подготовить передачу"}));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("workflow-handoff-preview")).toBeNull();
    expect(f.inspectCorporateTaskReference).not.toHaveBeenCalled();
  });


});
