#!/usr/bin/env node
// Qualification only: exercise the EXACT released K036 bundle via its public API.
// Synthetic schemas/passports and a fresh fake-indexeddb factory are fixtures,
// not a new production Store, D1 grant, owner adoption, physical browser or D4.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const archive = join(root, "qualified-runtime/iwxa-kernel-k036-same-store-history-20261019-qualified.1.zip");
const archiveSha256 = "7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68";
const runtimeSha256 = "e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78";
const hash = b => createHash("sha256").update(b).digest("hex");
const report = { status: "RUNNING", archiveSha256, runtimeSha256, substrate: "EXACT_RUNTIME_NODE_FAKE_INDEXEDDB",
  approval: false, physicalBrowser: false, checks: [], observations: {} };
const check = (name, condition) => { assert.ok(condition, name); report.checks.push(name); console.log("PASS", name); };
const same = (name, actual, expected) => { assert.deepEqual(actual, expected, name); check(name, true); };
const expectReject = async (name, fn, codes) => {
  let error;
  try { await fn(); } catch (e) { error = e; }
  assert.ok(error, name + ": unexpectedly succeeded");
  assert.ok(codes.includes(error.code), name + ": " + String(error.code) + " " + error.message);
  check(name, true);
};
const writerId = "qualification.c3.writer", readerId = "qualification.c3.reader";
const anchorSchema = "qualification.c3.anchor", revisionSchema = "qualification.c3.revision";
const workspace = "qualification-c3-ws", importedWorkspace = "qualification-c3-import";
const anchor = "method-anchor";
const origin = "https://qualification.iwxa.test";
const version = "1.0.0";
const declaration = { schema_version: version, preserve_unknown: true, json_schema: {type:"object"}, embedded:{} };
const passport = (id, path, isWriter) => ({
  service_id:id, service_version:version, base_path:path, supported_levels:["T0","T1","T2"],
  input_object_types:isWriter?[anchorSchema,revisionSchema]:[anchorSchema],
  output_object_types:isWriter?[anchorSchema,revisionSchema]:[],
  schemas:isWriter?{[anchorSchema]:declaration,[revisionSchema]:declaration}:{},
  permissions:{
    ...(isWriter?{operations:["t1.commitObjectGraph"]}:{}),
    workspace:{list:true,read:true,create:isWriter,soft_delete:false,restore:false,purge:false},
    objects:{read:isWriter?[anchorSchema,revisionSchema]:[anchorSchema],
      write:isWriter?[anchorSchema,revisionSchema]:[],delete:[]},
    events:{read_scope:"workspace"},
    packages:{export:isWriter,import:isWriter,export_scope:"readable_objects",import_scope:"writable_objects"}
  }
});
const passports = [passport(writerId,"/writer/",true),passport(readerId,"/reader/",false)];
const domain = {
  config_schema_version:"1.0.0",config_version:"1.1.0",status:"active",domain_id:"qualification.iwxa.test",
  origin,local_store_name:"iwxa-local",workspace_profile:"personal",brand:{name:"Qualification"},
  runtime:{engine:"iwxa-kernel"},modules:passports.map(p=>({service_id:p.service_id,base_path:p.base_path})),
  enabled_profiles:["production"],enabled_capabilities:["T0","T1","T2"],
  handoff:{enabled:false,receive_path:"/iwxa/handoff/receive",allowed_origins:[],require_preview:true,default_expiry_seconds:3600},
  service_worker:{mode:"disabled",future_path:"/iwxa-sw.js",future_scope:"/"},
  diagnostics:{enabled:true},security:{},release:{}
};
const plane = {schema_version:"0.3.1",snapshot_id:"qualification-c3-mapping",resolver_id:"iwxa.test.control-plane",
  trusted_issuers:[],issuance_policies:[],services:passports.map(p=>({schema_version:"0.3.1",
    service_id:p.service_id,capability_control:"NONE",capability_ceiling:[],activation_any_of:[],operation_guards:[]}))};
const relation = (relation_id,from_object_id,to_object_id,kind) => ({relation_id,from_object_id,to_object_id,kind});
const prefix = hash(workspace).slice(0,16);
const headId = id => prefix+"-head-"+id;
const guardId = prefix+"-origin";
const anchorInput = key => ({
  workspace_id:workspace,idempotency_key:key,
  object:{object_id:anchor,schema_id:anchorSchema,schema_version:version,base_revision:0,data:{kind:"anchor"}},
  event:{event_type:"qualification.anchor.created",payload:{anchor}}
});
function revisionInput(id,n,previous=null,tombstone=false) {
  const puts=[relation(headId(id),anchor,id,"current-head")];
  // A permanent origin guard is essential. A deleted initial head ID can be
  // reused by a delayed first-create attempt and must NOT serve as the guard.
  if(previous===null) puts.push(relation(guardId,anchor,id,"first-revision"));
  else puts.push(relation(prefix+"-previous-"+id,id,previous,"previous-revision"));
  return {
    workspace_id:workspace,idempotency_key:"commit-"+id,
    object:{object_id:id,schema_id:revisionSchema,schema_version:version,base_revision:0,
      data:{recordId:id,revision:n,previousRevisionId:previous,operation:tombstone?"release":"revise",
        refs:{workspaceId:workspace,canonicalHeads:previous?[previous]:[]},
        payload:tombstone?null:{value:"fixture-private-"+id}}},
    relation_puts:puts,relation_deletes:previous?[{relation_id:headId(previous)}]:[],
    event:{event_type:"qualification.revision.committed",payload:{recordId:id,revision:n,operation:tombstone?"release":"revise"}}
  };
}
async function readChain(client, ws) {
  const a=await client.t1.getObject(ws,anchor);
  assert.ok(a);
  const origins=a.relations.outgoing.filter(r=>r.kind==="first-revision");
  const heads=a.relations.outgoing.filter(r=>r.kind==="current-head");
  assert.equal(heads.length,1,"one live head");
  assert.equal(origins.length,1,"one permanent origin");
  const data=[], seen=new Set();
  let id=heads[0].to_object_id;
  while(id) {
    assert.ok(!seen.has(id),"cycle"); seen.add(id);
    const row=await client.t1.getObject(ws,id);
    assert.ok(row); assert.equal(row.object.schema_id,revisionSchema);
    assert.equal(row.object.data.recordId,id); assert.equal(row.object.revision,1,"immutable physical revision");
    const d=row.object.data;
    data.push(d);
    const prev=row.relations.outgoing.filter(r=>r.kind==="previous-revision");
    assert.equal(prev.length,d.previousRevisionId===null?0:1);
    if(prev.length) assert.equal(prev[0].to_object_id,d.previousRevisionId);
    id=d.previousRevisionId;
  }
  assert.equal(origins[0].to_object_id,data.at(-1).recordId);
  data.forEach((d,i)=>assert.equal(d.revision,data.length-i));
  return data;
}
async function snapshot(client,ws) {
  const objects=await client.t1.listObjects({workspace_id:ws});
  const events=await client.t1.listEventsSince(ws,"");
  return { objects:objects.map(o=>o.object_id).sort(), events:events.map(e=>e.event_id).sort() };
}
let temp;
try {
  check("exact archive hash",hash(readFileSync(archive))===archiveSha256);
  const members=execFileSync("unzip",["-Z1",archive],{encoding:"utf8"}).trim().split(/\r?\n/);
  const matches=members.filter(p=>/(^|\/)_iwxa\/runtime\/0\.3\.6\/runtime\.js$/.test(p));
  assert.equal(matches.length,1,"exact runtime member");
  const currentPath=matches[0].replace(/runtime\/0\.3\.6\/runtime\.js$/,"current.json");
  const current=JSON.parse(execFileSync("unzip",["-p",archive,currentPath],{encoding:"utf8"}));
  const bytes=execFileSync("unzip",["-p",archive,matches[0]],{maxBuffer:16*1024*1024});
  check("exact active runtime hash",hash(bytes)===runtimeSha256);
  same("active pointer contract",[current.runtime_version,current.contract_version],["0.3.6","1.3.0"]);
  temp=mkdtempSync(join(tmpdir(),"iwxa-k036-probe-"));
  const runtimePath=join(temp,"runtime.mjs");writeFileSync(runtimePath,bytes);
  const require=createRequire(join(root,"qualified-runtime-source/k036-atomic-graph/package.json"));
  require("fake-indexeddb/auto");
  const {IDBFactory}=require("fake-indexeddb");
  globalThis.indexedDB=new IDBFactory();
  const held=new Set();
  Object.defineProperty(globalThis.navigator,"locks",{configurable:true,value:{
    async request(name,opts,cb) {
      if(typeof opts==="function") cb=opts;
      while(held.has(name)) await new Promise(r=>setTimeout(r,0));
      held.add(name);try{return await cb({name});}finally{held.delete(name);}
    }
  }});
  globalThis.fetch=async u=>{
    const path=String(u);
    if(path.endsWith("/_iwxa/security/capability-control-plane.json")) return Response.json(plane);
    const p=passports.find(p=>path.endsWith("/_iwxa/services/"+p.service_id+".json"));
    if(p)return Response.json(p);
    return new Response(null,{status:404});
  };
  const runtime=await import(pathToFileURL(runtimePath).href);
  check("exact bundle exports connect",typeof runtime.connect==="function");
  const connect=(id=writerId)=>runtime.connect({service_id:id,required_levels:["T1","T2"]},{domain,current,origin});
  const writer=await connect(), reader=await connect(readerId);
  same("connected actual runtime contract",[writer.runtime_version,writer.contract_version,writer.mode],["0.3.6","1.3.0","full"]);
  check("writer composite operation granted",writer.granted_operations.includes("t1.commitObjectGraph"));
  check("reader composite operation not granted",!reader.granted_operations.includes("t1.commitObjectGraph"));
  await writer.t1.createWorkspace({workspace_id:workspace,profile:"personal"});
  await writer.t1.commitObjectGraph(anchorInput("anchor-1"));
  await expectReject("second anchor cannot replace first",()=>writer.t1.commitObjectGraph(anchorInput("anchor-2")),["CONFLICT"]);
  check("interrupted bootstrap is only anchor, no current head",
    (await writer.t1.getObject(workspace,anchor)).relations.outgoing.length===0);
  const initial=revisionInput("rev-1",1);
  const firstResults=await Promise.allSettled([writer.t1.commitObjectGraph(initial),
    writer.t1.commitObjectGraph(revisionInput("rev-first-rival",1))]);
  same("concurrent first commits have exactly one winner",firstResults.filter(r=>r.status==="fulfilled").length,1);
  const win=firstResults.find(r=>r.status==="fulfilled").value;
  const first=win.object.object_id, losing=first==="rev-1"?"rev-first-rival":"rev-1";
  check("losing initial revision absent",!(await writer.t1.getObject(workspace,losing)));
  const winInput=revisionInput(first,1);
  const replay=await writer.t1.commitObjectGraph(winInput);
  same("lost response replay returns same transaction",replay.transaction_id,win.transaction_id);
  check("replay marked deduplicated",replay.deduplicated===true);
  await expectReject("same key different content rejected",()=>writer.t1.commitObjectGraph({...winInput,
    object:{...winInput.object,data:{...winInput.object.data,payload:{value:"different"}}}}),["CONFLICT"]);
  const secondA=revisionInput("rev-2-a",2,first),secondB=revisionInput("rev-2-b",2,first);
  const secondResults=await Promise.allSettled([writer.t1.commitObjectGraph(secondA),writer.t1.commitObjectGraph(secondB)]);
  same("concurrent advances have exactly one winner",secondResults.filter(r=>r.status==="fulfilled").length,1);
  const second=secondResults.find(r=>r.status==="fulfilled").value.object.object_id;
  const losingSecond=second==="rev-2-a"?"rev-2-b":"rev-2-a";
  check("losing advance absent",!(await writer.t1.getObject(workspace,losingSecond)));
  const beforeStale=await snapshot(writer,workspace);
  await expectReject("permanent origin rejects delayed first create after advance",
    ()=>writer.t1.commitObjectGraph(revisionInput("rev-delayed",1)),["CONFLICT"]);
  await expectReject("old head relation rejects stale advance",
    ()=>writer.t1.commitObjectGraph(revisionInput("rev-stale",2,first)),["RELATION_NOT_FOUND","CONFLICT"]);
  same("rejected writes create no objects/events",await snapshot(writer,workspace),beforeStale);
  await writer.t1.commitObjectGraph(revisionInput("rev-3",3,second,true));
  const chain=await readChain(writer,workspace);
  same("tombstone retains exact full predecessor chain",chain.map(r=>r.recordId),["rev-3",second,first]);
  check("tombstone has no active payload",chain[0].payload===null&&chain[1].payload.value.startsWith("fixture-private-"));
  const afterRelease=await snapshot(writer,workspace);
  same("historical replay returns original first transaction after release",
    (await writer.t1.commitObjectGraph(winInput)).transaction_id,win.transaction_id);
  same("historical replay changes nothing",await snapshot(writer,workspace),afterRelease);
  let denied=false;
  try { denied=!(await reader.t1.getObject(workspace,first)); }
  catch(e) { if(e.code!=="PERMISSION_DENIED"&&e.code!=="OBJECT_NOT_FOUND")throw e; denied=true; }
  check("schema-restricted reader cannot read revision",denied);
  check("reader catalog excludes revision objects",
    (await reader.t1.listObjects({workspace_id:workspace})).every(o=>o.schema_id!==revisionSchema));
  const readerEvents=await reader.t1.listEventsSince(workspace,"");
  check("shared audit contains no private fixture payload",!JSON.stringify(readerEvents).includes("fixture-private-"));
  report.observations.originalCatalog=afterRelease.objects;
  report.observations.auditEvents=afterRelease.events.length;
  report.observations.databaseNames=(await indexedDB.databases()).map(d=>d.name);
  check("exact runtime uses one original database",report.observations.databaseNames.length===1&&report.observations.databaseNames[0]==="iwxa-local");
  const opts={workspaces:[workspace],include_history:true,include_assets:true,include_relations:true,include_schemas:true};
  const artifact=await writer.t2.exportPackage(opts);
  check("original Exchange exports package",artifact.bytes instanceof Uint8Array&&artifact.bytes.length>0);
  report.observations.exchangeBytes=artifact.bytes.length;
  report.observations.semanticDigest=artifact.manifest.semantic_digest;
  // Original tests reset only the runtime cache; physical persistence is not
  // demonstrated because fake-indexeddb is an in-memory substrate.
  check("original test reset available",typeof runtime.__resetKernelStoreForTests==="function");
  runtime.__resetKernelStoreForTests();
  const reopened=await connect();
  same("runtime cache reset retains chain in same original DB",await readChain(reopened,workspace),chain);
  // Original same-ID roundtrip into an empty factory.
  runtime.__resetKernelStoreForTests();globalThis.indexedDB=new IDBFactory();
  const fresh=await connect();
  same("fresh test database has no workspaces",await fresh.t1.listWorkspaces(),[]);
  const importPackage=async plan=>{
    const p=await fresh.t2.importPreview(artifact.bytes);
    return fresh.t2.importCommit({preview_token:p.preview_token,package_digest:p.package_digest,plan});
  };
  await importPackage({mode:"full"});
  same("same-ID import restores exact chain",await readChain(fresh,workspace),chain);
  const restored=await snapshot(fresh,workspace);
  check("same-ID import preserves audit identities",afterRelease.events.every(id=>restored.events.includes(id)));
  report.observations.semanticDigestEqual=(await fresh.t2.exportPackage(opts)).manifest.semantic_digest===artifact.manifest.semantic_digest;
  // New-workspace import is an investigation, not a pre-approved mapping.
  // Capture the actual result, including nested reference remap behavior.
  try {
    await importPackage({mode:"new-workspace",target_workspace:importedWorkspace,workspace_id_map:{[workspace]:importedWorkspace}});
    const copy=await readChain(fresh,importedWorkspace);
    report.observations.newWorkspace={chain:copy.map(r=>r.recordId),nestedWorkspaceIds:copy.map(r=>r.refs.workspaceId),
      nestedRefsRemapped:copy.every(r=>r.refs.workspaceId===importedWorkspace)};
    check("original workspace chain unchanged after copy",JSON.stringify(await readChain(fresh,workspace))===JSON.stringify(chain));
  } catch(e) {
    report.observations.newWorkspace={error:e.code??"ERROR",message:String(e.message)};
  }
  report.status="PASS_PRIMITIVES_ONLY";
} catch (e) {
  report.status="FAIL";report.error={code:e.code??null,message:e.message,stack:e.stack};console.error(e);
} finally {
  if(temp)rmSync(temp,{recursive:true,force:true});
  const output=process.argv[2];
  if(output)writeFileSync(output,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  process.exit(report.status==="PASS_PRIMITIVES_ONLY"?0:1);
}
