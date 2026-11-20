import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTrustedOriginalCompanyWorkspacePersistence,
  ORIGINAL_COMPANY_RECORD_SCHEMA} from
  '../src/t3/original-company-workspace-persistence.mjs';

// Contract-owner fixture only. The concrete original T2 0.3.6 Host and the
// separate private Ed25519 issuer are qualified by their existing suites.
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture({text='Результат исследования. '.repeat(60000),
  lostAck=false,writeRight=true,mutateSource=null,kind='RESULT'}={}){
  let task={organizationId:'org:factory',workspaceId:'ws:factory',
    executorId:'person:employee',taskId:'task:signed',
    taskRevisionId:'a'.repeat(64),packageSha256:'b'.repeat(64)};
  let stored=null,events=[],commits=0,active=true,writeJit=0;
  const context={kind:'CORP',context_id:'ctx:original',
    actor_id:'person:employee',principal_id:'org:factory',
    organization_id:'org:factory',role_id:'role:worker',
    grant_id:'grant:original-write',realm_id:'realm:factory',
    audience:'service:agent',resource:'ws:factory',workspace_id:'ws:factory',
    purpose:'workspace.work',scope_revision:1};
  const access={
    currentContext:()=>({...context}),
    actionFor:op=>op==='t1.commitObjectGraph'?'object.write':'workspace.read',
    operationDigest:x=>sha(JSON.stringify(x)),
    authorize:request=>{
      if(request.action==='object.write')writeJit++;
      return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
        allowed:true,outcome:'PERMITTED',evidenceOnly:true,
        requestDigest:sha(JSON.stringify(request)),
        policyDigest:'c'.repeat(64),operationDigest:'d'.repeat(64),
        evidenceDigest:'e'.repeat(64),statusSequence:1,
        organizationId:context.organization_id,workspaceId:context.workspace_id,
        grantId:context.grant_id,productionActivation:false,
        doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
        validUntil:new Date(Date.now()+60000).toISOString()};
    },
    verifyDecisionBinding:(request,decision)=>
      decision.requestDigest===sha(JSON.stringify(request)),
  };
  const kernel={
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation:op=>['t1.getWorkspace','t1.getObject',
      't1.listEventsSince','t1.commitObjectGraph'].includes(op),
    getWorkspace:async ws=>({workspace_id:ws,deleted_at:null}),
    getObject:async(ws,id)=>stored&&stored.object_id===id&&
        stored.workspace_id===ws
      ?{object:structuredClone(stored),
        relations:{incoming:[],outgoing:[]}}:null,
    listEventsSince:async()=>structuredClone(events),
    commitObjectGraph:async command=>{
      commits++;
      assert.equal(command.object.base_revision,0);
      assert.equal(command.object.schema_id,ORIGINAL_COMPANY_RECORD_SCHEMA);
      assert.equal(command.relations_put,undefined);
      assert.equal(command.relations_delete,undefined);
      if(stored)throw Error('ORIGINAL_REVISION_CONFLICT');
      stored={workspace_id:command.workspace_id,
        object_id:command.object.object_id,
        schema_id:command.object.schema_id,
        schema_version:command.object.schema_version,
        revision:1,deleted:false,deleted_at:null,
        data:structuredClone(command.object.data)};
      const e={event_id:'event:original',workspace_id:command.workspace_id,
        object_id:command.object.object_id,event_type:command.event.event_type,
        idempotency_key:command.idempotency_key,
        payload:structuredClone(command.event.payload),revision:1};
      events=[e];
      if(lostAck)throw Error('ORIGINAL_KERNEL_ACK_LOST');
      return {workspace_id:command.workspace_id,
        object:{...stored},event:e,relations_put:[]};
    },
  };
  const artifact=(arg)=>{
    mutateSource?.();
    const current=arg.task;
    return {kind:arg.kind,artifactId:arg.artifactId,
      operationId:'receipt:accepted:1',
      organizationId:current.organizationId,workspaceId:current.workspaceId,
      executorId:current.executorId,taskId:current.taskId,
      taskRevisionId:current.taskRevisionId,
      taskPackageSha256:current.packageSha256,
      mimeType:'text/markdown',text,sha256:sha(text),
      sourceKind:kind==='RESULT'?'ORIGINAL_AGENT_HUMAN_ACCEPTED':
        kind==='TASK'?'ORIGINAL_SIGNED_TASK':'ORIGINAL_COMPANY_WORKAREA'};
  };
  const make=()=>createTrustedOriginalCompanyWorkspacePersistence({
    kernel,selectSignedAccess:op=>op==='commitObjectGraph'&&!writeRight
      ?null:access,
    readOriginalSignedTask:()=>task,
    readInstalledCompanyArtifact:artifact,
    isHostActive:()=>active,
  });
  return {make,mutateTask:values=>{task={...task,...values};},
    get commits(){return commits;},get stored(){return stored;},
    get events(){return events;},get writeJit(){return writeJit;},
    stop:()=>{active=false;},tamperData:()=>{stored.data.text+='ALTERED';},
    tamperEvent:()=>{events[0].payload.artifactSha256='f'.repeat(64);}};
}

test('complete accepted Result is original company Object + exact Event, with two cold reads',async()=>{
  const fx=fixture(),p=fx.make();
  const written=await p.commit('RESULT','RES-accepted');
  assert.equal(written.state,'COMPANY_ORIGINAL_COMMITTED');
  assert.equal(written.originalKernelReadback,true);
  assert.equal(fx.commits,1);
  assert.equal(fx.writeJit,1);
  assert.equal(fx.stored.data.text,'Результат исследования. '.repeat(60000));
  const first=await fx.make().read('RESULT','RES-accepted');
  const second=await fx.make().recover('RESULT','RES-accepted');
  assert.equal(first.originalObject.data.sha256,sha(fx.stored.data.text));
  assert.equal(second.state,'COMPANY_ORIGINAL_COMMITTED');
  assert.equal(second.retrySafe,false);
  assert.equal(fx.commits,1);
  const replay=await p.commit('RESULT','RES-accepted');
  assert.equal(replay.alreadyCommitted,true);
  assert.equal(fx.commits,1);
});
test('company document and Task stay in original signed Workspace, not personal area',async()=>{
  for(const kind of ['TASK','DRAFT','DOCUMENT','HISTORY']){
    const fx=fixture({text:'Полный документ '.repeat(10000),kind});
    await fx.make().commit(kind,'document:one');
    assert.equal(fx.stored.workspace_id,'ws:factory');
    assert.equal(fx.stored.data.organizationId,'org:factory');
    assert.equal(fx.stored.data.sourceKind,kind==='TASK'
      ?'ORIGINAL_SIGNED_TASK':'ORIGINAL_COMPANY_WORKAREA');
    assert.equal(fx.commits,1);
  }
});
test('no original signed object.write grant denies company commit',async()=>{
  const fx=fixture({writeRight:false});
  await assert.rejects(fx.make().commit('RESULT','RES-accepted'),
    {code:'T3_COMPANY_SIGNED_JIT_REQUIRED'});
  assert.equal(fx.commits,0);
});
test('changing original Task during source read refuses before Kernel write',async()=>{
  let fx;
  fx=fixture({mutateSource:()=>fx.mutateTask({organizationId:'org:other'})});
  await assert.rejects(fx.make().commit('RESULT','RES-accepted'),
    {code:'T3_COMPANY_SIGNED_TASK_CHANGED'});
  assert.equal(fx.commits,0);
});
test('lost original Kernel ACK never automatically repeats write, read-only recovery finds it',async()=>{
  const fx=fixture({lostAck:true}),port=fx.make();
  await assert.rejects(port.commit('RESULT','RES-accepted'),
    /ORIGINAL_KERNEL_ACK_LOST/);
  assert.equal(port.outcomeUnknown,true);
  const recovered=await port.recover('RESULT','RES-accepted');
  assert.equal(recovered.state,'COMPANY_ORIGINAL_COMMITTED');
  await assert.rejects(port.commit('RESULT','RES-accepted'),
    {code:'T3_COMPANY_ORIGINAL_PREVIOUS_OUTCOME_UNKNOWN'});
  assert.equal(fx.commits,1);
});
test('changed original stored content or Event cannot be accepted as corporate Result',async()=>{
  for(const mutation of ['tamperData','tamperEvent']){
    const fx=fixture(),port=fx.make();
    await port.commit('RESULT','RES-accepted');
    fx[mutation]();
    await assert.rejects(port.read('RESULT','RES-accepted'),
      /T3_COMPANY_ORIGINAL_(CONTENT|EVENT)_READBACK_CHANGED/);
    assert.equal(fx.commits,1);
  }
});
test('corporate Result cannot be an unaccepted personal projection',async()=>{
  const fx=fixture({kind:'DRAFT'});
  await assert.rejects(fx.make().commit('RESULT','RES-accepted'),
    {code:'T3_COMPANY_TRUSTED_ARTIFACT_REQUIRED'});
  assert.equal(fx.commits,0);
});
