// T3 D1 public browser qualification: actual inherited T2 Kernel / Store,
// TEST-ONLY authority contract. NO real signed Access owner is instantiated.
// Browser/Host process restarts are not issuer or custody restarts.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {createSubjectKernelBinding} from "../subject-access-binding.mjs";
import {createSignedAccessHostPort} from "../signed-access-host-port.mjs";

const W="iwxa.workspace.integration";
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validTo=()=>new Date(Date.now()+60000).toISOString();
const nowIso=()=>new Date().toISOString();
const methods=new Set(["t1.createWorkspace","t1.getWorkspace","t1.putObject","t1.getObject",
  "t1.listObjects","t1.putRelation","t1.listEventsSince",
  "t1.softDeleteWorkspace","t1.restoreWorkspace",
  "t2.exportPreview","t2.exportPackage","t2.confirmExport"]);

export async function liveT2Facade(page, service_id=W) {
  assert.equal(typeof page?.evaluate,"function");
  const contract=await page.evaluate(async service_id=>{
    const session=await globalThis.IWXA.connect({service_id});
    return {contract_version:session.contract_version,runtime_version:session.runtime_version,
      service_id:session.service?.service_id,granted_operations:session.granted_operations};
  },service_id);
  assert.equal(contract.contract_version,"1.3.0");
  assert.equal(contract.runtime_version,"0.3.6");
  assert.equal(contract.service_id,service_id);
  assert.ok(methods.size>0&&[...methods].every(op=>contract.granted_operations.includes(op)),
    "T3_D1_T2_WRITER_CAPABILITIES_REQUIRED");
  async function invoke(method,args) {
    return page.evaluate(async ({service_id,method,args})=>{
      const session=await globalThis.IWXA.connect({service_id});
      const tier=["exportPreview","exportPackage","confirmExport"].includes(method)?"t2":"t1";
      if(!session.granted_operations.includes(tier+"."+method)){
        throw new Error("T3_D1_LIVE_KERNEL_GRANT_MISSING");
      }
      return session[tier][method](...args);
    },{service_id,method,args});
  }
  return Object.freeze({
    sessionInfo:Object.freeze({contract_version:contract.contract_version,
      runtime_version:contract.runtime_version,service_id}),
    hasOperation:op=>contract.granted_operations.includes(op),
    createWorkspace:input=>invoke("createWorkspace",[input]),
    getWorkspace:id=>invoke("getWorkspace",[id]),
    getObject:(id,objectId)=>invoke("getObject",[id,objectId]),
    listObjects:query=>invoke("listObjects",[query]),
    putObject:input=>invoke("putObject",[input]),
    putRelation:input=>invoke("putRelation",[input]),
    softDeleteWorkspace:id=>invoke("softDeleteWorkspace",[id]),
    restoreWorkspace:id=>invoke("restoreWorkspace",[id]),
    exportPreview:options=>invoke("exportPreview",[options]),
    exportPackage:options=>invoke("exportPackage",[options]),
    confirmExport:input=>invoke("confirmExport",[input]),
    listEventsSince:(id,since)=>invoke("listEventsSince",[id,since]),
  });
}
function hostState(file){
  const state=JSON.parse(readFileSync(file,"utf8"));
  assert.equal(state.schema,"IWXA_T3_D1_TEST_HOST_STATE/1");
  assert.equal(state.contexts.length,3);
  return state;
}
function persist(file,state){
  writeFileSync(file,JSON.stringify(state)+"\n");
}
export function initD1TestHostState(file,root) {
  const contexts=[
    {kind:"PERSONAL",context_id:"personal",actor_id:"person:1",
      principal_id:"person:1",organization_id:null,realm_id:"realm:personal",
      grant_id:"grant:personal",workspace_id:root+"-personal"},
    ...[1,2].map(i=>({kind:"CORP",context_id:"corp:"+i,actor_id:"person:1",
      principal_id:"org:"+i,organization_id:"org:"+i,realm_id:"realm:org:"+i,
      grant_id:"grant:corp:"+i,workspace_id:root+"-corp-"+i})),
  ].map(x=>({...x,scope_revision:1,audience:"host:t3",
    resource:x.workspace_id,role_id:"role:member",purpose:"work"}));
  persist(file,{schema:"IWXA_T3_D1_TEST_HOST_STATE/1",
    contexts,status:Object.fromEntries(contexts.map(c=>[c.grant_id,"ACTIVE"]))});
  return contexts;
}
export async function createD1TestHost(page,file) {
  const state=hostState(file), kernel=await liveT2Facade(page);
  let selected=0;
  const currentContext=()=>state.contexts[selected];
  const status=request=>state.status[request.grantId]??"UNKNOWN";
  const actionFor=op=>({"t1.createWorkspace":"workspace.create",
    "t1.getWorkspace":"workspace.read","t1.putObject":"object.write",
    "t1.getObject":"object.read","t1.listObjects":"object.list",
    "t1.putRelation":"relation.write","t1.listEventsSince":"history.read",
    "t1.softDeleteWorkspace":"workspace.softDelete",
    "t1.restoreWorkspace":"workspace.restore",
    "t2.exportPreview":"exchange.preview",
    "t2.exportPackage":"exchange.export",
    "t2.confirmExport":"exchange.confirm"})[op];
  const access=createSignedAccessHostPort({
    currentContext,actionFor,
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,
    clock:Date.now,
    personal:{check:request=>({
      schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
      allowed:status(request)==="ACTIVE",outcome:status(request)==="ACTIVE"?"PERMITTED":"DENIED",
      requestDigest:digest(request),policyDigest:digest("TEST-POLICY"),
      evaluatedAt:nowIso(),statusObservedAt:nowIso(),statusSequence:1,
      validUntil:validTo(),authorityPath:[{grantId:request.grantId}],
      evidenceOnly:true,
    })},
    corporate:{
      productId:"IWXA_ADMIN_CENTER", // fixture only; never infer this in the production Host
      // The real signed owner is deliberately NOT imported into public Actions.
      // These callbacks model its documented request/response contract only.
      inputFor:context=>({context_id:context.context_id}),
      prove:async({credentialKeyId})=>({keyId:credentialKeyId,
        testOnly:true}),
      gate:{
        preview:input=>{
          const c=currentContext(),operation=input.operation;
          const operationDigest=digest({context_id:c.context_id,operation});
          return {schema:"IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1",
            authorized:false,subjectType:"ORGANIZATION",
            organizationId:c.organization_id,workspaceId:c.workspace_id,
            credentialKeyId:"test:credential",
            scopeDigest:operationDigest,request:{
              id:"org:"+operationDigest,actorId:c.actor_id,principalId:c.principal_id,
              roleId:c.role_id,grantId:c.grant_id,audience:operation.audience,
              resource:operation.resource,action:operation.action,
              purpose:operation.purpose,realmId:c.realm_id,operationDigest,
            }};
        },
        authorize:(input,challenge)=>{
          const p=accessOwnerGatePreview(input);
          const allowed=state.status[p.request.grantId]==="ACTIVE";
          return {schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
            allowed,outcome:allowed?"PERMITTED":"DENIED",
            evidenceOnly:true,productionActivation:false,
            organizationId:p.organizationId,workspaceId:p.workspaceId,
            grantId:p.request.grantId,operationDigest:p.request.operationDigest,
            requestDigest:digest(p.request),policyDigest:digest("TEST-POLICY"),
            evidenceDigest:digest(challenge),statusSequence:1,validUntil:validTo(),
            doesNotTransferData:true,doesNotAcceptCorporateCopy:true};
        },
      },
    },
  });
  function accessOwnerGatePreview(input){
    const c=currentContext(),operation=input.operation;
    const operationDigest=digest({context_id:c.context_id,operation});
    return {organizationId:c.organization_id,workspaceId:c.workspace_id,
      request:{id:"org:"+operationDigest,actorId:c.actor_id,principalId:c.principal_id,
        roleId:c.role_id,grantId:c.grant_id,audience:operation.audience,
        resource:operation.resource,action:operation.action,purpose:operation.purpose,
        realmId:c.realm_id,operationDigest}};
  }
  const binding=createSubjectKernelBinding({kernel,access,clock:Date.now});
  return Object.freeze({
    contexts:state.contexts,
    select:i=>{assert.ok(i>=0&&i<3);selected=i;},
    binding,
    setStatus:(i,value)=>{
      assert.ok(["REVOKED","UNKNOWN","EXPIRED"].includes(value));
      state.status[state.contexts[i].grant_id]=value;
      persist(file,state);
    },
  });
}
export async function seedD1OnRealKernel(page,file){
  const host=await createD1TestHost(page,file),receipts=[];
  for(let i=0;i<3;i++){
    host.select(i);
    const c=host.contexts[i];
    const w=await host.binding.createWorkspace({workspace_id:c.workspace_id,profile:"generic"});
    assert.equal(w.workspace_id,c.workspace_id);
    const object_id="d1:record:"+i;
    const r=await host.binding.putObject({
      workspace_id:c.workspace_id,object_id,base_revision:0,
      schema_id:"iwxa.demo.note",schema_version:"1.0.0",
      data:{kind:c.kind,subject:c.context_id},extensions:{},
      event:{event_type:"t3.d1.subject.created",payload:{}},
    });
    assert.equal(r.object.workspace_id,c.workspace_id);
    assert.equal(r.object.revision,1);
    assert.ok(r.event?.event_id,"T3_D1_ORIGINAL_KERNEL_EVENT_RECEIPT_MISSING");
    const linked_id="d1:linked:"+i;
    const linked=await host.binding.putObject({
      workspace_id:c.workspace_id,object_id:linked_id,base_revision:0,
      schema_id:"iwxa.demo.note",schema_version:"1.0.0",
      data:{linkedTo:object_id},extensions:{},
      event:{event_type:"t3.d1.subject.linked-object",payload:{}},
    });
    assert.equal(linked.object.workspace_id,c.workspace_id);
    const relation_id="d1:relation:"+i;
    const relation=await host.binding.putRelation({
      workspace_id:c.workspace_id,relation_id,from_object_id:object_id,
      to_object_id:linked_id,kind:"depends_on",
      event:{event_type:"t3.d1.subject.relation",payload:{}},
    });
    assert.equal(relation.relation.relation_id,relation_id);
    const all=await host.binding.listObjects({workspace_id:c.workspace_id});
    assert.ok(all.some(item=>item.object_id===object_id));
    assert.ok(all.some(item=>item.object_id===linked_id));
    receipts.push({workspace_id:c.workspace_id,object_id,linked_id,relation_id,
      revision:r.object.revision,event_id:r.event.event_id,
      linked_event_id:linked.event.event_id,relation_event_id:relation.event.event_id,
      kind:c.kind});
  }
  host.select(0);
  const subjectWorkspace=host.contexts[0].workspace_id;
  const deleted=await host.binding.softDeleteWorkspace(subjectWorkspace);
  assert.equal(deleted.workspace_id,subjectWorkspace);
  const restored=await host.binding.restoreWorkspace(subjectWorkspace);
  assert.equal(restored.workspace_id,subjectWorkspace);
  const afterRestore=await host.binding.getObject(subjectWorkspace,"d1:record:0");
  assert.equal(afterRestore.object.revision,1);
  const exportOptions={workspaces:[subjectWorkspace],include_history:true,
    include_relations:true,include_schemas:true};
  const exportPreview=await host.binding.exportPreview(exportOptions);
  assert.deepEqual(exportPreview.workspaces,[subjectWorkspace]);
  const exported=await host.binding.exportPackage(exportOptions);
  assert.deepEqual(exported.manifest.workspaces,[subjectWorkspace]);
  const confirmed=await host.binding.confirmExport({
    package_digest:exported.package_digest,workspace_ids:[subjectWorkspace]});
  assert.deepEqual(confirmed.workspace_ids,[subjectWorkspace]);
  assert.equal(confirmed.package_digest,exported.package_digest);
  host.select(1);
  await assert.rejects(host.binding.getObject(host.contexts[2].workspace_id,"d1:record:2"),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  await assert.rejects(host.binding.listObjects({
    workspace_id:host.contexts[2].workspace_id}),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  await assert.rejects(host.binding.putRelation({
    workspace_id:host.contexts[2].workspace_id,relation_id:"forbidden:1",
    from_object_id:"d1:record:1",to_object_id:"d1:record:2",kind:"depends_on"}),
    {code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  return receipts;
}
export async function verifyD1AfterBrowserRestart(page,file,receipts,{revoke=false}={}){
  const host=await createD1TestHost(page,file),summary=[];
  for(let i=0;i<3;i++){
    host.select(i);
    const r=receipts[i],got=await host.binding.getObject(r.workspace_id,r.object_id);
    assert.equal(got.object.workspace_id,r.workspace_id);
    assert.equal(got.object.revision,r.revision);
    assert.deepEqual(got.object.data,{kind:r.kind,subject:host.contexts[i].context_id});
    assert.ok(got.relations.outgoing.some(x=>x.relation_id===r.relation_id),
      "T3_D1_ORIGINAL_KERNEL_RELATION_LOST");
    const objects=await host.binding.listObjects({workspace_id:r.workspace_id});
    assert.ok(objects.some(x=>x.object_id===r.linked_id),
      "T3_D1_ORIGINAL_KERNEL_LINKED_OBJECT_LOST");
    const events=await host.binding.listEventsSince(r.workspace_id);
    for(const eid of [r.event_id,r.linked_event_id,r.relation_event_id])
      assert.ok(events.some(e=>e.event_id===eid),"T3_D1_ORIGINAL_KERNEL_HISTORY_LOST");
    summary.push({context:host.contexts[i].context_id,revision:got.object.revision,
      event_id:r.event_id,relation_id:r.relation_id,object_count:objects.length});
  }
  if(revoke){
    for(let i=0;i<3;i++) host.setStatus(i,["REVOKED","UNKNOWN","EXPIRED"][i]);
    // Reconstruct the Host from persisted status after closing the previous
    // test-only owner. A cached PERMITTED response must not carry over.
    const fresh=await createD1TestHost(page,file);
    for(let i=0;i<3;i++){
      fresh.select(i);
      await assert.rejects(fresh.binding.getObject(receipts[i].workspace_id,receipts[i].object_id),
        {code:"T3_ACCESS_NOT_PERMITTED"});
    }
  }
  return {contexts:summary,revoked_after_second_restart:revoke,
    authority_kind:"SYNTHETIC_CONTRACT_ONLY",real_access_owner:false};
}
