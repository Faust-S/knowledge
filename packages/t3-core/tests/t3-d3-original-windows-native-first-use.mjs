// Verify ORIGINAL installed-owner Windows DPAPI / signed first-use without
// duplicating its issuer, registry or Kernel. Public CI stages the exact
// private owner in an isolated checkout. Only bounded codes leave the runner.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";

const deny=code=>{throw Object.assign(new Error(code),{code});};
let base=null;
try {
  if(process.platform!=="win32"||process.argv.length!==3)
    deny("ADMIN03_NATIVE_WINDOWS_ARGUMENTS_REQUIRED");
  const ownerModule=resolve(process.argv[2],"interop/native-admin-d3.mjs");
  const {runNativeAdminD3}=await import(pathToFileURL(ownerModule).href);
  if(typeof runNativeAdminD3!=="function")
    deny("ADMIN03_NATIVE_ORIGINAL_OWNER_REQUIRED");
  base=mkdtempSync(join(tmpdir(),"admin03-original-first-use-"));
  const organizationId=randomUUID(),workspaceId=randomUUID();
  const root=join(base,"t3-admin","organizations",organizationId);
  mkdirSync(root,{recursive:true});
  const request=join(base,"request.json");
  writeFileSync(request,JSON.stringify({
    organizationId,workspaceId,organizationName:"Admin Center Original Native",
  }),{flag:"wx",mode:0o600});
  // Same original native CLI implementation, not a substitute signer.
  const enrolled=runNativeAdminD3(["d3-enroll",root,organizationId,request]);
  if(enrolled?.operation!=="D3_ENROLLED"||
     enrolled?.view?.status!=="D3_OWNER_READY"||
     enrolled?.view?.snapshot?.organizationId!==organizationId)
    deny("ADMIN03_NATIVE_ORIGINAL_ENROLL_READBACK_INVALID");
  // A real independent cold owner open must re-read DPAPI+original ledger
  // without issuing a second invitation or regenerating identity keys.
  const cold=runNativeAdminD3(["d3-state",root,organizationId]);
  if(cold?.operation!=="D3_STATE"||
     cold?.view?.status!=="D3_OWNER_READY"||
     cold?.view?.snapshot?.organizationId!==organizationId||
     cold?.view?.snapshot?.workspaceId!==workspaceId)
    deny("ADMIN03_NATIVE_ORIGINAL_COLD_READBACK_INVALID");
  process.stdout.write("ADMIN03_ORIGINAL_NATIVE_WINDOWS_DPAPI_COLD_FIRST_USE_PASS\\n");
}catch(error){
  const source=error&&typeof error==="object"?
    (typeof error.code==="string"?error.code:
      typeof error.message==="string"?error.message:""):"";
  const code=/^[A-Z][A-Z0-9_]{4,99}$/.test(source)?
    source:"ADMIN03_NATIVE_FIRST_USE_UNCLASSIFIED";
  process.stdout.write("ADMIN03_ORIGINAL_NATIVE_WINDOWS_FIRST_USE_HOLD "+code+"\\n");
  process.exitCode=1;
}finally{
  if(base)rmSync(base,{recursive:true,force:true});
}
