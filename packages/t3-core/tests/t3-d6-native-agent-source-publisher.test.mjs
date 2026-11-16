import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createTrustedAgentAtlasSourcePublisher}
  from "../src/t3/native-agent-atlas-source-publisher.mjs";

// Host ports in this test stand in for the ORIGINAL installed owners.
// They test the boundary and failure semantics, NOT an installed signer,
// signed .iwxa, native Atlas, or a product-level D6 acceptance.
const hex="a".repeat(64);
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const binding={
  schema:"IWXA_AGENT_T3_ORIGINAL_ATLAS_PUBLICATION/1",
  recipientId:"iwxa.atlas",signedTaskId:"signed:123",
  signedTaskRevisionId:"rev:1",signedTaskPackageSha256:hex,
  taskId:"TASK-CHAT-123",resultId:"RES-1",
  acceptedDigest:"b".repeat(64),
  workRef:{projectId:"project:1",workId:"work:1",revision:"2"},
  contextDigest:"c".repeat(64),
};
const operationId="agent:t3:atlas:"+createHash("sha256").update(
 JSON.stringify(Object.fromEntries(Object.keys(binding).sort().map(
  key=>[key,key==="workRef"?
    Object.fromEntries(Object.keys(binding.workRef).sort().map(
      k=>[k,binding.workRef[k]])):binding[key]])))).digest("hex");
function fixture({lostReserve=false,lostKernel=false,lostExchange=false,
  lostFinalize=false,consent=true,permitted=true,
  unverifiedExchange=false,corruptKernelRead=false}={}){
 const rows=new Map(),objects=new Map(),events=[];
 let commits=0,exports=0,reserves=0,finalizations=0,consents=0;
 let grant=permitted;
 const context={kind:"CORP",context_id:"context:1",actor_id:"employee:1",
   principal_id:"org:1",organization_id:"org:1",role_id:"role:1",
   grant_id:"grant:1",realm_id:"realm:1",audience:"iwxa.atlas",
   resource:"ws:org",workspace_id:"ws:org",purpose:"atlas.publish",
   scope_revision:1};
 const now=()=>new Date().toISOString();
 const access={
   currentContext:()=>({...context}),
   actionFor:()=> "atlas.result.publish",
   operationDigest:()=>hex,
   authorize:()=>({schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
     allowed:grant,outcome:grant?"PERMITTED":"DENIED",evidenceOnly:true,
     requestDigest:hex,policyDigest:hex,operationDigest:hex,
     evidenceDigest:hex,statusSequence:0,
     validUntil:new Date(Date.now()+60000).toISOString(),
     organizationId:context.organization_id,workspaceId:context.workspace_id,
     grantId:context.grant_id,productionActivation:false,
     doesNotTransferData:true,doesNotAcceptCorporateCopy:true}),
   verifyDecisionBinding:()=>true,
 };
 const kernel={
   sessionInfo:{contract_version:"1.3.0"},
   hasOperation:op=>["t1.getObject","t1.listEventsSince","t1.commitObjectGraph"].includes(op),
   getObject:async(_ws,id)=>({object:corruptKernelRead&&objects.has(id)
     ?{...objects.get(id),data:{...objects.get(id).data,
       acceptedDigest:"0".repeat(64)}}:objects.get(id)??null,
     relations:{incoming:[],outgoing:[]}}),
   listEventsSince:async()=>[...events],
   commitObjectGraph:async command=>{
     commits++;
     const ref={workspace_id:"ws:org",object_id:command.object.object_id,
       schema_id:command.object.schema_id,revision:1,
       schema_version:command.object.schema_version,data:command.object.data,
       deleted:false,deleted_at:null};
     const event={workspace_id:"ws:org",event_id:"evt:1",
       object_id:ref.object_id,revision:1,
       event_type:command.event.event_type,
       idempotency_key:command.idempotency_key};
     objects.set(ref.object_id,ref);events.push(event);
     if(lostKernel)throw Error("kernel ACK lost");
     return {workspace_id:"ws:org",object:ref,event,relations_put:[]};
   }
 };
 const originalLedger={
   read:async(op,body)=>{
     const row=rows.get(op);
     if(row)return {...row};
     return {operationId:op,...body,status:"UNISSUED",retrySafe:false,
       originalLedgerVerified:true,noPriorDispatchVerified:true,
       originalReceiptVerified:false};
   },
   reserve:async(op,body)=>{
     reserves++;
     const row={operationId:op,...body,status:"PREPARED",retrySafe:false,
       originalReceiptVerified:false};
     rows.set(op,row);
     if(lostReserve)throw Error("reserve ACK lost");
     return {...row};
   },
   finalize:async input=>{
     finalizations++;
     const row={...rows.get(input.operationId),
       status:"COMMITTED",retrySafe:false,originalReceiptVerified:true,
       sourceObjectRef:input.sourceObjectRef,
       archiveSha256:input.archiveSha256,
       originalEventId:input.originalEventId};
     rows.set(input.operationId,row);
     if(lostFinalize)throw Error("finalize ACK lost");
   },
   findByObject:async ref=>{
     const row=[...rows.values()].find(r=>r.sourceObjectRef?.object_id===ref.object_id);
     return row?{operationId:row.operationId,binding,
       ...row}:null;
   },
   findByWork:async()=>{const row=rows.get(operationId);
     return row?{operationId,binding,...row}:null;},
   findLatestWork:async()=>{const row=rows.get(operationId);
     return row?{operationId,binding,...row}:null;},
 };
 const originalExchange={
   publishSelectedResult:async({sourceObjectRef})=>{
     exports++;
     if(lostExchange)throw Error("exchange ACK lost");
     return {recipientId:"iwxa.atlas",archiveSha256:sha(sourceObjectRef)};
   },
   verifySelectedResult:async({sourceObjectRef,archiveSha256})=>({
     status:unverifiedExchange?"UNVERIFIED":"VERIFIED",recipientId:"iwxa.atlas",
     archiveSha256,taskId:binding.taskId,resultId:binding.resultId,
     sourceObjectRef,selectedSourceObjectRef:sourceObjectRef,
     originalSignatureVerified:true,archiveBytesVerified:true,
     originalManifestVerified:true,disclosureScope:"ORIGINAL_RESULT_ONLY",
   }),
 };
 const acceptedSource={readAccepted:async()=>({
   acceptanceKind:"HUMAN_ACCEPTED_DRAFT",readOnly:true,
   taskId:binding.taskId,resultId:binding.resultId,
   acceptedDigest:binding.acceptedDigest,
   signedTaskId:binding.signedTaskId,
   signedTaskRevisionId:binding.signedTaskRevisionId,
   signedTaskPackageSha256:binding.signedTaskPackageSha256,
   workRef:{...binding.workRef},
 })};
 const originalEmployee={
   verifySignedTask:async()=>true,
   authorizeAtlasExport:async()=>grant,
 };
 const prepareOriginalGraph=async({binding:original})=>({
   workspace_id:"ws:org",
   idempotency_key:operationId.slice("agent:t3:atlas:".length),
   object:{workspace_id:"ws:org",object_id:"result:1",
     schema_id:"iwxa.agent.accepted-result",schema_version:"1.0.0",
     base_revision:0,
     data:{taskId:original.taskId,resultId:original.resultId,
       acceptedDigest:original.acceptedDigest,
       signedTaskId:original.signedTaskId,
       signedTaskRevisionId:original.signedTaskRevisionId,
       signedTaskPackageSha256:original.signedTaskPackageSha256,
       contextDigest:original.contextDigest,
       workRef:{...original.workRef}}},
   event:{event_type:"iwxa.agent.result.published",payload:{}},
 });
 const create=()=>createTrustedAgentAtlasSourcePublisher({
   kernel,access,originalLedger,originalExchange,acceptedSource,
   originalEmployee,prepareOriginalGraph,
   confirmDisclosure:async()=>{consents++;return consent;},
   isHostActive:()=>true,
 });
 return {create,rows,get counts(){return {commits,exports,reserves,finalizations,consents};},
   revoke:()=>{grant=false;},binding,operationId};
}
test("native T3 source publisher binds accepted Agent source to original Kernel and Exchange",async()=>{
 const f=fixture(),owner=f.create();
 const first=await owner.read_publication(f.operationId,f.binding);
 assert.equal(first.status,"UNISSUED");
 const done=await owner.publish_accepted({...f.binding,operationId:f.operationId});
 assert.equal(done.status,"COMMITTED");
 assert.equal(done.originalReceiptVerified,true);
 assert.equal(done.sourceObjectRef.object_id,"result:1");
 assert.equal((await owner.read_published(done.sourceObjectRef)).status,"VERIFIED");
 assert.equal((await owner.read_published_for(f.binding.workRef,f.binding,{})).status,"VERIFIED");
 const signedReceipt=await owner.read_receipt(done.sourceObjectRef,
   f.binding.taskId,f.binding.resultId,done.archiveSha256,"iwxa.atlas");
 assert.equal(signedReceipt.status,"VERIFIED");
 assert.equal(signedReceipt.originalSignatureVerified,true);
 assert.equal(signedReceipt.archiveBytesVerified,true);
 assert.equal(signedReceipt.originalManifestVerified,true);
 assert.equal(signedReceipt.disclosureScope,"ORIGINAL_RESULT_ONLY");
 assert.deepEqual(signedReceipt.selectedSourceObjectRef,done.sourceObjectRef);
 assert.equal((await owner.read_latest_for_work("project:1","work:1")).revision,"2");
 assert.equal((await owner.publish_accepted({...f.binding,operationId:f.operationId})).status,
  "COMMITTED");
 assert.deepEqual(f.counts,{commits:1,exports:1,reserves:1,finalizations:1,consents:1});
});
test("separate human denial never reaches original ledger, Kernel or Exchange",async()=>{
 const f=fixture({consent:false});
 await assert.rejects(f.create().publish_accepted({...f.binding,operationId:f.operationId}),
   {code:"T3_D6_ORIGINAL_HUMAN_DISCLOSURE_REQUIRED",outcome:"DENIED"});
 assert.equal(f.counts.reserves,0);
 assert.equal(f.counts.commits,0);
});
test("lost original ledger reserve ACK cannot cause a second signed dispatch",async()=>{
 const f=fixture({lostReserve:true});
 const first=await f.create().publish_accepted({...f.binding,operationId:f.operationId});
 assert.equal(first.status,"OUTCOME_UNKNOWN");
 assert.equal(f.counts.commits,0);
 const second=await f.create().publish_accepted({...f.binding,operationId:f.operationId});
 assert.equal(second.status,"OUTCOME_UNKNOWN");
 assert.equal(f.counts.reserves,1);
});
test("lost Kernel receipt remains unknown after cold owner reopen and is never resent",async()=>{
 const f=fixture({lostKernel:true});
 assert.equal((await f.create().publish_accepted({...f.binding,
   operationId:f.operationId})).status,"OUTCOME_UNKNOWN");
 assert.equal((await f.create().publish_accepted({...f.binding,
   operationId:f.operationId})).status,"OUTCOME_UNKNOWN");
 assert.equal(f.counts.commits,1);
 assert.equal(f.counts.exports,0);
});
test("lost finalization ACK can be independently recovered from original receipts",async()=>{
 const f=fixture({lostFinalize:true});
 assert.equal((await f.create().publish_accepted({...f.binding,
   operationId:f.operationId})).status,"OUTCOME_UNKNOWN");
 assert.equal((await f.create().read_publication(f.operationId,f.binding)).status,
   "COMMITTED");
 assert.equal(f.counts.commits,1);
 assert.equal(f.counts.exports,1);
});
test("wrong operation, unauthorized export and mismatched recipient fail closed",async()=>{
 const f=fixture();
 await assert.rejects(f.create().read_publication("agent:t3:atlas:wrong",f.binding),
   {code:"T3_D6_ORIGINAL_OPERATION_ID_INVALID"});
 f.revoke();
 await assert.rejects(f.create().publish_accepted({...f.binding,
   operationId:f.operationId}),{code:"T3_D6_ATLAS_EXPORT_NOT_AUTHORIZED"});
 assert.equal(f.counts.commits,0);
 const bad={...f.binding,recipientId:"org:1"};
 await assert.rejects(f.create().publish_accepted({...bad,
   operationId:f.operationId}),{code:"T3_D6_ATLAS_ORIGINAL_BINDING_INVALID"});
});

test("unverified original Exchange bytes never finalize the corporate Atlas publication",async()=>{
 const f=fixture({unverifiedExchange:true});
 const answer=await f.create().publish_accepted({...f.binding,
   operationId:f.operationId});
 assert.equal(answer.status,"OUTCOME_UNKNOWN");
 assert.equal(f.counts.commits,1);
 assert.equal(f.counts.exports,1);
 assert.equal(f.counts.finalizations,0,
   "Unverified signed archive is not COMMITTED");
 assert.equal((await f.create().read_publication(f.operationId,
   f.binding)).status,"PREPARED");
});
test("original Kernel object readback must precede signed Exchange export",async()=>{
 const f=fixture({corruptKernelRead:true});
 const answer=await f.create().publish_accepted({...f.binding,
   operationId:f.operationId});
 assert.equal(answer.status,"OUTCOME_UNKNOWN");
 assert.equal(f.counts.commits,1);
 assert.equal(f.counts.exports,0);
 assert.equal(f.counts.finalizations,0);
 assert.equal((await f.create().read_publication(f.operationId,
   f.binding)).status,"PREPARED");
});
