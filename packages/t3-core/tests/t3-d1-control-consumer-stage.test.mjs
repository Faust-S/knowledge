import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,
  rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {stageOriginalControlConsumer} from "../scripts/stage-original-control-consumer.mjs";

const hash=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"t3-control-consumer-"));
  const original=join(root,"source");
  const stage=join(root,"staged");
  const put=(path,text)=>{
    const p=join(original,path);
    mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text);
    return p;
  };
  const server=put("interop/server.mjs",
    "import {createT3IsolatedUiServer} from './t3-isolated-ui-server.mjs';\n"+
    "const t3SignedPortFactory=undefined, t3OneDistRoot=undefined;\n"+
    "function bindOriginalControlToT3App() {}\n"+
    "export const originalControl=true;\n");
  const ui=put("interop/t3-isolated-ui-server.mjs",
    "export function createT3IsolatedUiServer() { return 'legacy'; }\n");
  put("interop/t3-control-workspace-entry.mjs","export const signed=true;\n");
  put("access-control/core.mjs","export const originalSigner=true;\n");
  put("reconciliation/contracts.mjs","export const originalResult=true;\n");
  put("qualification/d1.test.mjs","export const publicReference=false;\n");
  put("interop/.env","PRIVATE_SECRET_NOT_FOR_STAGE");
  put("interop/notes.log","PRIVATE_LOG_NOT_FOR_STAGE");
  put(".git/config","REMOTE_PRIVATE_CONFIG_NOT_FOR_STAGE");
  return {root,original,stage,server,ui,put};
}
const cleanup=f=>rmSync(f.root,{recursive:true,force:true});
test("staged installed original Control consumes exact public knowledge static UI server",async()=>{
  const f=fixture();
  try{
    const oldServer=hash(f.server),oldUi=hash(f.ui);
    const receipt=stageOriginalControlConsumer({
      originalControlRoot:f.original,outputRoot:f.stage,includeQualifications:true,
    });
    assert.equal(receipt.schema,"iwxa.t3.original-control-consumer-stage/1");
    assert.equal(receipt.originalSignedOwnerUnmodified,true);
    assert.equal(receipt.qualificationStaged,true);
    assert.equal(hash(f.server),oldServer);
    assert.equal(hash(f.ui),oldUi);
    assert.equal(readFileSync(join(f.stage,"interop/server.mjs"),"utf8"),
      readFileSync(f.server,"utf8"));
    assert.equal(readFileSync(join(f.stage,"access-control/core.mjs"),"utf8"),
      "export const originalSigner=true;\n");
    assert.equal(existsSync(join(f.stage,"qualification/d1.test.mjs")),true);
    for(const file of [".git/config","interop/.env","interop/notes.log"])
      assert.equal(existsSync(join(f.stage,file)),false);
    const moved=await import(pathToFileURL(
      join(f.stage,"interop/t3-isolated-ui-server.mjs")).href);
    assert.equal(typeof moved.createT3IsolatedUiServer,"function");
    assert.notEqual(hash(join(f.stage,"interop/t3-isolated-ui-server.mjs")),oldUi);
    assert.equal(hash(join(f.stage,"interop/t3-isolated-ui-server.mjs")),
      receipt.installedUiSha256);
    assert.throws(()=>stageOriginalControlConsumer({
      originalControlRoot:f.original,outputRoot:f.stage,
    }),/OUTPUT_ALREADY_EXISTS/);
  }finally{cleanup(f);}
});
test("production stage omits tests and leaves original issuer code byte-for-byte",()=>{
  const f=fixture();
  try{
    const before=hash(join(f.original,"access-control/core.mjs"));
    const result=stageOriginalControlConsumer({
      originalControlRoot:f.original,outputRoot:f.stage,
    });
    assert.equal(result.qualificationStaged,false);
    assert.equal(existsSync(join(f.stage,"qualification")),false);
    assert.equal(hash(join(f.stage,"access-control/core.mjs")),before);
    assert.equal(hash(join(f.original,"access-control/core.mjs")),before);
  }finally{cleanup(f);}
});
test("reject mismatched Control importer, overlaps and symlinked code",()=>{
  const f=fixture();
  try{
    const serverText=readFileSync(f.server,"utf8");
    writeFileSync(f.server,"export const unauthorized=true;\n");
    assert.throws(()=>stageOriginalControlConsumer({
      originalControlRoot:f.original,outputRoot:f.stage,
    }),/ORIGINAL_SIGNED_CONTROL_CONTRACT_REQUIRED/);
    assert.equal(existsSync(f.stage),false);
    writeFileSync(f.server,serverText);
    assert.throws(()=>stageOriginalControlConsumer({
      originalControlRoot:f.original,
      outputRoot:join(f.original,"test-output"),
    }),/SOURCE_OUTPUT_OVERLAP/);
    symlinkSync(f.server,join(f.original,"interop","other.mjs"));
    assert.throws(()=>stageOriginalControlConsumer({
      originalControlRoot:f.original,outputRoot:f.stage,
    }),/SYMLINK_FORBIDDEN/);
    assert.equal(existsSync(f.stage),false);
  }finally{cleanup(f);}
});
