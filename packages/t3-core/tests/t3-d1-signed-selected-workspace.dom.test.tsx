// @vitest-environment jsdom
// The signed first-run path only READS through the existing JIT ModuleContext,
// never provisions or enumerates the unsigned original T2 client.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { KernelFacade, CommandsFacade } from "@/workspace-contract";
import type {createTrustedPublisherHandoff,createTrustedAgeExchange}
  from "@/t3/index.mjs";
import type { CreateWorkspaceHostRuntimeInput } from "@/workspace-host/runtime";
import { SignedSelectedWorkspaceGate } from "@/workspace-host/bootstrap/SignedSelectedWorkspaceGate";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function kernel(rows: unknown[] | Promise<unknown[]>) {
  const listWorkspaces = vi.fn().mockImplementation(() => Promise.resolve(rows));
  const createWorkspace = vi.fn();
  return {
    value: { listWorkspaces, createWorkspace } as unknown as KernelFacade,
    listWorkspaces, createWorkspace,
  };
}
it("a ready signed Workspace is visible only after exact authorized Kernel read", async () => {
  const owner = kernel([{ workspace_id:"ws:organization-a", profile:"generic" }]);
  render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="selected-owner-content">Организация A</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("selected-owner-content");
  expect(owner.listWorkspaces).toHaveBeenCalledTimes(1);
  expect(owner.listWorkspaces).toHaveBeenCalledWith({ include_deleted:false });
  expect(owner.createWorkspace).not.toHaveBeenCalled();
});
it("installed Admin inspects only the original Control-selected Workspace, not listWorkspaces",async()=>{
  let current:{workspace_id:string;profile:string}|null=null;
  const listWorkspaces=vi.fn(async()=>{throw new Error("UNSIGNED_LIST_DENIED");});
  const getWorkspace=vi.fn(async(id:string)=>{
    expect(id).toBe("ws:admin-original");
    return current;
  });
  const createWorkspace=vi.fn(async (command:{workspace_id:string;profile:string})=>{
    current=command;return command;
  });
  const owner={
    listWorkspaces,getWorkspace,createWorkspace,
    hasOperation:(op:string)=>op==="t1.createWorkspace",
  } as unknown as KernelFacade;
  const trustedSelectedContext=vi.fn(async(operation:string)=>{
    expect(["getWorkspace","createWorkspace"]).toContain(operation);
    return {kind:"CORP" as const,workspace_id:"ws:admin-original",
      resource:"ws:admin-original",organization_id:"org:admin"};
  });
  render(<SignedSelectedWorkspaceGate required kernel={owner}
    profile="generic" autoCreateSignedCorporate={false}
    trustedSelectedContext={trustedSelectedContext}>
    <p data-testid="signed-admin-original-ready">Оригинальная Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(screen.queryByTestId("signed-admin-original-ready")).toBeNull();
  expect(listWorkspaces).not.toHaveBeenCalled();
  expect(getWorkspace).toHaveBeenCalledWith("ws:admin-original");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("signed-admin-original-ready");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({
    workspace_id:"ws:admin-original",profile:"generic",
  });
  expect(listWorkspaces).not.toHaveBeenCalled();
});
it("typed original T2 missing Workspace permits only a separately signed first-run create",async()=>{
  let stored:{workspace_id:string;profile:string}|null=null;
  const getWorkspace=vi.fn(async(id:string)=>{
    expect(id).toBe("ws:original-missing");
    if(stored===null)throw Object.assign(
      new Error("WORKSPACE_NOT_FOUND"),{code:"WORKSPACE_NOT_FOUND"});
    return stored;
  });
  const createWorkspace=vi.fn(async(input:{workspace_id:string;profile:string})=>{
    stored={...input};return {...input};
  });
  const listWorkspaces=vi.fn(async()=>{
    throw Error("UNSIGNED_DISCOVERY_MUST_NOT_RUN");
  });
  const candidate={getWorkspace,createWorkspace,listWorkspaces,
    hasOperation:(name:string)=>name==="t1.createWorkspace"} as unknown as KernelFacade;
  const trustedSelectedContext=vi.fn(async(method:string)=>{
    expect(["getWorkspace","createWorkspace"]).toContain(method);
    return {kind:"CORP" as const,workspace_id:"ws:original-missing",
      resource:"ws:original-missing",organization_id:"org:original"};
  });
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" autoCreateSignedCorporate={false}
    trustedSelectedContext={trustedSelectedContext}>
    <p data-testid="typed-original-created">Original selected Workspace</p>
  </SignedSelectedWorkspaceGate>);
  const initial=await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(initial.textContent).toMatch(/пока нет рабочей области/);
  expect(createWorkspace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("typed-original-created");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({
    workspace_id:"ws:original-missing",profile:"generic",
  });
  expect(getWorkspace).toHaveBeenCalledTimes(3);
  expect(listWorkspaces).not.toHaveBeenCalled();
});

it("original signed corporate key automatically creates its Workspace with the same Kernel",async()=>{
  let stored:{workspace_id:string;profile:string}|null=null;
  const getWorkspace=vi.fn(async()=>stored);
  const createWorkspace=vi.fn(async(input:{workspace_id:string;profile:string})=>{
    stored={...input};return {...input};
  });
  const listWorkspaces=vi.fn(async()=>{throw Error("UNSIGNED_LIST_DENIED");});
  const kernel={getWorkspace,createWorkspace,listWorkspaces,
    hasOperation:(name:string)=>name==="t1.createWorkspace"} as unknown as KernelFacade;
  const original=vi.fn(async (method:string)=>{
    expect(["getWorkspace","createWorkspace"]).toContain(method);
    return {kind:"CORP" as const,organization_id:"org:company",
      workspace_id:"ws:company-by-key",resource:"ws:company-by-key"};
  });
  render(<SignedSelectedWorkspaceGate required kernel={kernel}
    profile="generic" trustedSelectedContext={original}>
    <p data-testid="original-auto-company">Компания</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("original-auto-company");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({
    workspace_id:"ws:company-by-key",profile:"generic",
  });
  expect(listWorkspaces).not.toHaveBeenCalled();
  expect(original.mock.calls.map(([op])=>op)).toEqual(["getWorkspace","createWorkspace"]);
  expect(getWorkspace).toHaveBeenCalledTimes(3);
});
it("a signed company key without a distinct create grant never creates automatically",async()=>{
  const createWorkspace=vi.fn();
  const kernel={getWorkspace:vi.fn(async()=>null),createWorkspace,
    hasOperation:()=>true} as unknown as KernelFacade;
  const original=vi.fn(async(method:string)=>method==="getWorkspace"
    ?{kind:"CORP" as const,organization_id:"org:company",
       workspace_id:"ws:missing",resource:"ws:missing"}:null);
  render(<SignedSelectedWorkspaceGate required kernel={kernel}
    profile="generic" trustedSelectedContext={original}>
    <p data-testid="no-unsigned-company">Не показывать</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  await waitFor(()=>expect(original).toHaveBeenCalledWith("createWorkspace"));
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("no-unsigned-company")).toBeNull();
  await screen.findByTestId("t3-d1-create-workspace-error");
  expect(original.mock.calls.map(([op])=>op)).toEqual(["getWorkspace","createWorkspace"]);
});
it("auto-create never requests write authority for a PERSONAL selection",async()=>{
  const createWorkspace=vi.fn();
  const kernel={getWorkspace:vi.fn(async()=>null),createWorkspace,
    hasOperation:()=>true} as unknown as KernelFacade;
  const original=vi.fn(async(method:string)=>({
    kind:"PERSONAL" as const,organization_id:null,
    workspace_id:"ws:personal-first",resource:"ws:personal-first",
  }));
  render(<SignedSelectedWorkspaceGate required kernel={kernel} profile="generic"
    trustedSelectedContext={original}><p data-testid="personal-ready">Ready</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(original.mock.calls.map(([op])=>op)).toEqual(["getWorkspace"]);
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("personal-ready")).toBeNull();
});
it("automatic signed create rejects a changed organization without a second context request",async()=>{
  const getWorkspace=vi.fn(async()=>null),createWorkspace=vi.fn();
  const kernel={getWorkspace,createWorkspace,
    hasOperation:()=>true} as unknown as KernelFacade;
  const original=vi.fn(async(method:string)=>({
    kind:"CORP" as const,organization_id:method==="getWorkspace"?"org:first":"org:other",
    workspace_id:"ws:company",resource:"ws:company",
  }));
  render(<SignedSelectedWorkspaceGate required kernel={kernel} profile="generic"
    trustedSelectedContext={original}><p data-testid="foreign-ready">Ready</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-create-workspace-error");
  expect(original.mock.calls.map(([op])=>op)).toEqual(["getWorkspace","createWorkspace"]);
  expect(getWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("foreign-ready")).toBeNull();
});

it("typed original permission denial is NEVER converted to missing or signed create",async()=>{
  const getWorkspace=vi.fn(async()=>{
    throw Object.assign(new Error("PERMISSION_DENIED"),{code:"PERMISSION_DENIED"});
  });
  const createWorkspace=vi.fn();
  const candidate={getWorkspace,createWorkspace,
    listWorkspaces:vi.fn(async()=>[]),
    hasOperation:()=>true} as unknown as KernelFacade;
  const trustedSelectedContext=vi.fn(async()=>({
    kind:"CORP" as const,workspace_id:"ws:denied",
    resource:"ws:denied",organization_id:"org:denied",
  }));
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" autoCreateSignedCorporate={false}
    trustedSelectedContext={trustedSelectedContext}>
    <p data-testid="denied-original-content">Must remain hidden</p>
  </SignedSelectedWorkspaceGate>);
  const msg=await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(msg.textContent).toMatch(/Control не подтвердил/);
  expect(screen.getByTestId("t3-d1-selected-workspace-diagnostic").textContent).toContain("READ_KERNEL: PERMISSION_DENIED");
  expect(screen.queryByTestId("t3-d1-create-selected-workspace")).toBeNull();
  expect(screen.queryByTestId("denied-original-content")).toBeNull();
  expect(createWorkspace).not.toHaveBeenCalled();
});

it("missing selected Workspace displays concrete preparation step, never unsigned creation", async () => {
  const owner = kernel([]);
  render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="unexpected-content">Не показывать</p>
  </SignedSelectedWorkspaceGate>);
  const text = await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(text.textContent).toMatch(/пока нет рабочей области/);
  expect(screen.queryByTestId("unexpected-content")).toBeNull();
  expect(owner.createWorkspace).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button",{name:"Проверить повторно"})));
  await waitFor(() => expect(owner.listWorkspaces).toHaveBeenCalledTimes(2));
  expect(owner.createWorkspace).not.toHaveBeenCalled();
});
it("denial cannot render signed children; ordinary site is unaffected", async () => {
  const owner = kernel(Promise.reject(Object.assign(new Error("denied"),{code:"T3_ACCESS_NOT_PERMITTED"})));
  const view = render(<SignedSelectedWorkspaceGate required kernel={owner.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(screen.queryByTestId("workspace-visible")).toBeNull();
  view.rerender(<SignedSelectedWorkspaceGate required={false} kernel={owner.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  expect(screen.getByTestId("workspace-visible")).toBeTruthy();
});
it("late read from replaced corporate owner never reveals prior Workspace", async () => {
  let resolveOld!: (rows: unknown[]) => void;
  const oldPromise = new Promise<unknown[]>(resolve => { resolveOld = resolve; });
  const old = kernel(oldPromise);
  const fresh = kernel([]);
  const view = render(<SignedSelectedWorkspaceGate required kernel={old.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  view.rerender(<SignedSelectedWorkspaceGate required kernel={fresh.value}>
    <p data-testid="workspace-visible">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  await act(async () => resolveOld([{workspace_id:"ws:previous-organization",profile:"generic"}]));
  expect(screen.queryByTestId("workspace-visible")).toBeNull();
  expect(old.createWorkspace).not.toHaveBeenCalled();
  expect(fresh.createWorkspace).not.toHaveBeenCalled();
});

type SignedResolver=NonNullable<CreateWorkspaceHostRuntimeInput["signedKernelAccess"]>;
const selectedPort=(id:string,resource=id)=>({currentContext:async()=>({
  kind:"CORP",workspace_id:id,resource,organization_id:"org:approved",
})});

it("explicit signed create ACTION creates the selected Workspace via original Kernel",async()=>{
  let rows: Array<{workspace_id:string;profile:string}>=[];
  const listWorkspaces=vi.fn(async()=>rows);
  const getWorkspace=vi.fn(async(id:string)=>rows.find(r=>r.workspace_id===id)??null);
  const createWorkspace=vi.fn(async(command:{workspace_id:string;profile:string})=>{
    rows=[{...command}];return {...command};
  });
  const candidate={listWorkspaces,getWorkspace,createWorkspace,
    hasOperation:(op:string)=>op==="t1.createWorkspace"} as unknown as KernelFacade;
  const resolve=vi.fn(async(operation:string)=>{
    expect(operation).toBe("createWorkspace");
    return selectedPort("ws:approved");
  }) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" signedKernelAccess={resolve}>
    <p data-testid="selected-owner-content">Подписанная Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("selected-owner-content");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({workspace_id:"ws:approved",profile:"generic"});
  expect(getWorkspace).toHaveBeenCalledWith("ws:approved");
  expect(listWorkspaces).toHaveBeenCalledTimes(1);
});

it("without independent create grant original T2 writer is never invoked",async()=>{
  const createWorkspace=vi.fn();
  const candidate={
    listWorkspaces:vi.fn(async()=>[]),getWorkspace:vi.fn(async()=>null),
    hasOperation:(op:string)=>op==="t1.createWorkspace",createWorkspace,
  } as unknown as KernelFacade;
  const resolver=vi.fn(async()=>null) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" signedKernelAccess={resolver}>
    <p data-testid="forbidden">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("t3-d1-create-workspace-error");
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("forbidden")).toBeNull();
});

it("foreign Workspace ID from signed port never reaches Kernel.createWorkspace",async()=>{
  const createWorkspace=vi.fn();
  const candidate={
    listWorkspaces:vi.fn(async()=>[]),getWorkspace:vi.fn(async()=>null),
    hasOperation:()=>true,createWorkspace,
  } as unknown as KernelFacade;
  const resolver=vi.fn(async()=>selectedPort("ws:north","ws:south")) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" signedKernelAccess={resolver}>
    <p data-testid="forbidden">Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("t3-d1-create-workspace-error");
  expect(createWorkspace).not.toHaveBeenCalled();
});

it("uncertain Kernel acknowledgement is recovered by exact original ID readback",async()=>{
  let saved:{workspace_id:string;profile:string}|null=null;
  const createWorkspace=vi.fn(async(command:{workspace_id:string;profile:string})=>{
    saved=command;throw new Error("lost create acknowledgement");
  });
  const candidate={
    listWorkspaces:vi.fn(async()=>[]),
    getWorkspace:vi.fn(async(id:string)=>saved?.workspace_id===id?saved:null),
    hasOperation:()=>true,createWorkspace,
  } as unknown as KernelFacade;
  const resolver=vi.fn(async()=>selectedPort("ws:north")) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={candidate}
    profile="generic" signedKernelAccess={resolver}>
    <p data-testid="created-content">Подтверждена</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("created-content");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({workspace_id:"ws:north",profile:"generic"});
});

it("PERSONAL first-run uses the same explicitly signed original Kernel create path",async()=>{
  let rows:Array<{workspace_id:string;profile:string}>=[];
  const listWorkspaces=vi.fn(async()=>rows);
  const getWorkspace=vi.fn(async(id:string)=>
    rows.find(row=>row.workspace_id===id)??null);
  const createWorkspace=vi.fn(async(input:{workspace_id:string;profile:string})=>{
    rows=[{...input}];return {...input};
  });
  const facade={listWorkspaces,getWorkspace,createWorkspace,
    hasOperation:(operation:string)=>operation==="t1.createWorkspace"
  } as unknown as KernelFacade;
  const owner=vi.fn(async()=>({
    currentContext:async()=>({
      kind:"PERSONAL",organization_id:null,
      workspace_id:"ws:personal",resource:"ws:personal"
    })
  })) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={facade}
    profile="generic" signedKernelAccess={owner}>
    <p data-testid="personal-workspace-ready">Личная Workspace</p>
  </SignedSelectedWorkspaceGate>);
  const missing=await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(missing.textContent).toMatch(/выбранного профиля/);
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("personal-workspace-ready");
  expect(createWorkspace).toHaveBeenCalledTimes(1);
  expect(createWorkspace).toHaveBeenCalledWith({
    workspace_id:"ws:personal",profile:"generic",
  });
  expect(getWorkspace).toHaveBeenCalledWith("ws:personal");
});
it("PERSONAL spoof with a non-null organization never invokes the original writer",async()=>{
  const createWorkspace=vi.fn(),getWorkspace=vi.fn(async()=>null);
  const facade={listWorkspaces:vi.fn(async()=>[]),getWorkspace,
    createWorkspace,hasOperation:()=>true} as unknown as KernelFacade;
  const owner=vi.fn(async()=>({
    currentContext:async()=>({
      kind:"PERSONAL",organization_id:"org:someone",
      workspace_id:"ws:personal",resource:"ws:personal",
    }),
  })) as unknown as SignedResolver;
  render(<SignedSelectedWorkspaceGate required kernel={facade}
    profile="generic" signedKernelAccess={owner}>
    <p data-testid="unauthorized-workspace">Not allowed</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
  await screen.findByTestId("t3-d1-create-workspace-error");
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(getWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("unauthorized-workspace")).toBeNull();
});

it("D7 installed Publisher can receive a signed licence before Workspace without opening its data",async()=>{
  const listWorkspaces=vi.fn(async()=>[]);
  const k={listWorkspaces,
    hasOperation:()=>false} as unknown as KernelFacade;
  const publisher={preview:vi.fn(),admit:vi.fn(),recover:vi.fn()} as unknown as
    ReturnType<typeof createTrustedPublisherHandoff>;
  const commands={has:()=>false,invoke:async()=>undefined} as CommandsFacade;
  render(<SignedSelectedWorkspaceGate required kernel={k} firstRunExchange={{
    kernel:k,commands,publisherHandoff:publisher,protectedExchange:null,
  }}>
    <p data-testid="unauthorized-workspace">Do not show Workspace</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(screen.getByTestId("t3-d7-first-run-exchange")).toBeTruthy();
  expect(screen.getByTestId("t3-publisher-license-panel")).toBeTruthy();
  expect(screen.queryByTestId("unauthorized-workspace")).toBeNull();
  expect(screen.queryByTestId("import-view")).toBeNull();
  expect(listWorkspaces).toHaveBeenCalledTimes(1);
  expect(publisher.admit).not.toHaveBeenCalled();
});
it("D7 clean-install age restore offers original Kernel preview only if native open exists",async()=>{
  const importPreview=vi.fn();
  const k={listWorkspaces:vi.fn(async()=>[]),importPreview,
    hasOperation:(op:string)=>op==="t2.importPreview"} as unknown as KernelFacade;
  const commands={has:()=>false,invoke:async()=>undefined} as CommandsFacade;
  const age={canOpen:true,canSeal:false,maxArchiveBytes:32*1024*1024,
    maxCiphertextBytes:33*1024*1024,open:vi.fn()} as unknown as
    ReturnType<typeof createTrustedAgeExchange>;
  const view=render(<SignedSelectedWorkspaceGate required kernel={k}
    firstRunExchange={{kernel:k,commands,publisherHandoff:null,protectedExchange:age}}>
    <p data-testid="unauthorized-workspace">Protected</p>
  </SignedSelectedWorkspaceGate>);
  await screen.findByTestId("t3-d1-selected-workspace-message");
  expect(screen.getByTestId("import-age-protected")).toBeTruthy();
  expect(screen.queryByTestId("unauthorized-workspace")).toBeNull();
  expect(importPreview).not.toHaveBeenCalled();
  view.rerender(<SignedSelectedWorkspaceGate required kernel={k}
    firstRunExchange={{kernel:k,commands,publisherHandoff:null,
      protectedExchange:{...age,canOpen:false}}}>
    <p data-testid="unauthorized-workspace">Protected</p>
  </SignedSelectedWorkspaceGate>);
  expect(screen.queryByTestId("import-age-protected")).toBeNull();
  expect(importPreview).not.toHaveBeenCalled();
});


it("signed first-run refuses to create a different workspace or organization than its confirmed read",async()=>{
  for(const foreign of [{workspace_id:"ws:other",resource:"ws:other",organization_id:"org:company"},
    {workspace_id:"ws:selected",resource:"ws:selected",organization_id:"org:other"}]){
    const getWorkspace=vi.fn(async()=>null),createWorkspace=vi.fn();
    const value={getWorkspace,createWorkspace,hasOperation:()=>true} as unknown as KernelFacade;
    const resolver=vi.fn(async(operation:string)=>({kind:"CORP" as const,
      workspace_id:"ws:selected",resource:"ws:selected",organization_id:"org:company",
      ...(operation==="createWorkspace"?foreign:{})}));
    const view=render(<SignedSelectedWorkspaceGate required kernel={value}
      profile="generic" autoCreateSignedCorporate={false} trustedSelectedContext={resolver}>
      <p data-testid="foreign-ready">Wrong subject</p>
    </SignedSelectedWorkspaceGate>);
    await screen.findByTestId("t3-d1-selected-workspace-message");
    fireEvent.click(screen.getByTestId("t3-d1-create-selected-workspace"));
    await screen.findByTestId("t3-d1-create-workspace-error");
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(getWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("foreign-ready")).toBeNull();
    view.unmount();
  }
});
it("first-run diagnostic never exposes untyped private exception detail or treats it as absence",async()=>{
  const getWorkspace=vi.fn(async()=>{throw Object.assign(Error("secret subject path"),{code:"arbitrary detail"})});
  const createWorkspace=vi.fn();
  const kernel={getWorkspace,createWorkspace,hasOperation:()=>true} as unknown as KernelFacade;
  render(<SignedSelectedWorkspaceGate required kernel={kernel} profile="generic"
    trustedSelectedContext={async()=>({kind:"CORP",workspace_id:"ws:one",resource:"ws:one",organization_id:"org:one"})}>
    <p data-testid="hidden-uncertain-workspace">Wrong</p>
  </SignedSelectedWorkspaceGate>);
  const diagnostic=await screen.findByTestId("t3-d1-selected-workspace-diagnostic");
  expect(diagnostic.textContent).toContain("READ_KERNEL: T3_D1_SELECTED_WORKSPACE_UNVERIFIED");
  expect(diagnostic.textContent).not.toMatch(/secret|arbitrary/);
  expect(createWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByTestId("t3-d1-create-selected-workspace")).toBeNull();
});
