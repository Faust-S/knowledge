// Installed D2 failure triage: execute the ORIGINAL private signer against
// the ORIGINAL public D1 JIT, with a minimal read-only T2 facade. This file
// contains no signer, private fixture, user key, second IAM or Kernel.
// Run only from the public isolated Windows workflow after private checkout.
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createSignedAccessHostPort} from "../src/t3/signed-access-host-port.mjs";
import {createSubjectKernelBinding} from "../src/t3/subject-access-binding.mjs";

const code = error => {
  const raw = error && typeof error === "object"
    ? (typeof error.code === "string" ? error.code : error.message)
    : null;
  return typeof raw === "string" && /^[A-Z][A-Z0-9_]{4,99}$/.test(raw)
    ? raw : "D2_ORIGINAL_JIT_UNCLASSIFIED";
};
const check=(condition,reason)=>{
  if(!condition)throw Object.assign(new Error(reason),{code:reason});
};
let root=null,owner=null,nativeHost=null;
try{
  check(process.argv.length===3,"D2_ORIGINAL_PRIVATE_ROOT_REQUIRED");
  const native=resolve(process.argv[2]);
  const [{provision,I},{openInterop},{createOriginalAdminD3HostPort}]=
    await Promise.all([
      import(pathToFileURL(join(native,"interop/provision.mjs")).href),
      import(pathToFileURL(join(native,"interop/runtime.mjs")).href),
      import(pathToFileURL(join(native,"interop/native-admin-d3.mjs")).href),
    ]);
  root=mkdtempSync(join(tmpdir(),"iwxa-d2-original-jit-"));
  const NOW=Date.parse("2026-11-22T08:00:00.000Z");
  const passphrase="ephemeral-isolated-original-jit";
  const identity={...I,person:I.reviewer};
  provision({adminRoot:join(root,"admin"),
    controlRoot:join(root,"admin/personal-control"),
    identity,environment:"PRODUCTION",passphrase,now:NOW});
  // Match the installed private Owner's two explicitly selected operator
  // records, instead of using openInterop's legacy synthetic fallback.
  const operators={
    schema:"IWXA_T3_LOCAL_ORGANIZATIONAL_OPERATORS/1",
    custody:"WINDOWS_DPAPI_CURRENT_USER",productionActivation:true,
    operators:[
      {id:"issuer",name:"Issuer",personId:I.reviewer,keyId:I.issuer,
        vault:"vault.json",adminGrantId:"grant:admin"},
      {id:"reviewer",name:"Manager",personId:I.reviewer,keyId:I.reviewKey,
        vault:"vault.json",acceptanceGrantId:"grant:review"},
    ],
  };
  writeFileSync(join(root,"admin/operators.json"),JSON.stringify(operators),
    {flag:"wx"});
  owner=openInterop({root:join(root,"admin"),product:"admin",passphrase,
    clock:()=>NOW});
  // The installed first-run ceremony issues a real signed initial
  // invitation BEFORE the reviewer opens the private Control Host. Testing
  // pre-invitation permissions alone would miss changes to registry status.
  owner.selectOperator("issuer");
  const invited=owner.invite({activityRead:false,workspaceRead:false,
    workspaceWrite:false,workspaceCreate:false});
  check(invited instanceof Uint8Array&&invited.byteLength>0,
    "D2_ORIGINAL_SIGNED_FIRST_INVITATION_NOT_CONFIRMED");
  owner.selectOperator("reviewer");
  // Use the original signed DATA grant and the existing One Core port.
  // No native credential or exception payload crosses the public CI log.
  const readAccess=owner.signedAdminWorkspaceReadAccess(createSignedAccessHostPort);
  const scope=readAccess.currentContext();
  check(scope?.workspace_id===I.workspace&&scope.grant_id==="grant:workspace-read",
    "D2_ORIGINAL_WORKSPACE_READ_SCOPE_MISMATCH");
  const calls=[];
  const kernel={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:operation=>operation==="t1.getWorkspace",
    getWorkspace:async workspaceId=>{
      calls.push(workspaceId);
      return null; // Original T2 absence, no fake successful workspace.
    },
  };
  const binding=createSubjectKernelBinding({kernel,access:readAccess,
    clock:()=>NOW});
  const observed=await binding.getWorkspace(I.workspace);
  check(observed===null&&calls.length===1&&calls[0]===I.workspace,
    "D2_ORIGINAL_WORKSPACE_READ_JIT_NOT_DISPATCHED");
  // The installed native product resolves getWorkspace through precisely
  // this ORIGINAL private Control owner, NOT directly from openInterop.
  nativeHost=createOriginalAdminD3HostPort({
    runtime:owner,isHostActive:()=>true,currentHostEpoch:async()=>1,
    confirmHumanReview:async()=>false,
  });
  const nativePort=await nativeHost.controlKernelOwnerFor(
    {scope:"kernel",operation:"getWorkspace"},createSignedAccessHostPort);
  check(nativePort!==null&&
    (await nativePort.currentContext()).grant_id==="grant:workspace-read"&&
    (await nativePort.actionFor("t1.getWorkspace"))==="workspace.read",
    "D2_ORIGINAL_CONTROL_GET_WORKSPACE_NOT_SELECTED");
  const nativeRead=createSubjectKernelBinding({kernel,access:nativePort,
    clock:()=>NOW});
  check(await nativeRead.getWorkspace(I.workspace)===null&&
    calls.length===2&&calls[1]===I.workspace,
    "D2_ORIGINAL_CONTROL_GET_WORKSPACE_JIT_FAILED");
  console.log("D2_ORIGINAL_PRIVATE_CONTROL_WORKSPACE_READ_JIT_PASS");
  // First-run creation remains a different signed ACTION. Merely reading
  // the missing original Workspace must never dispatch any create call.
  const onboarding=owner.signedAdminWorkspaceOnboardingAccess(
    createSignedAccessHostPort);
  const c=onboarding.currentContext();
  check(c?.grant_id==="grant:workspace-onboarding"&&
    onboarding.actionFor("t1.createWorkspace")==="workspace.create",
    "D2_ORIGINAL_WORKSPACE_CREATE_GRANT_NOT_DISTINCT");
  console.log("D2_ORIGINAL_PRIVATE_WORKSPACE_READ_JIT_PASS");
  console.log("D2_ORIGINAL_PRIVATE_SEPARATE_CREATE_GRANT_PASS");
  // Deterministic T2 facade stub for an at-most-once signed JIT contract
  // regression. This does NOT count as installed original Kernel evidence.
  // The real installed D2 job below must independently perform that read.
  let kernelCreateCalls=0,created=null;
  const createKernel={
    sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
    hasOperation:op=>op==="t1.getWorkspace"||op==="t1.createWorkspace",
    getWorkspace:async id=>created?.workspace_id===id?created:null,
    createWorkspace:async input=>{
      kernelCreateCalls++;
      created={...input,deleted_at:null};
      return created;
    },
  };
  const authorizedCreate=await nativeHost.controlKernelOwnerFor(
    {scope:"kernel",operation:"createWorkspace"},createSignedAccessHostPort);
  const first=createSubjectKernelBinding({
    kernel:createKernel,access:authorizedCreate,clock:()=>NOW,
  });
  const firstReceipt=await first.createWorkspace({
    workspace_id:I.workspace,profile:"generic",
  });
  check(firstReceipt?.workspace_id===I.workspace&&kernelCreateCalls===1,
    "D2_ORIGINAL_FIRST_SIGNED_CREATE_NOT_DISPATCHED");
  const replay=async binding=>{
    try{await binding.createWorkspace({
      workspace_id:I.workspace,profile:"generic",
    });}catch(error){
      check(code(error)==="T3_D1_WORKSPACE_CREATE_REPLAY_BLOCKED",
        "D2_ORIGINAL_CREATE_REPLAY_WRONG_REFUSAL");
      return;
    }
    check(false,"D2_ORIGINAL_CREATE_REPLAY_ADMITTED");
  };
  await replay(first);
  check(kernelCreateCalls===1,"D2_ORIGINAL_CREATE_REPLAY_T2_CALLED");
  console.log("D2_ORIGINAL_SIGNED_CREATE_SAME_SESSION_FENCE_PASS");
  // Cold-open the ORIGINAL private T3 Owner from the SAME original profile,
  // including its already existing workspace.json. No new identity or grant.
  nativeHost.close();nativeHost=null;
  owner.close();owner=null;
  owner=openInterop({root:join(root,"admin"),product:"admin",
    passphrase,clock:()=>NOW});
  owner.selectOperator("reviewer");
  nativeHost=createOriginalAdminD3HostPort({
    runtime:owner,isHostActive:()=>true,currentHostEpoch:async()=>1,
    confirmHumanReview:async()=>false,
  });
  const coldCreate=await nativeHost.controlKernelOwnerFor(
    {scope:"kernel",operation:"createWorkspace"},createSignedAccessHostPort);
  await replay(createSubjectKernelBinding({
    kernel:createKernel,access:coldCreate,clock:()=>NOW,
  }));
  check(kernelCreateCalls===1,"D2_ORIGINAL_COLD_CREATE_REPLAY_T2_CALLED");
  const coldRead=await nativeHost.controlKernelOwnerFor(
    {scope:"kernel",operation:"getWorkspace"},createSignedAccessHostPort);
  check((await createSubjectKernelBinding({
    kernel:createKernel,access:coldRead,clock:()=>NOW,
  }).getWorkspace(I.workspace))?.workspace_id===I.workspace,
    "D2_ORIGINAL_COLD_READ_ONLY_RECOVERY_DENIED");
  console.log("D2_ORIGINAL_SIGNED_CREATE_COLD_REPLAY_FENCE_PASS");
  console.log("D2_ORIGINAL_COLD_READ_ONLY_RECOVERY_JIT_PASS");
}catch(error){
  console.error("D2_ORIGINAL_PRIVATE_WORKSPACE_JIT_MACHINE_CODE "+code(error));
  process.exitCode=1;
}finally{
  try{nativeHost?.close()}catch{}
  try{owner?.close()}catch{}
  if(root)try{rmSync(root,{recursive:true,force:true})}catch{}
}
