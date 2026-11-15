import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedExternalProcessLink,EXTERNAL_PROCESS_LINK_SCHEMA,EXTERNAL_PROCESS_LINK_EVENT,EXTERNAL_PROCESS_LINK_DECLARATION}
  from '../src/t3/external-process-link.mjs';
import {projectActivitySnapshot} from '../src/t3/activity/index.mjs';

function fixture() {
  let revision='v1',allowed=true,loseAck=false,consent=true,writes=0;
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
      assert.equal(command.base_revision,0);
      if(stored.has(command.object_id))throw Error('REVISION_CONFLICT');
      const obj={workspace_id:command.workspace_id,object_id:command.object_id,
        revision:1,schema_id:command.schema_id,schema_version:command.schema_version,
        data:command.data,extensions:command.extensions};
      stored.set(obj.object_id,obj);
      const event={event_id:'ev:1',workspace_id:ws.workspace_id,
        event_type:command.event.event_type,occurred_at:'2026-11-15T10:00:00Z',
        object_id:obj.object_id,revision:1,payload:command.event.payload};
      events.push(event);
      if(loseAck)throw Error('ACK_LOST');
      return {object:obj,event};
    }};
  const newHost=()=>createTrustedExternalProcessLink({kernel,accessForWrite:async()=>access,
    currentWorkspace,externalOwner,confirmHuman:async()=>consent,isHostActive:()=>true});
  return {ref,stored,events,newHost,writeCount:()=>writes,
    setRevision:v=>revision=v,setAllowed:v=>allowed=v,setLostAck:v=>loseAck=v,
    setConsent:v=>consent=v};
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
