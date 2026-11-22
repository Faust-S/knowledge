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
let root=null,owner=null;
try{
  check(process.argv.length===3,"D2_ORIGINAL_PRIVATE_ROOT_REQUIRED");
  const native=resolve(process.argv[2]);
  const [{provision,I},{openInterop}]=await Promise.all([
    import(pathToFileURL(join(native,"interop/provision.mjs")).href),
    import(pathToFileURL(join(native,"interop/runtime.mjs")).href),
  ]);
  root=mkdtempSync(join(tmpdir(),"iwxa-d2-original-jit-"));
  const NOW=Date.parse("2026-11-22T08:00:00.000Z");
  const passphrase="ephemeral-isolated-original-jit";
  const identity={...I,person:I.reviewer};
  provision({adminRoot:join(root,"admin"),controlRoot:join(root,"control"),
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
}catch(error){
  console.error("D2_ORIGINAL_PRIVATE_WORKSPACE_JIT_MACHINE_CODE "+code(error));
  process.exitCode=1;
}finally{
  try{owner?.close()}catch{}
  if(root)try{rmSync(root,{recursive:true,force:true})}catch{}
}
