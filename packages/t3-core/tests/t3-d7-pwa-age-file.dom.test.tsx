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
  it("uses the original native Kernel preview token without revealing the archive to WebView",async()=>{
    withQueue();
    const k=kernel();
    const nativePreview=vi.fn(async()=>({
      status:"KERNEL_PREVIEW_READY" as const,recipientId:"recipient:installed",
      archiveSha256:"a".repeat(64),handle:preview,
    }));
    const noRawOpen=vi.fn();
    const installed={
      canOpen:true,canNativeKernelPreview:true,
      previewInOriginalKernel:nativePreview,open:noRawOpen,
      maxCiphertextBytes:33*1024*1024,
    } as unknown as ReturnType<typeof createTrustedAgeExchange>;
    const getFile=vi.fn(async()=>sealed());
    render(<PackagesView kernel={k} commands={commands} initialTab="export"
      exportScopeId={null} protectedExchange={installed}/>);
    await act(async()=>{
      captured?.({files:[{kind:"file",name:"workspace.iwxa.age",getFile}]});
    });
    await act(async()=>{fireEvent.click(screen.getByTestId("import-pwa-preview"));});
    await waitFor(()=>expect(screen.getByTestId("import-age-preview")).toBeTruthy());
    await act(async()=>{fireEvent.click(screen.getByTestId("import-age-preview"));});
    await waitFor(()=>expect(screen.getByTestId("import-preview")).toBeTruthy());
    expect(nativePreview).toHaveBeenCalledTimes(1);
    expect(noRawOpen).not.toHaveBeenCalled();
    expect(k.importPreview).not.toHaveBeenCalled();
    expect(k.importCommit).not.toHaveBeenCalled();
  });

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
  it("offers original new-workspace restore on confirmed empty local Kernel after age decryption",async()=>{
    const freshPreview={...preview,allowed_modes:["selective","new-workspace"]};
    const k={
      hasOperation:(op:string)=>[
        "t1.listWorkspaces","t2.importPreview","t2.importCommit",
        "t2.importCancel"].includes(op),
      listWorkspaces:vi.fn(async()=>[]),
      importPreview:vi.fn(async()=>freshPreview),
      importCancel:vi.fn(async()=>true),
      importCommit:vi.fn(async()=>{throw Error("MUST_REQUIRE_HUMAN");}),
    } as unknown as KernelFacade;
    const open=vi.fn(async()=>({
      status:"AGE_OPENED_NOT_IMPORTED",
      archiveBytes:Uint8Array.of(80,75,3,4,1,2,3,4),
      archiveSha256:"a".repeat(64),recipientId:"recipient:installed",
      kernelPreviewed:false,accepted:false,
    }));
    const protectedExchange={open,canOpen:true,canSeal:false} as unknown as
      ReturnType<typeof createTrustedAgeExchange>;
    render(<PackagesView kernel={k} commands={commands}
      initialTab="import" exportScopeId={null}
      protectedExchange={protectedExchange}/>);
    const fileInput=screen.getByTestId("import-age-file");
    await act(async()=>{
      fireEvent.change(fileInput,{target:{files:[sealed()]}});
    });
    await act(async()=>{fireEvent.click(screen.getByTestId("import-age-preview"));});
    await waitFor(()=>expect(k.importPreview).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(screen.getByTestId("import-mode")).toHaveProperty(
      "value","new-workspace"));
    expect(screen.getByTestId("import-ws-map")).toBeTruthy();
    expect(screen.queryByTestId("import-receipt")).toBeNull();
    expect(k.importCommit).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(k.listWorkspaces).toHaveBeenCalledTimes(1);
  });
  it("keeps the real import receipt but refuses success if native restore target is absent",async()=>{
    const secure={...preview,allowed_modes:["new-workspace"]};
    let inventoryReads=0;
    const k={
      hasOperation:(op:string)=>[
        "t1.listWorkspaces","t2.importPreview","t2.importCommit",
        "t2.importCancel"].includes(op),
      listWorkspaces:vi.fn(async()=>{inventoryReads++;return [];}), // remains empty
      importPreview:vi.fn(async()=>secure),
      importCancel:vi.fn(async()=>true),
      importCommit:vi.fn(async()=>({
        import_id:"import:verified:one",format:"iwxa.import.receipt",
        format_version:"1.0",mode:"new-workspace",conflict_policy:"fail",
        package_digest:"original",semantic_digest:"original-sem",
        committed_at:"2026-11-15T00:00:00Z",
        workspace_id_map:{"incoming:one":"incoming:one-imported"},
        applied:{workspaces:1,objects_inserted:0,objects_updated:0,
          objects_skipped:0,events:0,relations:0,assets:0,
          schemas_inserted:0,schemas_reused:0,schemas_rejected:0},
        skipped_conflicts:[],excluded_by_permission:{},
      })),
    } as unknown as KernelFacade;
    const age={canOpen:true,canSeal:false,maxArchiveBytes:32*1024*1024,
      maxCiphertextBytes:33*1024*1024,
      open:vi.fn(async()=>({status:"AGE_OPENED_NOT_IMPORTED",
        archiveBytes:Uint8Array.of(80,75,3,4,1,2,3),
        archiveSha256:"a".repeat(64),recipientId:"recipient:installed",
        kernelPreviewed:false,accepted:false}))} as unknown as
      ReturnType<typeof createTrustedAgeExchange>;
    render(<PackagesView kernel={k} commands={commands} initialTab="import"
      exportScopeId={null} protectedExchange={age}/>);
    await act(async()=>{fireEvent.change(screen.getByTestId("import-age-file"),{
      target:{files:[sealed()]},
    });});
    await act(async()=>{fireEvent.click(screen.getByTestId("import-age-preview"));});
    await waitFor(()=>expect(screen.getByTestId("import-mode")).toHaveProperty(
      "value","new-workspace"));
    await act(async()=>{fireEvent.click(screen.getByTestId("import-commit"));});
    await waitFor(()=>expect(screen.getByTestId("import-view").getAttribute(
      "data-import-state")).toBe("unconfirmed"));
    expect(screen.getByTestId("import-receipt")).toBeTruthy();
    expect(screen.getByTestId("import-incomplete-notice").textContent)
      .toContain("не будет автоматически повторена");
    expect(k.importCommit).toHaveBeenCalledTimes(1);
    expect(inventoryReads).toBe(2);
  });

  it("invalidates the old Kernel preview on a second OS launch of the SAME protected handle",async()=>{
    withQueue();
    let release!: (value:typeof preview)=>void;
    const pending=new Promise<typeof preview>(resolve=>{release=resolve;});
    const importPreview=vi.fn(async()=>pending);
    const importCancel=vi.fn(async()=>true);
    const k={hasOperation:(op:string)=>[
      "t2.importPreview","t2.importCommit","t2.importCancel"].includes(op),
      listWorkspaces:vi.fn(async()=>[]),importPreview,importCancel,
      importCommit:vi.fn(async()=>{throw Error("NEVER_AUTO_COMMIT");}),
    } as unknown as KernelFacade;
    const open=vi.fn(async()=>({
      status:"AGE_OPENED_NOT_IMPORTED",
      archiveBytes:Uint8Array.of(80,75,3,4,1,2,3),
      archiveSha256:"a".repeat(64),recipientId:"recipient:installed",
      kernelPreviewed:false,accepted:false,
    }));
    const protectedExchange={open,canOpen:true,canSeal:false} as unknown as
      ReturnType<typeof createTrustedAgeExchange>;
    const sameHandle={kind:"file",name:"workspace.iwxa.age",
      getFile:vi.fn(async()=>sealed())};
    render(<PackagesView kernel={k} commands={commands} initialTab="import"
      exportScopeId={null} protectedExchange={protectedExchange}/>);
    await act(async()=>{captured?.({files:[sameHandle]});});
    await act(async()=>{fireEvent.click(screen.getByTestId("import-pwa-preview"));});
    await waitFor(()=>expect(screen.getByTestId("import-age-preview")).toBeTruthy());
    await act(async()=>{fireEvent.click(screen.getByTestId("import-age-preview"));});
    await waitFor(()=>expect(importPreview).toHaveBeenCalledTimes(1));
    // The OS is allowed to reuse the same native FileSystemFileHandle object.
    // This launch must invalidate the earlier unresolved Kernel preview.
    await act(async()=>{captured?.({files:[sameHandle]});});
    await act(async()=>{release(preview);});
    await waitFor(()=>expect(importCancel).toHaveBeenCalledWith("tok:age"));
    expect(screen.queryByTestId("import-preview")).toBeNull();
    expect(k.importCommit).not.toHaveBeenCalled();
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
  it("does not offer age decrypt without native recipient or signed Workspace read",async()=>{
    withQueue();
    const k=kernel();
    const getFile=vi.fn(async()=>sealed());
    const age={canOpen:false,canSeal:false,open:vi.fn()} as unknown as
      ReturnType<typeof createTrustedAgeExchange>;
    render(<PackagesView kernel={k} commands={commands}
      initialTab="import" exportScopeId={null} protectedExchange={age}/>);
    expect(screen.queryByTestId("import-age-protected")).toBeNull();
    expect(screen.getByTestId("import-age-owner-unavailable").textContent)
      .toContain("недоступна");
    await act(async()=>{captured?.({files:[{
      kind:"file",name:"workspace.iwxa.age",getFile,
    }]});});
    expect(screen.getByTestId("import-pwa-launch-error").textContent)
      .toContain("не подключена");
    expect(getFile).not.toHaveBeenCalled();
    expect(age.open).not.toHaveBeenCalled();
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
