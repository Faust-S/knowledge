// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectRecord, WorkspaceRecord } from "../src/kernel-client";
import type { KernelFacade, ViewerContribution } from "../src/workspace-contract";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";
import { ViewerRegistry } from "../src/workspace-host/registries/ViewerRegistry";
import { WorkspaceMaterialCanvas } from "../src/modules/base/features/workspace/WorkspaceMaterialCanvas";
import { RichWorkspaceReadModel } from "../src/modules/base/features/workspace/RichWorkspaceReadModel";
import { checkCanvasMaterialDetail } from "../src/modules/base/features/object/object-integrity";

const workspace: WorkspaceRecord = {workspace_id:"w",profile:"generic",capabilities:[],
  created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-02T00:00:00Z"};
const profile: WorkspaceProfileDefinition = {id:"generic",label:"Generic",description:"fixture",logoText:"G",accent:"#000",
  sections:[{id:"notes",title:"Заметки",schemaIds:["note"],emptyTitle:"none",emptyDescription:"none"}],
  unknownObjectsSection:{title:"Other",description:"Other"}};
const material = (id: string, revision=1, ws="w"): ObjectRecord => ({
  workspace_id:ws, object_id:id,schema_id:"note",schema_version:"1.0.0",
  created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-02T00:00:00Z",
  created_by_service:"svc",updated_by_service:"svc",revision,data:{title:id},extensions:{},
});
const a=material("A"),b=material("B",2),c=material("C",3);
const objects=[a,b,c];
const layout={columns:2 as const,detailed:["A"],wide:[]};
const detail=(object:ObjectRecord)=>({object,relations:[]}) as unknown as Awaited<ReturnType<KernelFacade["getObject"]>>;
const facade=(getObject:KernelFacade["getObject"],allowed=true)=>({hasOperation:()=>allowed,getObject}) as unknown as KernelFacade;

function registry() {
  const result=new ViewerRegistry();
  const entries=(["preview","detail"] as const).map(surface=>{
    const contribution:ViewerContribution={kind:"viewer",id:"fixture."+surface,moduleId:"fixture",
      profileId:"generic",schemaId:"note",schemaVersionRange:"1.x",surface,
      requiredOperations:surface==="detail"?["t1.getObject"]:[],
      requiredCapabilitiesAll:surface==="detail"?["cap.detail"]:[],
      loader:async()=>({default:({data})=><p>{surface}:{String((data as {title?:unknown})?.title)}</p>})};
    return {contributionId:contribution.id,ownerModuleId:contribution.moduleId,contribution,
      requiredOperations:contribution.requiredOperations,requiredCapabilitiesAll:contribution.requiredCapabilitiesAll};
  });
  expect(result.registerMany("fixture",entries).ok).toBe(true);
  return result;
}

afterEach(cleanup);

describe("W03 Workspace material canvas",()=>{
  it("adds across separate catalog searches, reorders, saves width and mode using the existing owner",async()=>{
    const invoke=vi.fn(async (_id:string,_args?:unknown)=>({ok:true}));
    const commands={has:(id:string)=>id==="workspace.view-state.save",invoke};
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={[]} profileDefinition={profile}
      commands={commands} onOpenObject={()=>{}} />);
    fireEvent.click(screen.getByRole("button",{name:"Полотно"}));
    fireEvent.click(screen.getByRole("button",{name:"Добавить материалы"}));
    const query=screen.getByLabelText("Поиск материала по ID или типу");
    fireEvent.change(query,{target:{value:"A"}});
    fireEvent.click(screen.getByRole("button",{name:"Добавить на полотно A"}));
    fireEvent.change(query,{target:{value:"B"}});
    fireEvent.click(screen.getByRole("button",{name:"Добавить на полотно B"}));
    fireEvent.click(screen.getByRole("button",{name:"Переместить выше B"}));
    expect(screen.getAllByTestId("workspace-canvas-material").map(el=>el.getAttribute("data-object-id"))).toEqual(["B","A"]);
    fireEvent.click(screen.getByRole("button",{name:"Широкая панель B"}));
    fireEvent.click(screen.getByRole("button",{name:"Подробный вид A"}));
    fireEvent.click(screen.getByRole("button",{name:"Выделить материал A"}));
    expect(screen.getByRole("button",{name:"Выделить материал A"}).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByLabelText("Название рабочего вида"),{target:{value:"Research"}});
    fireEvent.click(screen.getByRole("button",{name:"Сохранить в Workspace"}));
    await waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("workspace.view-state.save");
    expect(invoke.mock.calls[0][1]).toMatchObject({presentation:{version:1,mode:"canvas",
      selected:[{object_id:"B",revision:2},{object_id:"A",revision:1}],detail:{object_id:"A",revision:1},
      canvas:{columns:2,detailed:["A"],wide:["B"]}}});
  });

  it("keeps unsaved composition while refreshing, never displays old material payload while pending",()=>{
    const props={workspace,events:[],profileDefinition:profile,onOpenObject:()=>{}};
    const {rerender}=render(<RichWorkspaceReadModel {...props} objects={objects} />);
    fireEvent.click(screen.getByLabelText("Выбрать A"));
    fireEvent.click(screen.getByRole("button",{name:"Полотно"}));
    fireEvent.click(screen.getByRole("button",{name:"Одна колонка"}));
    fireEvent.change(screen.getByLabelText("Название рабочего вида"),{target:{value:"Unsaved research"}});
    rerender(<RichWorkspaceReadModel {...props} objects={[]} catalogReady={false} />);
    expect(screen.queryByTestId("workspace-material-canvas")).toBeNull();
    expect(screen.getByTestId("rich-workspace-catalog-pending")).toBeTruthy();
    rerender(<RichWorkspaceReadModel {...props} objects={objects} catalogReady />);
    expect(screen.getByTestId("workspace-material-canvas")).toBeTruthy();
    expect(screen.getByRole("button",{name:"Одна колонка"}).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("workspace-canvas-material").getAttribute("data-object-id")).toBe("A");
    expect((screen.getByLabelText("Название рабочего вида") as HTMLInputElement).value).toBe("Unsaved research");
  });

  it("pins an unsaved composition and excludes a changed revision until explicitly reviewed",()=>{
    const props={workspace,events:[],profileDefinition:profile,onOpenObject:()=>{}};
    const {rerender}=render(<RichWorkspaceReadModel {...props} objects={objects} />);
    fireEvent.click(screen.getByLabelText("Выбрать A"));
    fireEvent.click(screen.getByLabelText("Выбрать B"));
    fireEvent.click(screen.getByRole("button",{name:"Полотно"}));
    rerender(<RichWorkspaceReadModel {...props} objects={[material("A",4),b,c]} />);
    expect(screen.getAllByTestId("workspace-canvas-material").map(el=>el.getAttribute("data-object-id"))).toEqual(["B"]);
    expect(screen.getByTestId("rich-workspace-view-restoration-warning").textContent).toContain("Изменилось материалов: 1");
    fireEvent.click(screen.getByRole("button",{name:"Принять доступные материалы"}));
    expect(screen.queryByTestId("rich-workspace-view-restoration-warning")).toBeNull();
    rerender(<RichWorkspaceReadModel {...props} objects={[material("A",4),material("B",5),c]} />);
    expect(screen.queryByTestId("workspace-canvas-material")).toBeNull();
    expect(screen.getByTestId("rich-workspace-view-restoration-warning").textContent).toContain("Изменилось материалов: 1");
  });

  it("mounts the registered detail renderer only through a permitted exact original object read",async()=>{
    const getObject=vi.fn(async()=>detail({...a,data:{title:"original detail"}}));
    const kernel=facade(getObject), viewerRegistry=registry();
    const props={workspaceId:"w",profileId:"generic",objects,selectedObjectIds:["A","B"],
      layout,editable:true,onLayout:()=>{},onAdd:()=>{},onRemove:()=>{},onMove:()=>{},onOpenObject:()=>{},
      kernel,viewerRegistry,grantedOperations:["t1.getObject"] as const};
    const {rerender}=render(<WorkspaceMaterialCanvas {...props} activeCapabilities={["cap.detail"]} />);
    expect(await screen.findByText("detail:original detail")).toBeTruthy();
    expect(await screen.findByText("preview:B")).toBeTruthy();
    expect(getObject).toHaveBeenCalledExactlyOnceWith("w","A");
    expect(screen.queryByRole("button",{name:"Исходные данные"})).toBeNull();
    rerender(<WorkspaceMaterialCanvas {...props} activeCapabilities={[]} />);
    await waitFor(()=>expect(screen.queryByText("detail:original detail")).toBeNull());
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("preview:A")).toBeTruthy();
  });

  it("never loads detail when getObject is unavailable, even with the viewer capability",async()=>{
    const getObject=vi.fn(async()=>detail(a));
    render(<WorkspaceMaterialCanvas workspaceId="w" profileId="generic" objects={objects} selectedObjectIds={["A"]}
      layout={layout} editable onLayout={()=>{}} onAdd={()=>{}} onRemove={()=>{}} onMove={()=>{}} onOpenObject={()=>{}}
      kernel={facade(getObject,false)} viewerRegistry={registry()} grantedOperations={["t1.getObject"]} activeCapabilities={["cap.detail"]} />);
    expect(await screen.findByText("preview:A")).toBeTruthy();
    expect(getObject).not.toHaveBeenCalled();
  });

  it("refuses mismatching detail revision, schema or workspace",async()=>{
    const getObject=vi.fn(async()=>detail({...a,revision:99,data:{title:"wrong revision"}}));
    render(<WorkspaceMaterialCanvas workspaceId="w" profileId="generic" objects={objects} selectedObjectIds={["A"]}
      layout={layout} editable onLayout={()=>{}} onAdd={()=>{}} onRemove={()=>{}} onMove={()=>{}} onOpenObject={()=>{}}
      kernel={facade(getObject)} viewerRegistry={registry()} grantedOperations={["t1.getObject"]} activeCapabilities={["cap.detail"]} />);
    expect(await screen.findByText(/Материал изменился или не совпадает/)).toBeTruthy();
    expect(screen.queryByText("detail:wrong revision")).toBeNull();
    for(const altered of [{...a,workspace_id:"other"},{...a,object_id:"other"},{...a,revision:2},
      {...a,schema_id:"other"},{...a,schema_version:"2.0.0"}]){
      expect(checkCanvasMaterialDetail(detail(altered),a)).toBe(false);
    }
  });

  it("mounts at most six selected viewers per page without truncating the material selection",()=>{
    const many=Array.from({length:15},(_,i)=>material("M"+i));
    const selectedObjectIds=many.map(object=>object.object_id);
    render(<WorkspaceMaterialCanvas workspaceId="w" profileId="generic" objects={many} selectedObjectIds={selectedObjectIds}
      layout={{columns:1,detailed:[],wide:[]}} editable onLayout={()=>{}} onAdd={()=>{}} onRemove={()=>{}} onMove={()=>{}} onOpenObject={()=>{}} />);
    expect(screen.getAllByTestId("workspace-canvas-material")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button",{name:"Следующая страница"}));
    expect(screen.getAllByTestId("workspace-canvas-material")[0].getAttribute("data-object-id")).toBe("M6");
    fireEvent.click(screen.getByRole("button",{name:"Следующая страница"}));
    expect(screen.getAllByTestId("workspace-canvas-material")).toHaveLength(3);
  });
});

describe("W04 Workspace methods",()=>{
  function createMethod(){
    fireEvent.click(screen.getByLabelText("Выбрать A"));
    fireEvent.click(screen.getByRole("button",{name:"Полотно"}));
    fireEvent.click(screen.getByRole("button",{name:"Методика",exact:true}));
    fireEvent.change(screen.getByLabelText("Название проекта"),{target:{value:"General research"}});
    fireEvent.change(screen.getByLabelText("Цель работы"),{target:{value:"Compare two approaches"}});
    fireEvent.change(screen.getByLabelText("Название этапа"),{target:{value:"Prepare"}});
    fireEvent.click(screen.getByRole("button",{name:"Принять текущий выбор полотна"}));
    fireEvent.change(screen.getByLabelText("Добавить материал этапа"),{target:{value:"A"}});
    fireEvent.click(screen.getByRole("button",{name:"Добавить этап"}));
    fireEvent.change(screen.getByLabelText("Название этапа"),{target:{value:"Calculate"}});
    fireEvent.change(screen.getByLabelText("Предполагаемый участник"),{target:{value:"program"}});
    fireEvent.change(screen.getByLabelText("Добавить предшествующий этап"),{target:{value:"step-1"}});
  }
  const sourcePreview=()=>JSON.parse((screen.getByLabelText("Предпросмотр проекта") as HTMLTextAreaElement).value);
  it("designs a method from canvas materials and reuses the original preview without invoking owners",()=>{
    const invoke=vi.fn(async (_id:string,_args?:unknown)=>({ok:true}));
    const commands={has:()=>true,invoke};
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={[]} profileDefinition={profile}
      commands={commands} onOpenObject={()=>{}} />);
    createMethod();
    fireEvent.click(screen.getByRole("button",{name:"Проверить структуру"}));
    expect(screen.getByTestId("workspace-method-preview")).toBeTruthy();
    const original=sourcePreview();
    expect(original).toMatchObject({schema:"IWXA_T2_PROJECT_TEMPLATE_PREVIEW_V1",persisted:false,sourceTruth:false,
      parameters:{materialRefs:[{object_id:"A",revision:1}],stepIntents:[
        {stepId:"step-1",materialRefs:[{object_id:"A",revision:1}]},
        {stepId:"step-2",intendedActor:"program",materialRefs:[]},
      ]}});
    expect(original.projectedWork[1].dependencies[0].predecessorWorkId).toBe(original.projectedProject.projectId+".step-1");
    fireEvent.click(screen.getByRole("button",{name:"Новая работа по этой методике"}));
    fireEvent.click(screen.getByRole("button",{name:"Проверить структуру"}));
    const next=sourcePreview();
    expect(next.projectedProject.projectId).not.toBe(original.projectedProject.projectId);
    expect(next.parameters.materialRefs).toEqual([]);
    expect(next.parameters.stepIntents[0].materialRefs).toEqual([]);
    expect(next.projectedWork[1].dependencies[0].predecessorWorkId).toBe(next.projectedProject.projectId+".step-1");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reports direct and downstream impact after a pinned material changes",()=>{
    const props={workspace,events:[],profileDefinition:profile,onOpenObject:()=>{}};
    const {rerender}=render(<RichWorkspaceReadModel {...props} objects={objects}/>);
    createMethod();
    fireEvent.click(screen.getByRole("button",{name:"Проверить структуру"}));
    expect(screen.getByTestId("workspace-method-preview")).toBeTruthy();
    rerender(<RichWorkspaceReadModel {...props} objects={[material("A",5),b,c]}/>);
    expect(screen.queryByTestId("workspace-method-preview")).toBeNull();
    expect(screen.getByTestId("workspace-method-invalid")).toBeTruthy();
    expect(screen.getByTestId("workspace-method-material-changes").textContent).toContain("ред. 1");
    expect(screen.getByTestId("workspace-method-impact").textContent).toContain("Изменились материалы");
    expect(screen.getByTestId("workspace-method-impact").textContent).toContain("Затронуты предшественники");
  });
  it("retains the draft during catalog refresh and hide/show, but not a changed kernel session",()=>{
    const kernel=facade(async()=>null);
    const props={workspace,events:[],profileDefinition:profile,onOpenObject:()=>{},kernel};
    const {rerender}=render(<RichWorkspaceReadModel {...props} objects={objects}/>);
    createMethod();
    fireEvent.click(screen.getByRole("button",{name:"Скрыть методику"}));
    expect(screen.queryByTestId("workspace-method-editor")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Продолжить методику"}));
    expect((screen.getByLabelText("Название проекта") as HTMLInputElement).value).toBe("General research");
    rerender(<RichWorkspaceReadModel {...props} objects={[]} catalogReady={false}/>);
    expect(screen.queryByTestId("workspace-method-editor")).toBeNull();
    rerender(<RichWorkspaceReadModel {...props} objects={objects} catalogReady/>);
    expect((screen.getByLabelText("Название проекта") as HTMLInputElement).value).toBe("General research");
    rerender(<RichWorkspaceReadModel {...props} kernel={facade(async()=>null)} objects={objects}/>);
    expect(screen.queryByTestId("workspace-method-editor")).toBeNull();
    expect(screen.getByRole("button",{name:"Методика",exact:true})).toBeTruthy();
  });
  it("blocks deletion of referenced stages and never accepts a cyclic method",()=>{
    render(<RichWorkspaceReadModel workspace={workspace} objects={objects} events={[]} profileDefinition={profile} onOpenObject={()=>{}}/>);
    createMethod();
    fireEvent.click(screen.getByRole("button",{name:/1\. Prepare/}));
    expect((screen.getByRole("button",{name:"Удалить этап"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Добавить предшествующий этап"),{target:{value:"step-2"}});
    fireEvent.click(screen.getByRole("button",{name:"Проверить структуру"}));
    expect(screen.getByTestId("workspace-method-invalid").textContent).toContain("цикл");
    expect(screen.queryByTestId("workspace-method-preview")).toBeNull();
  });
});
