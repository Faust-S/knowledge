// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {PackagesView} from "@/modules/exchange/features/packages/PackagesView";
import type {CommandsFacade,KernelFacade} from "@/workspace-contract";
import type {createTrustedAgeExchange,createTrustedPublisherHandoff} from "@/t3/index.mjs";

const commands={has:()=>false,invoke:async()=>undefined} as CommandsFacade;
const preview={
  preview_token:"tok:age",package_digest:"original",semantic_digest:"original-sem",
  expires_at:"2099-01-01T00:00:00Z",allowed_modes:["selective"],
  preview:{
    totals:{files:1,workspaces:1,objects:0,events:0,relations:0,assets:0,schemas:0},
    workspaces:[{workspace_id:"incoming:one",exists_locally:false,
      incoming_objects:0,incoming_events:0,incoming_relations:0,incoming_assets:0}],
    schemas:[],objects:[],conflicts:[],unsupported:[],warnings:[],
  },
};
function kernel(ops:string[]=["t2.importPreview","t2.importCommit","t2.importCancel"]){
  return {hasOperation:(op:string)=>ops.includes(op),
    listWorkspaces:vi.fn(async()=>[]),
    importPreview:vi.fn(async()=>preview),
    importCancel:vi.fn(async()=>true),
    importCommit:vi.fn(async()=>{throw Error("NEVER_COMMIT_WITHOUT_HUMAN");}),
  } as unknown as KernelFacade;
}
type Consumer=(params:{files?:readonly unknown[]})=>void;
let captured:Consumer|null=null;
const originalLaunchQueue=Object.getOwnPropertyDescriptor(window,"launchQueue");
function withQueue(){
  Object.defineProperty(window,"launchQueue",{
    configurable:true,value:{setConsumer:(next:Consumer)=>{captured=next;}},
  });
}
afterEach(()=>{
  cleanup();captured=null;
  if(originalLaunchQueue)
    Object.defineProperty(window,"launchQueue",originalLaunchQueue);
  else delete (window as unknown as {launchQueue?:unknown}).launchQueue;
});
const sealed=()=>new File([Uint8Array.of(97,103,101,45,98,121,116,101,115)],
  "workspace.iwxa.age",{type:"application/octet-stream"});

describe("D7 installed PWA protected .iwxa.age through original Exchange",()=>{
  it("keeps OS file opaque until user selects it, then separate age.open and original Kernel preview",async()=>{
    withQueue();
    const k=kernel();
    const open=vi.fn(async()=>({
      status:"AGE_OPENED_NOT_IMPORTED",archiveBytes:Uint8Array.of(80,75,3,4,1,2,3),
      archiveSha256:"a".repeat(64),recipientId:"recipient:installed",
      kernelPreviewed:false,accepted:false,
    }));
    const protectedExchange={open} as unknown as ReturnType<typeof createTrustedAgeExchange>;
    const getFile=vi.fn(async()=>sealed());
    render(<PackagesView kernel={k} commands={commands} initialTab="export"
      exportScopeId={null} protectedExchange={protectedExchange}/>);
    await act(async()=>{captured?.({files:[{kind:"file",name:"workspace.iwxa.age",getFile}]});});
    expect(screen.getByTestId("import-pwa-file")).toBeTruthy();
    expect(getFile).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(k.importPreview).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByTestId("import-pwa-preview"));});
    await waitFor(()=>expect(screen.getByTestId("import-age-preview")).toBeTruthy());
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(k.importPreview).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByTestId("import-age-preview"));});
    await waitFor(()=>expect(k.importPreview).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledTimes(1);
    expect(k.importCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("import-preview")).toBeTruthy();
  });
  it("never even reads OS protected file if native age owner is absent",async()=>{
    withQueue();
    const getFile=vi.fn(async()=>sealed());
    const k=kernel();
    render(<PackagesView kernel={k} commands={commands} initialTab="import"
      exportScopeId={null}/>);
    await act(async()=>{captured?.({files:[{kind:"file",name:"workspace.iwxa.age",getFile}]});});
    expect(screen.getByTestId("import-pwa-launch-error").textContent).toContain("не подключена");
    expect(screen.queryByTestId("import-pwa-file")).toBeNull();
    expect(getFile).not.toHaveBeenCalled();
    expect(k.importPreview).not.toHaveBeenCalled();
  });
  it("shows only original Publisher holder when normal T2 data Exchange is not granted",()=>{
    const k=kernel([]);
    const publisher={preview:vi.fn(),admit:vi.fn(),recover:vi.fn()} as unknown as ReturnType<typeof createTrustedPublisherHandoff>;
    render(<PackagesView kernel={k} commands={commands} initialTab="export"
      exportScopeId={null} publisherHandoff={publisher}/>);
    expect(screen.getByTestId("t3-publisher-license-panel")).toBeTruthy();
    expect(screen.queryByTestId("export-view")).toBeNull();
    expect(screen.queryByTestId("packages-tab-export")).toBeNull();
  });
});
