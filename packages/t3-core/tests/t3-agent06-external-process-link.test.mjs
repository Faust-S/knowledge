import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedExternalProcessLink,EXTERNAL_PROCESS_LINK_SCHEMA,EXTERNAL_PROCESS_LINK_EVENT,EXTERNAL_PROCESS_LINK_DECLARATION}
  from '../src/t3/external-process-link.mjs';
import {projectActivitySnapshot} from '../src/t3/activity/index.mjs';
import {createTrustedNativeContinuation} from '../src/t3/native-result-continuation.mjs';

function fixture() {
  let revision='v1',allowed=true,loseAck=false,consent=true,writes=0;
  let onConfirm=async()=>{};
  const stored=new Map(),events=[];
  const ws={workspace_id:'ws:cehovod',deleted_at:null},currentWorkspace={
    get:()=>ws,subscribe:()=>()=>{}};
  const ref={expected_workspace_id:ws.workspace_id,record_kind:'Sales Order',record_id:'SO-0042'};
  const externalOwner={ownerId:'erpnext:shop1',readExact:async()=>({
    source_owner:'erpnext:shop1',record_kind:'Sales Order',record_id:'SO-0042',
    source_revision:revision,source_digest:'a'.repeat(64),
    source_receipt:'erpnext:read-42',source_state:'Submitted',
    private_customer:'not copied into T3'
  })};
  const ctx={kind:'PERSONAL',context_id:'ctx:1',actor_id:'actor:1',principal_id:'actor:1',
    role_id:'role:1',grant_id:'grant:1',realm_id:'realm:1',audience:'service:cehovod',
    resource:ws.workspace_id,purpose:'read-write',workspace_id:ws.workspace_id,
    organization_id:null,scope_revision:1};
  const access={currentContext:()=>ctx,actionFor:()=> 'workspace.read',
    operationDigest:()=> 'a'.repeat(64),
    authorize:()=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',
      allowed,outcome:allowed?'PERMITTED':'DENIED',evidenceOnly:true,
      requestDigest:'b'.repeat(64),policyDigest:'c'.repeat(64),
      statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString(),
      statusObservedAt:new Date(Date.now()-1000).toISOString(),
      evaluatedAt:new Date(Date.now()-1000).toISOString(),
      authorityPath:[{grantId:'grant:1'}]}),
    verifyDecisionBinding:()=>true};
  const kernel={sessionInfo:{contract_version:'1.3.0'},
    hasOperation:op=>['t1.getWorkspace','t1.getObject','t1.putObject'].includes(op),
    getWorkspace:async id=>id===ws.workspace_id?ws:null,
    getObject:async(id,obj)=>{const value=stored.get(obj);return id===ws.workspace_id&&value?
      {object:value,relations:{incoming:[],outgoing:[]}}:null;},
    async putObject(command){
      writes++;
      const old=stored.get(command.object_id);
      if(command.base_revision !== (old?.revision??0))
        throw Object.assign(new Error('REVISION_CONFLICT'),{code:'T2_REVISION_CONFLICT'});
      const obj={workspace_id:command.workspace_id,object_id:command.object_id,
        revision:(old?.revision??0)+1,schema_id:command.schema_id,schema_version:command.schema_version,
        data:command.data,extensions:command.extensions};
      stored.set(obj.object_id,obj);
      const event={event_id:'ev:'+writes,workspace_id:ws.workspace_id,
        event_type:command.event.event_type,occurred_at:'2026-11-15T10:00:00Z',
        object_id:obj.object_id,revision:obj.revision,payload:command.event.payload};
      events.push(event);
      if(loseAck)throw Error('ACK_LOST');
      return {object:obj,event};
    }};
  const newHost=()=>createTrustedExternalProcessLink({kernel,accessForWrite:async()=>access,
    currentWorkspace,externalOwner,confirmHuman:async()=>{await onConfirm();return consent;},isHostActive:()=>true});
  return {ref,stored,events,kernel,access,currentWorkspace,externalOwner,newHost,writeCount:()=>writes,
    setRevision:v=>revision=v,setAllowed:v=>allowed=v,setLostAck:v=>loseAck=v,
    setConsent:v=>consent=v,setOnConfirm:v=>onConfirm=v};
}

test('exact ERP owner revision persists as reported link and survives cold Host reopen',async()=>{
  const f=fixture();const result=await f.newHost().link(f.ref);
  assert.equal(result.status,'LINK_PERSISTED');
  assert.equal(f.writeCount(),1);
  const row=f.stored.get(result.object_id);
  assert.equal(row.data.record_authority,'EXTERNAL_OWNER');
  assert.equal(row.data.epistemic_status,'reported');
  assert.equal(row.data.private_customer,undefined);
  assert.equal((await f.newHost().link(f.ref)).status,'ALREADY_LINKED');
  assert.equal((await f.newHost().recover(f.ref)).status,'LINK_PERSISTED');
  assert.equal(f.writeCount(),1);
  const view=projectActivitySnapshot({workspace_id:f.ref.expected_workspace_id,
    objects:[{...row,created_by_service:'cehovod',updated_by_service:'cehovod',
      created_at:'2026-11-15T10:00:00Z',updated_at:'2026-11-15T10:00:00Z'}],
    events:f.events,bindings:{
      objects:[{schema_id:EXTERNAL_PROCESS_LINK_SCHEMA,
        schema_version:EXTERNAL_PROCESS_LINK_DECLARATION.schema_version,
        semantic_kind:'Evidence'}],
      events:[{event_type:EXTERNAL_PROCESS_LINK_EVENT,
        semantic_kind:'Event',epistemic_status:'reported'}]
    }});
  assert.equal(view.nodes[0].semantic_kind,'Evidence');
  assert.equal(view.events[0].epistemic_status,'reported');
  assert.ok(!JSON.stringify(view).includes('SO-0042'));
});
test('external revision conflict refuses a second T3 write',async()=>{
  const f=fixture();await f.newHost().link(f.ref);f.setRevision('v2');
  await assert.rejects(f.newHost().link(f.ref),{code:'T3_EXT_REVISION_OR_SOURCE_CONFLICT'});
  assert.equal((await f.newHost().recover(f.ref)).status,'REVISION_CONFLICT');
  assert.equal(f.writeCount(),1);
});
test('lost original Kernel ACK never resends and cold reopen recovers by signed read',async()=>{
  const f=fixture();f.setLostAck(true);
  assert.equal((await f.newHost().link(f.ref)).status,'OUTCOME_UNKNOWN');
  assert.equal((await f.newHost().recover(f.ref)).status,'LINK_PERSISTED');
  assert.equal((await f.newHost().link(f.ref)).status,'ALREADY_LINKED');
  assert.equal(f.writeCount(),1);
});
test('D1 refusal and human refusal cannot create T3 evidence',async()=>{
  const f=fixture();f.setConsent(false);
  assert.equal((await f.newHost().link(f.ref)).status,'USER_CANCELLED');
  f.setConsent(true);f.setAllowed(false);
  await assert.rejects(f.newHost().link(f.ref),{code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(f.writeCount(),0);
});

test('ERP refresh explicitly increments ORIGINAL T2 revision with no replay',async()=>{
  const f=fixture();const created=await f.newHost().link(f.ref);
  assert.equal(created.revision,1);
  f.setRevision('v2');
  const updated=await f.newHost().refresh(f.ref);
  assert.equal(updated.status,'LINK_PERSISTED');
  assert.equal(updated.revision,2);
  assert.equal(updated.source_revision,'v2');
  assert.equal((await f.newHost().refresh(f.ref)).status,'ALREADY_LINKED');
  assert.equal((await f.newHost().recover(f.ref)).revision,2);
  assert.equal(f.writeCount(),2);
  assert.deepEqual(f.events.map(e=>e.event_id),['ev:1','ev:2']);
});
test('external owner revision changing during human consent prevents refresh write',async()=>{
  const f=fixture();await f.newHost().link(f.ref);f.setRevision('v2');
  f.setOnConfirm(()=>f.setRevision('v3'));
  await assert.rejects(f.newHost().refresh(f.ref),{code:'T3_EXT_SOURCE_CHANGED_BEFORE_WRITE'});
  assert.equal(f.writeCount(),1);
});
test('lost ACK after original refresh is only recovered by signed Kernel read',async()=>{
  const f=fixture();await f.newHost().link(f.ref);f.setRevision('v2');
  f.setLostAck(true);
  assert.equal((await f.newHost().refresh(f.ref)).status,'OUTCOME_UNKNOWN');
  assert.equal((await f.newHost().recover(f.ref)).status,'LINK_PERSISTED');
  assert.equal((await f.newHost().refresh(f.ref)).status,'ALREADY_LINKED');
  assert.equal(f.writeCount(),2);
});
test('same external revision with changing state is not accepted as coherent source',async()=>{
  const f=fixture();await f.newHost().link(f.ref);
  const original=f.externalOwner.readExact;
  f.externalOwner.readExact=async (...args)=>({...await original(...args),source_state:'Cancelled'});
  await assert.rejects(f.newHost().refresh(f.ref),{code:'T3_EXT_SOURCE_REVISION_NOT_STABLE'});
  assert.equal(f.writeCount(),1);
});
test('ordinary read-only ERP GET without receipt is reported, not executed',async()=>{
  const f=fixture();const original=f.externalOwner.readExact;
  f.externalOwner.readExact=async (...args)=>({...await original(...args),source_receipt:null});
  const result=await f.newHost().link(f.ref);
  assert.equal(result.status,'LINK_PERSISTED');
  assert.equal(f.stored.get(result.object_id).data.source_receipt,null);
  assert.equal(f.stored.get(result.object_id).data.epistemic_status,'reported');
});
test('refresh requires existing link and original signed permission',async()=>{
  const f=fixture();
  assert.equal((await f.newHost().refresh(f.ref)).status,'NOT_FOUND');
  await f.newHost().link(f.ref);f.setRevision('v2');f.setAllowed(false);
  await assert.rejects(f.newHost().refresh(f.ref),{code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(f.writeCount(),1);
});

test('fresh ERP source -> original D6: HTTP ACK never means durable external Result',async()=>{
  const f=fixture();
  await assert.rejects(f.newHost().prepareContinuation(f.ref),
    {code:'T3_EXT_CONTINUATION_NOT_CURRENT'});
  const created=await f.newHost().link(f.ref);
  const ref=await f.newHost().prepareContinuation(f.ref);
  assert.deepEqual(ref,{workspace_id:f.ref.expected_workspace_id,
    object_id:created.object_id,schema_id:EXTERNAL_PROCESS_LINK_SCHEMA,revision:1});
  let attempts=0,ownerReceipt=null;
  const nativeOwner={
    recipientId:'agent:n8n',
    inspect:({reference,recipientId})=>({
      status:attempts?'RECOVER_ONLY':'READY',
      operationId:'n8n:SO-0042',recipientId,reference}),
    async receive({operationId,object}){
      attempts++;
      assert.equal(operationId,'n8n:SO-0042');
      assert.equal(object.data.record_id,'SO-0042');
      assert.equal(object.data.private_customer,undefined);
      // The existing Agent N8NWorkflowV1 only returns a transport ACK,
      // not an original external-owner completed-job receipt.
      return {external_effect_state:'ACKNOWLEDGED',request_id:'n8n-http-ack'};
    },
    receipt:async()=>ownerReceipt,
    readback:async()=>ownerReceipt?{...ownerReceipt,state:'PERSISTED'}:null,
  };
  const open=()=>createTrustedNativeContinuation({
    kernel:f.kernel,accessForRead:async()=>f.access,
    currentWorkspace:f.currentWorkspace,nativeOwner,
    confirmHuman:async()=>true,isHostActive:()=>true,
  });
  assert.equal((await open().continueSelected(ref)).status,'OUTCOME_UNKNOWN');
  assert.equal(attempts,1);
  // A cold Host must use the native owner's durable RECOVER_ONLY hint.
  assert.equal((await open().continueSelected(ref)).status,'OUTCOME_UNKNOWN');
  assert.equal(attempts,1);
  ownerReceipt={operationId:'n8n:SO-0042',recipientId:'agent:n8n',
    reference:ref,state:'COMMITTED',resultRef:'cehovod:result:42'};
  const confirmed=await open().recover(ref);
  assert.equal(confirmed.status,'OWNER_READBACK_CONFIRMED');
  assert.equal(confirmed.resultRef,'cehovod:result:42');
  assert.equal(attempts,1);
  f.setRevision('v2');
  await assert.rejects(f.newHost().prepareContinuation(f.ref),
    {code:'T3_EXT_CONTINUATION_NOT_CURRENT'});
  const updated=await f.newHost().refresh(f.ref);
  assert.equal((await f.newHost().prepareContinuation(f.ref)).revision,updated.revision);
});

test('revoked write owner cannot recover, but independent signed read-only owner can',async()=>{
  const f=fixture();
  const linked=await f.newHost().link(f.ref);
  assert.equal(linked.status,'LINK_PERSISTED');
  f.setAllowed(false);
  await assert.rejects(f.newHost().recover(f.ref),{code:'T3_ACCESS_NOT_PERMITTED'});
  let reads=0,writeAccessInvoked=0;
  const readOwner={...f.access,authorize:()=>({
    schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed:true,
    outcome:'PERMITTED',evidenceOnly:true,
    requestDigest:'b'.repeat(64),policyDigest:'c'.repeat(64),
    statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString(),
    statusObservedAt:new Date(Date.now()-1000).toISOString(),
    evaluatedAt:new Date(Date.now()-1000).toISOString(),
    authorityPath:[{grantId:'grant:1'}],
  })};
  const original=f.kernel.getObject;
  const kernel={...f.kernel,getObject:async (...args)=>{
    reads++;return original(...args);}};
  const readonly=createTrustedExternalProcessLink({
    kernel,currentWorkspace:f.currentWorkspace,externalOwner:f.externalOwner,
    accessForRead:async operation=>{
      assert.equal(operation,'t1.getObject');return readOwner;},
    confirmHuman:async()=>{throw Error('READBACK_CANNOT_REQUEST_WRITE_CONSENT')},
    isHostActive:()=>true,
  });
  assert.equal((await readonly.recover(f.ref)).status,'LINK_PERSISTED');
  assert.equal((await readonly.prepareContinuation(f.ref)).revision,linked.revision);
  assert.ok(reads>=2);
  assert.equal(writeAccessInvoked,0);
  await assert.rejects(readonly.link(f.ref),{code:'T3_EXT_WRITE_NOT_GRANTED'});
  await assert.rejects(readonly.refresh(f.ref),{code:'T3_EXT_WRITE_NOT_GRANTED'});
  assert.equal(f.writeCount(),1);
});
