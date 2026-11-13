// This tests Activity against the exact ORIGINAL public T3 D1/D2 owner.
// Synthetic data/issuers only; not a production disclosure qualification.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bindT3ControlActivityReview,openOriginalT3ActivityReviewHost} from
  '../modules/activity-base-anonymizer/t3-control-host-link.mjs';
import {createT3ReviewController} from
  '../modules/activity-base-anonymizer/t3-review-controller.mjs';
import {stageSelectedT3ActivityReview,createTrustedT3ActivityStagePort,
  T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
  T3_ACTIVITY_OWNER_REVIEW_DECLARATION,
  T3_ACTIVITY_OWNER_REVIEW_PASSPORT} from
  '../modules/activity-base-anonymizer/t3-owner-review-stage.mjs';

const root=process.env.IWXA_T3_PUBLIC_CORE_DIR;
if(!root||!existsSync(join(resolve(root),'src/t3/index.mjs')))
  throw Error('PUBLIC_PINNED_T3_CORE_CHECKOUT_REQUIRED');
const core=await import(pathToFileURL(join(resolve(root),'src/t3/index.mjs')).href);
assert.equal(typeof core.createSubjectKernelBinding,'function');
assert.equal(typeof core.readActivityFromWorkspaceContext,'function');
const W='factory:source',R='factory:derived',OTHER='other:private';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const objects=Array.from({length:3},(_,i)=>[
  {object_id:`bracket:${i}`,workspace_id:W,revision:2,
    schema_id:'d05.bracket',schema_version:'1.0.0',
    created_by_service:'d05',updated_by_service:'d05',
    created_at:'2026-11-13T08:00:00Z',updated_at:'2026-11-13T09:00:00Z',
    data:{private_customer:`PRIVATE_CUSTOMER_${i}`},extensions:{}},
  {object_id:`material:${i}`,workspace_id:W,revision:1,
    schema_id:'d05.material',schema_version:'1.0.0',
    created_by_service:'d05',updated_by_service:'d05',
    created_at:'2026-11-13T08:00:00Z',updated_at:'2026-11-13T08:00:00Z',
    data:{private_supplier:`SECRET_SUPPLIER_${i}`},extensions:{}},
]).flat();
const events=Array.from({length:3},(_,i)=>[
  {event_id:`event:${i}:1`,workspace_id:W,service_id:'d05',
    event_type:'d05.bracket.opened',object_id:`bracket:${i}`,revision:1,
    occurred_at:'2026-11-13T08:00:00Z',payload:{private:'TOP_SECRET'}},
  {event_id:`event:${i}:2`,workspace_id:W,service_id:'d05',
    event_type:'d05.bracket.reworked',object_id:`bracket:${i}`,revision:2,
    occurred_at:'2026-11-13T09:00:00Z',
    payload:{affected:[{object_id:`material:${i}`,revision:1}],private:'TOP_SECRET'}},
]).flat();
const bindings={
  objects:[
    {schema_id:'d05.bracket',schema_version:'1.0.0',semantic_kind:'Process'},
    {schema_id:'d05.material',schema_version:'1.0.0',semantic_kind:'Entity'},
  ],
  events:[
    {event_type:'d05.bracket.opened',semantic_kind:'Event'},
    {event_type:'d05.bracket.reworked',semantic_kind:'Event',
      object_links:[{field:'affected',qualifier:'uses',many:true}]},
  ],
};
function fixture({corp=true}={}){
  const saved=new Map(),listeners=[new Set(),new Set()];
  const choices=[Object.freeze({workspace_id:W}),Object.freeze({workspace_id:R})];
  const state={sourceRevoked:false,deriveRevoked:false,readCalls:0,writeCalls:0,
    switchDuringRead:false,lostAck:false,sourceEnumerations:0,
    revisionDriftAfterInitial:false,revokeDeriveOnSourceRecheck:false};
  const owner=(ws,action)=>Object.freeze({
    kind:corp?'CORP':'PERSONAL',context_id:ws,
    actor_id:'person:operator',principal_id:corp?'org:cehovod':'person:operator',
    role_id:'role:operator',grant_id:'grant:'+action,realm_id:'realm:cehovod',
    audience:'host:t3',workspace_id:ws,resource:ws,
    purpose:action==='derive'?'activity.derivation':'activity.analysis',
    organization_id:corp?'org:cehovod':null,scope_revision:1,
  });
  const contexts=[owner(W,'read'),owner(R,'derive')];
  const access=(i)=>({
    currentContext:()=>contexts[i],
    actionFor:op=>{
      if(i===0) {
        assert.ok(['t1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince'].includes(op));
        return 'activity.read';
      }
      assert.ok(['t1.getWorkspace','t1.listObjects','t1.putObject','t1.getObject'].includes(op));
      return 'activity.derive';
    },
    operationDigest:({operation,input,context})=>sha({operation,input,context}),
    authorize:async request=>{
      const c=contexts[i],allowed=!(i===0?state.sourceRevoked:state.deriveRevoked);
      const now=Date.now();
      return {
        schema:corp?'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1':
          'IWXA_T3_AUTHORIZATION_DECISION/1',
        allowed,outcome:allowed?'PERMITTED':'DENIED',
        evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('test-policy'),
        statusSequence:1,validUntil:new Date(now+60_000).toISOString(),
        evaluatedAt:new Date(now-1000).toISOString(),
        statusObservedAt:new Date(now-1000).toISOString(),
        authorityPath:[{grantId:request.grantId}],
        ...(corp?{
          organizationId:c.organization_id,workspaceId:c.workspace_id,
          grantId:c.grant_id,operationDigest:sha({request,scope:c.workspace_id}),
          evidenceDigest:sha({request}),productionActivation:false,
          doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
        }:{})
      };
    },
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request),
  });
  const kernel={
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6',mode:'full'},
    hasOperation:op=>['t1.getWorkspace','t1.listObjects','t1.getObject',
      't1.listEventsSince','t1.putObject'].includes(op),
    async getWorkspace(ws){state.readCalls++;return [W,R].includes(ws)?{workspace_id:ws}:null;},
    async listObjects({workspace_id:ws}){
      state.readCalls++;
      if(ws===W) {
        state.sourceEnumerations++;
        if(state.revokeDeriveOnSourceRecheck&&state.sourceEnumerations>=3)
          state.deriveRevoked=true;
        if(state.switchDuringRead){state.switchDuringRead=false;for(const l of listeners[0])l();}
        return objects.map(x=>{
          const copy=structuredClone(x);
          if(state.revisionDriftAfterInitial&&state.sourceEnumerations>=3&&
            copy.object_id==='bracket:0')copy.revision=3;
          return copy;
        });
      }
      return [...saved.values()].filter(x=>x.workspace_id===ws).map(x=>structuredClone(x));
    },
    async listEventsSince(ws){state.readCalls++;return ws===W?structuredClone(events):[];},
    async getObject(ws,id){
      state.readCalls++;
      const found=ws===W?objects.find(x=>x.object_id===id):saved.get(id);
      if(!found)return null;
      const object=structuredClone(found);
      if(state.revisionDriftAfterInitial&&state.sourceEnumerations>=3&&
        object.object_id==='bracket:0')object.revision=3;
      return {object,relations:{incoming:[],outgoing:[]}};
    },
    async putObject(input){
      state.writeCalls++;
      assert.equal(input.workspace_id,R);
      assert.equal(input.base_revision,0);
      assert.equal(saved.size,0);
      assert.equal(input.schema_id,T3_ACTIVITY_OWNER_REVIEW_SCHEMA);
      const object={...structuredClone(input),revision:1};
      saved.set(input.object_id,object);
      if(state.lostAck)throw Error('LOST_ACK_AFTER_COMMIT');
      return {object,event:{workspace_id:R,event_id:'staged:event:1'}};
    },
  };
  const selected=(index)=>({kernel,currentWorkspace:{
    get:()=>choices[index],
    subscribe(fn){listeners[index].add(fn);return()=>listeners[index].delete(fn);},
  }});
  const sourceContext=selected(0),targetContext=selected(1);
  const sourceSignedAccess=access(0),targetSignedAccess=access(1);
  const options={sourceContext,targetContext,sourceSignedAccess,targetSignedAccess,
    bindings,explicitSave:true,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding};
  return {options,saved,state,contexts,listeners,
    chooseTargetSameAsSource(){choices[1]=choices[0];contexts[1]=Object.freeze({
      ...contexts[1],context_id:W,workspace_id:W,resource:W,
    });},
    moveTargetToForeignOrg(){contexts[1]=Object.freeze({
      ...contexts[1],principal_id:'org:foreign',organization_id:'org:foreign',
    });},
    addExistingTarget(){saved.set('existing:foreign',{object_id:'existing:foreign',
      workspace_id:R,revision:1,data:{private:'SECRET'}});},
  };
}
test('separate same-owner target writes a review through ORIGINAL D1 Kernel, not a package',async()=>{
  for(const corp of [true,false]){
    const f=fixture({corp});
    const before=structuredClone({objects,events,bindings});
    const receipt=await stageSelectedT3ActivityReview(f.options);
    assert.equal(receipt.status,'OWNER_REVIEW_DRAFT');
    assert.equal(receipt.source_review_status,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
    assert.equal(receipt.readback,true);assert.equal(receipt.export_allowed,false);
    assert.equal(receipt.workspace_id,R);
    assert.equal(f.saved.size,1);
    assert.equal(f.state.writeCalls,1);
    const record=f.saved.get(receipt.object_id);
    assert.equal(record.schema_id,'iwxa.activity.process-review');
    assert.equal(record.data.export_allowed,false);
    assert.equal(record.data.anonymity,'NOT_ESTABLISHED');
    assert.equal(record.data.disclosure_status,'NOT_EVALUATED');
    assert.equal(record.data.candidate.length,2);
    assert.equal(JSON.stringify(record).includes('PRIVATE_CUSTOMER'),false);
    assert.equal(JSON.stringify(record).includes('TOP_SECRET'),false);
    assert.equal(JSON.stringify(record).includes('SECRET_SUPPLIER'),false);
    assert.equal(JSON.stringify(record).includes('bracket:0'),false);
    assert.equal(JSON.stringify(record).includes('material:0'),false);
    assert.equal(JSON.stringify(record).includes('org:cehovod'),false);
    assert.deepEqual({objects,events,bindings},before);
    assert.equal(f.listeners[0].size,0);assert.equal(f.listeners[1].size,0);
  }
});
test('an explicit approval and separately signed derive operation are mandatory',async()=>{
  const f=fixture();
  await assert.rejects(stageSelectedT3ActivityReview({...f.options,explicitSave:false}),
    {code:'T3_ACTIVITY_EXPLICIT_SAVE_REQUIRED'});
  assert.equal(f.state.readCalls,0);assert.equal(f.state.writeCalls,0);
  f.options.targetSignedAccess.actionFor=()=> 'activity.read';
  await assert.rejects(stageSelectedT3ActivityReview(f.options),
    {code:'T3_ACTIVITY_DERIVE_ACTION_REQUIRED'});
  assert.equal(f.state.readCalls,0);assert.equal(f.state.writeCalls,0);
});
test('different principal, same Workspace, nonempty target are rejected before writes',async()=>{
  const x=fixture();x.moveTargetToForeignOrg();
  await assert.rejects(stageSelectedT3ActivityReview(x.options),
    {code:'T3_ACTIVITY_CROSS_PRINCIPAL_TRANSFER_FORBIDDEN'});
  assert.equal(x.state.readCalls,0);
  const same=fixture();same.chooseTargetSameAsSource();
  await assert.rejects(stageSelectedT3ActivityReview(same.options),
    {code:'T3_ACTIVITY_SEPARATE_TARGET_WORKSPACE_REQUIRED'});
  const occupied=fixture();occupied.addExistingTarget();
  await assert.rejects(stageSelectedT3ActivityReview(occupied.options),
    {code:'T3_ACTIVITY_TARGET_NOT_EMPTY'});
  assert.equal(occupied.state.writeCalls,0);
});
test('revoked source read or derive grant cannot produce a draft',async()=>{
  const read=fixture();read.state.sourceRevoked=true;
  await assert.rejects(stageSelectedT3ActivityReview(read.options),
    {code:'T3_AUTHORITATIVE_READ_REFUSED'});
  assert.equal(read.state.writeCalls,0);
  const derive=fixture();derive.state.deriveRevoked=true;
  await assert.rejects(stageSelectedT3ActivityReview(derive.options),
    {code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(derive.state.writeCalls,0);
});
test('source selection A to B to A invalidates analysis even if source ID is unchanged',async()=>{
  const f=fixture();f.state.switchDuringRead=true;
  await assert.rejects(stageSelectedT3ActivityReview(f.options),
    {code:'T3_AUTHORITATIVE_READ_REFUSED'});
  assert.equal(f.state.writeCalls,0);
});
test('lost acknowledgement after original Kernel commit never retries',async()=>{
  const f=fixture();f.state.lostAck=true;
  await assert.rejects(stageSelectedT3ActivityReview(f.options),error=>{
    assert.equal(error.code,'T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
    assert.equal(error.cause_code,'UNVERIFIED_COMMIT_OR_READBACK');
    assert.equal(error.object_id&&f.saved.has(error.object_id),true);
    return true;
  });
  assert.equal(f.state.writeCalls,1);
  assert.equal(f.saved.size,1);
});
test('native original Kernel schema declaration remains a review-only typed object',()=>{
  const schema=T3_ACTIVITY_OWNER_REVIEW_DECLARATION.json_schema;
  assert.equal(T3_ACTIVITY_OWNER_REVIEW_DECLARATION.schema_version,'1.0.0');
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.status.const,'OWNER_REVIEW_DRAFT');
  assert.equal(schema.properties.export_allowed.const,false);
  assert.equal(schema.properties.anonymity.const,'NOT_ESTABLISHED');
  assert.equal(schema.properties.disclosure_status.const,'NOT_EVALUATED');
});

test('source revision drift or JIT derive revocation before material write fails closed',async()=>{
  const changed=fixture();changed.state.revisionDriftAfterInitial=true;
  await assert.rejects(stageSelectedT3ActivityReview(changed.options),
    {code:'T3_ACTIVITY_SOURCE_CHANGED_BEFORE_SAVE'});
  assert.equal(changed.state.writeCalls,0);
  const revoked=fixture();revoked.state.revokeDeriveOnSourceRecheck=true;
  await assert.rejects(stageSelectedT3ActivityReview(revoked.options),
    {code:'T3_ACCESS_NOT_PERMITTED'});
  assert.equal(revoked.state.writeCalls,0);
});
test('different Kernel even with same principal cannot become a silent store transfer',async()=>{
  const f=fixture();
  f.options.targetContext={...f.options.targetContext,
    kernel:{...f.options.targetContext.kernel}};
  await assert.rejects(stageSelectedT3ActivityReview(f.options),
    {code:'T3_ACTIVITY_SAME_ORIGINAL_KERNEL_REQUIRED'});
  assert.equal(f.state.readCalls,0);assert.equal(f.state.writeCalls,0);
});

test('trusted stage port exposes only a non-exportable three-field result',async()=>{
  const f=fixture();
  const stagePort=createTrustedT3ActivityStagePort(f.options);
  assert.deepEqual(Object.keys(stagePort),['stageSelected']);
  const receipt=await stagePort.stageSelected();
  assert.deepEqual(receipt,{
    status:'OWNER_REVIEW_DRAFT',readback:true,export_allowed:false,
  });
  assert.equal('signedAccess' in stagePort,false);
  assert.equal('kernel' in stagePort,false);
  assert.equal(f.saved.size,1);
});

test('original corporate Control Host binds signed read plus separate derivation',async()=>{
  const f=fixture(),sourceListeners=new Set(),targetListeners=new Set(),states=[];
  let epoch=1,grants=0;
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:epoch}),
    async signedActivityAccess(){grants++;return f.options.sourceSignedAccess;},
    subscribeInvalidation(fn){sourceListeners.add(fn);return()=>sourceListeners.delete(fn);},
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,
    bindings:f.options.bindings,createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetContext:f.options.targetContext,
      targetSignedAccess:f.options.targetSignedAccess,
      createSubjectKernelBinding:core.createSubjectKernelBinding,
      subscribeOwnerInvalidation(fn){targetListeners.add(fn);return()=>targetListeners.delete(fn);},
    },
  });
  assert.deepEqual(Object.keys(bridge.port).sort(),
    ['readSelected','stageSelected','subscribeInvalidation']);
  for(const key of ['kernel','control','sourceSignedAccess','targetSignedAccess'])
    assert.equal(Object.hasOwn(bridge.port,key),false);
  const ui=createT3ReviewController({host:bridge.port,onUpdate:s=>states.push(s)});
  assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
  assert.deepEqual(await ui.stageSelected(),{status:'STAGED'});
  assert.equal(f.saved.size,1);
  assert.equal(f.state.writeCalls,1);
  assert.equal(grants,2,'new source grant for each read and save');
  assert.equal(states.at(-1).review,null);
  assert.equal(JSON.stringify(states).includes('org:cehovod'),false);
  ui.dispose();bridge.dispose();
  assert.equal(sourceListeners.size,0);
  assert.equal(targetListeners.size,0);
  assert.equal(f.listeners[0].size,0);
  assert.equal(f.listeners[1].size,0);
});
test('target grant notification clears Activity review and refuses reuse',async()=>{
  const f=fixture(),sourceListeners=new Set(),targetListeners=new Set(),states=[];
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:1}),
    signedActivityAccess:()=>f.options.sourceSignedAccess,
    subscribeInvalidation(fn){sourceListeners.add(fn);return()=>sourceListeners.delete(fn);},
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,bindings:f.options.bindings,
    createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetContext:f.options.targetContext,targetSignedAccess:f.options.targetSignedAccess,
      createSubjectKernelBinding:core.createSubjectKernelBinding,
      subscribeOwnerInvalidation(fn){targetListeners.add(fn);return()=>targetListeners.delete(fn);},
    },
  });
  const ui=createT3ReviewController({host:bridge.port,onUpdate:s=>states.push(s)});
  assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
  f.state.deriveRevoked=true;
  for(const fn of targetListeners)fn();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  assert.deepEqual(await ui.stageSelected(),{status:'UNAVAILABLE'});
  assert.equal(f.state.writeCalls,0);
  ui.dispose();bridge.dispose();
});
test('trusted renderer stage port strips lost-ack object_id and cause detail',async()=>{
  const f=fixture();f.state.lostAck=true;
  const stage=createTrustedT3ActivityStagePort(f.options);
  await assert.rejects(stage.stageSelected(),error=>{
    assert.equal(error.code,'T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
    assert.deepEqual(Object.keys(error).sort(),['code','name']);
    assert.equal(JSON.stringify(error).includes('activity-review:'),false);
    return true;
  });
  assert.equal(f.saved.size,1);assert.equal(f.state.writeCalls,1);
});
test('async signed original Host contexts can still stage a review',async()=>{
  const f=fixture();
  const read=f.options.sourceSignedAccess.currentContext.bind(f.options.sourceSignedAccess);
  const derive=f.options.targetSignedAccess.currentContext.bind(f.options.targetSignedAccess);
  f.options.sourceSignedAccess.currentContext=async()=>read();
  f.options.targetSignedAccess.currentContext=async()=>derive();
  const receipt=await stageSelectedT3ActivityReview(f.options);
  assert.equal(receipt.status,'OWNER_REVIEW_DRAFT');
  assert.equal(f.state.writeCalls,1);
});

test('corporate epoch change after original Kernel commit is uncertain, never retried',async()=>{
  const f=fixture(),ownerListeners=new Set(),deriveListeners=new Set();
  let epoch=1,entered=null,release=null;
  const enteredWrite=new Promise(resolve=>{entered=resolve});
  const original=f.options.sourceContext.kernel.putObject;
  f.options.sourceContext.kernel.putObject=async input=>{
    entered();
    await new Promise(resolve=>{release=resolve});
    return original.call(f.options.sourceContext.kernel,input);
  };
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:epoch}),
    signedActivityAccess:()=>f.options.sourceSignedAccess,
    subscribeInvalidation(fn){ownerListeners.add(fn);return()=>ownerListeners.delete(fn);},
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,bindings:f.options.bindings,
    createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetContext:f.options.targetContext,targetSignedAccess:f.options.targetSignedAccess,
      createSubjectKernelBinding:core.createSubjectKernelBinding,
      subscribeOwnerInvalidation(fn){deriveListeners.add(fn);return()=>deriveListeners.delete(fn);},
    },
  });
  const first=bridge.port.stageSelected();
  await enteredWrite;
  await assert.rejects(bridge.port.stageSelected(),
    {code:'T3_CONTROL_ACTIVITY_STAGE_IN_PROGRESS'});
  epoch++;
  for(const listener of ownerListeners)listener();
  release();
  await assert.rejects(first,error=>{
    assert.equal(error.code,'T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
    assert.equal(Object.hasOwn(error,'object_id'),false);
    assert.equal(Object.hasOwn(error,'cause_code'),false);
    return true;
  });
  assert.equal(f.state.writeCalls,1);
  assert.equal(f.saved.size,1,'the first original commit is preserved, not retried');
  bridge.dispose();
  assert.equal(ownerListeners.size,0);
  assert.equal(deriveListeners.size,0);
  assert.equal(f.listeners[0].size,0);
  assert.equal(f.listeners[1].size,0);
});

test('actual T2 Runtime 1.3.0 service passport declares private-only review data',()=>{
  const path=resolve(root,'src/kernel-client/contracts/runtime-1.3.0/schemas');
  const sourceSchema=JSON.parse(readFileSync(join(path,'service-schema-declaration.schema.json'),'utf8'));
  const passportSchema=JSON.parse(readFileSync(join(path,'service-passport.schema.json'),'utf8'));
  const declaration=T3_ACTIVITY_OWNER_REVIEW_DECLARATION;
  const passport=T3_ACTIVITY_OWNER_REVIEW_PASSPORT;
  for(const key of sourceSchema.required.filter(key=>key!=='schema_id'))
    assert.ok(Object.hasOwn(declaration,key),key);
  // The actual original 0.3.6 passport validator (strict Zod) forbids this
  // key INSIDE the declaration despite the copied JSON contract mismatch.
  assert.equal(Object.hasOwn(declaration,'schema_id'),false);
  for(const key of passportSchema.required) assert.ok(Object.hasOwn(passport,key),key);
  assert.equal(
    passport.schemas[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],declaration,
    'schema_id is the outer passport map key');
  assert.equal(Object.isFrozen(declaration.json_schema.properties.candidate),true);
  assert.equal(Object.isFrozen(passport.permissions),true);
  assert.equal(Object.isFrozen(passport.permissions.packages),true);
  assert.equal(Object.isFrozen(passport.permissions.objects.write),true);
  assert.equal(passport.schemas[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],declaration);
  assert.equal(passport.service_id,'iwxa.activity.reviewer');
  assert.deepEqual(passport.output_object_types,[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]);
  assert.deepEqual(passport.permissions.objects.read,[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]);
  assert.deepEqual(passport.permissions.objects.write,[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]);
  assert.deepEqual(passport.permissions.objects.delete,[]);
  assert.equal(passport.permissions.packages.export,false);
  assert.equal(passport.permissions.packages.import,false);
  assert.equal(passport.permissions.workspace.create,false);
  assert.ok(!JSON.stringify(passport.permissions).includes('"*"'));
  assert.equal(declaration.json_schema.properties.export_allowed.const,false);
  assert.equal(declaration.json_schema.properties.anonymity.const,'NOT_ESTABLISHED');
});

test('stock Host single CurrentWorkspaceStore never advertises a fake second-Workspace save',async()=>{
  const f=fixture(),controlListeners=new Set(),deriveListeners=new Set();
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:1}),
    signedActivityAccess:()=>f.options.sourceSignedAccess,
    subscribeInvalidation(fn){controlListeners.add(fn);return()=>controlListeners.delete(fn);},
  };
  // In the original T3 ModuleContextProvider every module reads the same
  // selected Workspace. A target grant does not create a second selection.
  const singleStoreContext={
    kernel:f.options.sourceContext.kernel,
    currentWorkspace:f.options.sourceContext.currentWorkspace,
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,bindings:f.options.bindings,
    createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetContext:singleStoreContext,
      targetSignedAccess:f.options.targetSignedAccess,
      createSubjectKernelBinding:core.createSubjectKernelBinding,
      subscribeOwnerInvalidation(fn){deriveListeners.add(fn);return()=>deriveListeners.delete(fn);},
    },
  });
  assert.deepEqual(Object.keys(bridge.port).sort(),
    ['readSelected','subscribeInvalidation']);
  assert.equal(f.state.writeCalls,0);
  const states=[];
  const ui=createT3ReviewController({host:bridge.port,onUpdate:s=>states.push(s)});
  assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
  assert.deepEqual(await ui.stageSelected(),{status:'UNAVAILABLE'});
  assert.equal(f.state.writeCalls,0);
  ui.dispose();bridge.dispose();
  assert.equal(controlListeners.size,0);
  assert.equal(deriveListeners.size,0);
  assert.equal(f.listeners[0].size,0);
});

test('single original T3 Host stages into a differently signed target without second WorkspaceStore',async()=>{
  for(const corp of [true,false]){
    const f=fixture({corp});
    const sourceStore=f.options.sourceContext.currentWorkspace;
    const ownerScoped={...f.options,targetContext:null,targetWorkspaceId:R};
    assert.equal('currentWorkspace' in ownerScoped,false);
    const receipt=await stageSelectedT3ActivityReview(ownerScoped);
    assert.equal(receipt.status,'OWNER_REVIEW_DRAFT');
    assert.equal(receipt.workspace_id,R);
    assert.equal(receipt.readback,true);
    assert.equal(f.saved.size,1);
    assert.equal(f.state.writeCalls,1);
    assert.equal(f.options.sourceContext.currentWorkspace,sourceStore);
    assert.equal(JSON.stringify([...f.saved.values()]).includes('PRIVATE_CUSTOMER'),false);
    assert.equal(f.listeners[1].size,0,'no target WorkspaceStore listener exists');
  }
});
test('original signed target scope, purpose and principal deny false derivation before write',async()=>{
  const wrong=fixture();
  await assert.rejects(stageSelectedT3ActivityReview({
    ...wrong.options,targetContext:null,targetWorkspaceId:'ws:foreign',
  }),{code:'T3_ACTIVITY_OWNER_WORKSPACE_MISMATCH'});
  assert.equal(wrong.state.writeCalls,0);
  const same=fixture();
  same.chooseTargetSameAsSource();
  await assert.rejects(stageSelectedT3ActivityReview({
    ...same.options,targetContext:null,targetWorkspaceId:W,
  }),{code:'T3_ACTIVITY_SEPARATE_TARGET_WORKSPACE_REQUIRED'});
  assert.equal(same.state.writeCalls,0);
  const foreign=fixture();
  foreign.moveTargetToForeignOrg();
  await assert.rejects(stageSelectedT3ActivityReview({
    ...foreign.options,targetContext:null,targetWorkspaceId:R,
  }),{code:'T3_ACTIVITY_CROSS_PRINCIPAL_TRANSFER_FORBIDDEN'});
  assert.equal(foreign.state.writeCalls,0);
  const missing=fixture();
  await assert.rejects(stageSelectedT3ActivityReview({
    ...missing.options,targetContext:null,targetWorkspaceId:null,
  }),{code:'T3_ACTIVITY_SIGNED_TARGET_REQUIRED'});
  assert.equal(missing.state.writeCalls,0);
});
test('signed-target-only path keeps lost acknowledgment private, never repeats T2 write',async()=>{
  const f=fixture();f.state.lostAck=true;
  const port=createTrustedT3ActivityStagePort({
    ...f.options,targetContext:null,targetWorkspaceId:R,
  });
  await assert.rejects(port.stageSelected(),e=>{
    assert.equal(e.code,'T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
    assert.equal(Object.hasOwn(e,'object_id'),false);
    return true;
  });
  assert.equal(f.state.writeCalls,1);assert.equal(f.saved.size,1);
});

test('original single-selection Activity bridge stages using a signed target, without target Context',async()=>{
  const f=fixture(),listeners=new Set();
  let sourceGrants=0,targetGrants=0;
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:1}),
    signedActivityAccess:()=>{sourceGrants++;return f.options.sourceSignedAccess;},
    subscribeInvalidation(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,bindings:f.options.bindings,
    createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetWorkspaceId:R,
      async resolveTargetSignedAccess(){targetGrants++;return f.options.targetSignedAccess;},
      createSubjectKernelBinding:core.createSubjectKernelBinding,
    },
  });
  assert.deepEqual(Object.keys(bridge.port).sort(),
    ['readSelected','stageSelected','subscribeInvalidation']);
  const state=[],ui=createT3ReviewController({host:bridge.port,onUpdate:x=>state.push(x)});
  assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
  assert.deepEqual(await ui.stageSelected(),{status:'STAGED'});
  assert.equal(f.saved.size,1);assert.equal(f.state.writeCalls,1);
  assert.equal(sourceGrants,2);assert.equal(targetGrants,1);
  assert.equal(f.listeners[1].size,0,'no target selection store was created');
  assert.equal(state.at(-1).review,null);
  ui.dispose();bridge.dispose();
  assert.equal(listeners.size,0);
  assert.equal(f.listeners[0].size,0);
});
test('single-selection signed bridge refuses vanished or changed target scope',async()=>{
  const f=fixture(),listeners=new Set();
  let status='absent';
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'org:cehovod',contextEpoch:1}),
    signedActivityAccess:()=>f.options.sourceSignedAccess,
    subscribeInvalidation(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  };
  const bridge=bindT3ControlActivityReview({
    control,context:f.options.sourceContext,bindings:f.options.bindings,
    createSignedAccessHostPort:core.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    derivation:{
      targetWorkspaceId:R,
      resolveTargetSignedAccess:()=>status==='absent'?null:f.options.targetSignedAccess,
      createSubjectKernelBinding:core.createSubjectKernelBinding,
    },
  });
  await assert.rejects(bridge.port.stageSelected(),
    {code:'T3_CONTROL_DERIVATION_OWNER_REQUIRED'});
  assert.equal(f.state.writeCalls,0);
  status='present';
  f.moveTargetToForeignOrg();
  await assert.rejects(bridge.port.stageSelected(),{
    code:'T3_ACTIVITY_CROSS_PRINCIPAL_TRANSFER_FORBIDDEN',
  });
  assert.equal(f.state.writeCalls,0);
  bridge.dispose();
  assert.equal(listeners.size,0);
});

const {createControlLoopbackOwner}=await import(pathToFileURL(
  join(resolve(root),'src/t3/control-loopback-owner.mjs')).href);

function originalSignedControlFixture(f,{grantDerive=true}={}){
  const origin='http://127.0.0.1:19841',token='x'.repeat(44);
  let generation=1,streamCount=0,controller=null,selectedDerive=0;
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{
    status,headers:{'Content-Type':'application/json'},
  });
  const fetchImpl=async(url,options={})=>{
    assert.ok(url.startsWith(origin+'/api/t3/'));
    assert.equal(options.headers.Authorization,'Bearer '+token);
    if(url.endsWith('/owner-events')){
      streamCount++;
      return new Response(new ReadableStream({
        start(c){
          controller=c;
          c.enqueue(new TextEncoder().encode('event: ready\n\n'));
        },
      }),{status:200,headers:{'Content-Type':'text/event-stream'}});
    }
    if(url.endsWith('/context-epoch'))return reply({contextEpoch:generation});
    const input=JSON.parse(options.body);
    const access=input.operation==='activity.derive'
      ? f.options.targetSignedAccess:f.options.sourceSignedAccess;
    if(input.verb==='select'){
      if(input.operation==='activity.derive')selectedDerive++;
      return reply({
        contextEpoch:generation,
        available:input.scope==='activity'&&
          (input.operation==='activity.read'||
           (grantDerive&&input.operation==='activity.derive')),
      });
    }
    if(input.verb==='context')return reply({context:await access.currentContext()});
    if(input.verb==='action')return reply({
      action:await access.actionFor(input.kernelOperation),
    });
    if(input.verb==='digest')return reply({
      digest:await access.operationDigest({
        operation:input.kernelOperation,input:input.command,context:input.context,
      }),
    });
    if(input.verb==='authorize')return reply({
      decision:await access.authorize(input.request),
    });
    throw Error('UNEXPECTED_ORIGINAL_CONTROL_METHOD');
  };
  const control=createControlLoopbackOwner({origin,token,fetchImpl});
  return {control,
    streams:()=>streamCount,selectedDerive:()=>selectedDerive,
    invalidate(){
      controller?.enqueue(new TextEncoder().encode('event: invalidated\n\n'));
    },
    close(){try{controller?.close();}catch{}},
  };
}
test('installed-shape original Control mounts Activity derive via ONE SSE and ONE selected Workspace',async()=>{
  const f=fixture();
  const c=originalSignedControlFixture(f);
  const bound=await openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:f.options.sourceContext.kernel,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  const updates=[],ui=createT3ReviewController({
    host:bound.port,onUpdate:state=>updates.push(state),
  });
  try{
    assert.equal(c.streams(),1,'a second Control SSE would break the original Host');
    assert.deepEqual(Object.keys(bound.port).sort(),
      ['readSelected','stageSelected','subscribeInvalidation']);
    assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
    assert.deepEqual(await ui.stageSelected(),{status:'STAGED'});
    assert.equal(f.saved.size,1);assert.equal(f.state.writeCalls,1);
    assert.equal(c.selectedDerive(),2,'fresh original derive scope is selected for the write');
    assert.equal(f.listeners[1].size,0,'NO second CurrentWorkspaceStore exists');
    assert.equal(JSON.stringify(updates).includes('PRIVATE_CUSTOMER'),false);
    assert.equal(JSON.stringify(updates).includes('org:cehovod'),false);
    assert.deepEqual(Object.keys(updates.at(-1)),['status','review']);
    assert.equal(c.streams(),1);
  }finally{
    ui.dispose();bound.dispose();c.close();
  }
});
test('original signed Control with no derivation grant mounts read-only Activity',async()=>{
  const f=fixture(),c=originalSignedControlFixture(f,{grantDerive:false});
  const bound=await openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:f.options.sourceContext.kernel,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  const state=[],ui=createT3ReviewController({host:bound.port,onUpdate:x=>state.push(x)});
  try{
    assert.deepEqual(Object.keys(bound.port).sort(),[
      'readSelected','subscribeInvalidation',
    ]);
    assert.equal((await ui.readSelected()).status,'REVIEW');
    assert.equal((await ui.stageSelected()).status,'UNAVAILABLE');
    assert.equal(f.state.writeCalls,0);assert.equal(c.streams(),1);
  }finally{ui.dispose();bound.dispose();c.close();}
});
test('original Host shared signed invalidation does not open duplicate Control SSE',async()=>{
  const f=fixture(),c=originalSignedControlFixture(f),observers=new Set();
  const stopParent=c.control.subscribeSignedAccessInvalidation(()=>{
    for(const fn of observers)fn();
  });
  const bound=await openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:f.options.sourceContext.kernel,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
    subscribeExistingInvalidation:fn=>{
      observers.add(fn);return()=>observers.delete(fn);
    },
  });
  const events=[],ui=createT3ReviewController({host:bound.port,onUpdate:x=>events.push(x)});
  try{
    assert.equal(c.streams(),1);
    assert.equal((await ui.readSelected()).status,'REVIEW');
    const notified=new Promise(resolve=>bound.port.subscribeInvalidation(resolve));
    f.state.sourceRevoked=true;
    c.invalidate();
    await notified;
    assert.deepEqual(events.at(-1),{status:'READY_TO_READ',review:null});
    assert.equal((await ui.readSelected()).status,'HOLD');
    assert.equal(f.state.writeCalls,0);
    assert.equal(c.streams(),1);
  }finally{
    ui.dispose();bound.dispose();stopParent();c.close();
    assert.equal(observers.size,0);
  }
});
test('signed Control foreign target never exposes the Activity stage command',async()=>{
  const f=fixture();f.moveTargetToForeignOrg();
  const c=originalSignedControlFixture(f);
  const bound=await openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:f.options.sourceContext.kernel,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  try{
    assert.deepEqual(Object.keys(bound.port).sort(),[
      'readSelected','subscribeInvalidation',
    ]);
    assert.equal(f.state.writeCalls,0);
  }finally{bound.dispose();c.close();}
});

test('native T3 module signed facade must not substitute original Kernel for second target',async()=>{
  const f=fixture(),c=originalSignedControlFixture(f);
  const fakeSourceBound={...f.options.sourceContext,kernel:{
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation:()=>false,
    async getWorkspace(){throw Error('SOURCE_BOUND_FACADE_NOT_ORIGINAL');},
  }};
  const bridge=await openOriginalT3ActivityReviewHost({
    control:c.control,context:fakeSourceBound,
    originalKernel:f.options.sourceContext.kernel,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  const ui=createT3ReviewController({host:bridge.port,onUpdate:()=>{}});
  try{
    assert.equal((await ui.readSelected()).status,'REVIEW');
    assert.equal((await ui.stageSelected()).status,'STAGED');
    assert.equal(f.state.writeCalls,1);
    assert.equal(f.saved.size,1);
  }finally{ui.dispose();bridge.dispose();c.close();}
});
test('native original Host refuses an untrusted or absent Kernel facade',async()=>{
  const f=fixture(),c=originalSignedControlFixture(f);
  await assert.rejects(openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:null,bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  }),{code:'T3_CONTROL_ORIGINAL_HOST_REQUIRED'});
  assert.equal(c.streams(),0);
});

const {planOriginalT2ActivityReviewRegistration}=await import(
  '../modules/activity-base-anonymizer/t3-owner-review-passport-registration.node.mjs');
test('original T2 Host build catalog can register review passport without replacing other services',()=>{
  const original={domain:{runtime:{kernel_release:'0.3.6'},security:{
    allowed_object_classes:['iwxa.demo.note'],
  },modules:[{service_id:'iwxa.workspace.integration',base_path:'/workspace/'}]},
    controlPlane:{schema_version:'0.3.1',services:[{
      schema_version:'0.3.1',service_id:'iwxa.workspace.integration',
      capability_control:'NONE',capability_ceiling:[],activation_any_of:[],
      operation_guards:[],
    }]},
    catalog:{contract_version:'1.3.0',count:1,entries:[{
    service_id:'iwxa.workspace.integration',service_version:'1.0.0',
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    file:'_iwxa/services/iwxa.workspace.integration.json',sha256:'a'.repeat(64),
  }]}};
  const before=structuredClone(original);
  const ready=planOriginalT2ActivityReviewRegistration(original);
  assert.equal(ready.catalog.count,2);
  assert.equal(ready.domain.modules.length,2);
  assert.equal(ready.domain.modules[1].service_id,'iwxa.activity.reviewer');
  assert.equal(ready.controlPlane.services.length,2);
  assert.deepEqual(ready.controlPlane.services[0],original.controlPlane.services[0]);
  assert.equal(ready.controlPlane.services[1].service_id,'iwxa.activity.reviewer');
  assert.equal(ready.controlPlane.services[1].capability_control,'NONE');
  assert.deepEqual(ready.catalog.entries[0],original.catalog.entries[0]);
  assert.equal(ready.catalog.entries[1].service_id,'iwxa.activity.reviewer');
  assert.equal(ready.catalog.entries[1].file,ready.passport_file);
  assert.equal(ready.catalog.entries[1].sha256,
    createHash('sha256').update(Buffer.from(ready.passport_bytes)).digest('hex'));
  assert.deepEqual(ready.domain.security.allowed_object_classes,[
    'iwxa.demo.note',T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
  ]);
  const passport=JSON.parse(ready.passport_bytes);
  assert.equal(
    Object.hasOwn(passport.schemas[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],'schema_id'),
    false,'original T2 declaration is strict and keyed externally');
  assert.equal(passport.permissions.packages.export,false);
  assert.equal(passport.permissions.packages.import,false);
  assert.deepEqual(passport.permissions.objects.write,[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]);
  assert.deepEqual(original,before,'original T2 runtime config cannot be mutated');
  const again=planOriginalT2ActivityReviewRegistration({
    domain:ready.domain,catalog:ready.catalog,controlPlane:ready.controlPlane,
  });
  assert.deepEqual(again,ready,'the existing T2 registration must be idempotent');
});
test('original service catalog rejects collisions, duplicates and inconsistent counts',()=>{
  const base={domain:{security:{allowed_object_classes:[]},modules:[]},
    controlPlane:{schema_version:'0.3.1',services:[]},
    catalog:{count:0,entries:[]}};
  const first=planOriginalT2ActivityReviewRegistration(base);
  const wrong=structuredClone(first.catalog);
  wrong.entries[0].sha256='0'.repeat(64);
  assert.throws(()=>planOriginalT2ActivityReviewRegistration({
    domain:first.domain,catalog:wrong,controlPlane:first.controlPlane,
  }),{code:'T3_ACTIVITY_SERVICE_PASSPORT_COLLISION'});
  const duplicate=structuredClone(first.catalog);
  duplicate.entries.push({...duplicate.entries[0]});duplicate.count=2;
  assert.throws(()=>planOriginalT2ActivityReviewRegistration({
    domain:first.domain,catalog:duplicate,controlPlane:first.controlPlane,
  }),{code:'T3_ACTIVITY_ORIGINAL_T2_CATALOG_DUPLICATE'});
  assert.throws(()=>planOriginalT2ActivityReviewRegistration({
    domain:base.domain,catalog:{count:2,entries:[]},
    controlPlane:base.controlPlane,
  }),{code:'T3_ACTIVITY_ORIGINAL_T2_CATALOG_REQUIRED'});
});

test('optional derived grant rejection never blocks independently signed source reading',async()=>{
  const f=fixture(),c=originalSignedControlFixture(f);
  f.options.targetSignedAccess.actionFor=()=>{throw Error('PRIVATE_DERIVE_DENIAL');};
  const bridge=await openOriginalT3ActivityReviewHost({
    control:c.control,context:f.options.sourceContext,
    originalKernel:f.options.sourceContext.kernel,bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  const ui=createT3ReviewController({host:bridge.port,onUpdate:()=>{}});
  try{
    assert.deepEqual(Object.keys(bridge.port).sort(),
      ['readSelected','subscribeInvalidation']);
    assert.equal((await ui.readSelected()).status,'REVIEW');
    assert.equal((await ui.stageSelected()).status,'UNAVAILABLE');
    assert.equal(f.state.writeCalls,0);
  }finally{ui.dispose();bridge.dispose();c.close();}
});

test('real T2 Host requires service route and control-plane entry along with passport',()=>{
  const empty={domain:{security:{allowed_object_classes:[]},modules:[]},
    catalog:{count:0,entries:[]},
    controlPlane:{schema_version:'0.3.1',services:[]}};
  const ready=planOriginalT2ActivityReviewRegistration(empty);
  assert.deepEqual(ready.domain.modules,[{
    service_id:'iwxa.activity.reviewer',base_path:'/workspace/activity/',
  }]);
  assert.deepEqual(ready.controlPlane.services,[{
    schema_version:'0.3.1',service_id:'iwxa.activity.reviewer',
    capability_control:'NONE',capability_ceiling:[],
    activation_any_of:[],operation_guards:[],
  }]);
  const evil=structuredClone(ready.controlPlane);
  evil.services[0].capability_ceiling=['*'];
  assert.throws(()=>planOriginalT2ActivityReviewRegistration({
    domain:ready.domain,catalog:ready.catalog,controlPlane:evil,
  }),{code:'T3_ACTIVITY_SERVICE_PASSPORT_COLLISION'});
  const missing=structuredClone(empty);
  delete missing.controlPlane;
  assert.throws(()=>planOriginalT2ActivityReviewRegistration(missing),{
    code:'T3_ACTIVITY_ORIGINAL_T2_CATALOG_REQUIRED',
  });
});

const {useOriginalT2ActivityKernelFacade,openActivityFromOriginalT2Host}=
  await import('../modules/activity-base-anonymizer/t3-original-t2-owner-host.mjs');
test('real T2 1.3.0 service is adapted to existing T3 binding without a second Kernel',async()=>{
  const f=fixture(),raw=f.options.sourceContext.kernel;
  const t1={getWorkspace:ws=>raw.getWorkspace(ws),
    listObjects:args=>raw.listObjects(args),
    getObject:(ws,id)=>raw.getObject(ws,id),
    listEventsSince:ws=>raw.listEventsSince(ws),
    putObject:input=>raw.putObject(input)};
  const ops=['t1.getWorkspace','t1.listObjects','t1.getObject',
    't1.listEventsSince','t1.putObject'];
  const session={contract_version:'1.3.0',runtime_version:'0.3.6',
    mode:'full',service:{service_id:'iwxa.workspace.integration'},
    granted_operations:ops,t1};
  const kernel=useOriginalT2ActivityKernelFacade(session);
  assert.deepEqual(Object.keys(kernel).sort(),
    ['getObject','getWorkspace','hasOperation','listEventsSince','listObjects','putObject','sessionInfo']);
  assert.equal(kernel.hasOperation('t1.putObject'),true);
  assert.equal(kernel.hasOperation('t2.exportPackage'),false);
  assert.equal((await kernel.getWorkspace(W)).workspace_id,W);
  assert.equal((await kernel.listObjects({workspace_id:W})).length,3);
  const control={
    requireSignedOwner:true,
    signedActivityAccess:async op=>op==='activity.read'
      ?f.options.sourceSignedAccess:f.options.targetSignedAccess,
    subscribeSignedAccessInvalidation:fn=>()=>{},
  };
  const view=await openActivityFromOriginalT2Host({
    session,control,currentWorkspace:f.options.sourceContext.currentWorkspace,
    bindings:f.options.bindings,
    readActivityFromWorkspaceContext:core.readActivityFromWorkspaceContext,
    createSubjectKernelBinding:core.createSubjectKernelBinding,
  });
  const ui=createT3ReviewController({host:view.port,onUpdate:()=>{}});
  try{
    assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
    assert.deepEqual(await ui.stageSelected(),{status:'STAGED'});
    assert.equal(f.state.writeCalls,1);
    assert.equal(f.saved.size,1);
  }finally{ui.dispose();view.dispose();}
});
test('original T2 adapter refuses old runtime and incomplete service rather than adding methods',()=>{
  const bare={contract_version:'1.3.0',runtime_version:'0.3.6',
    service:{service_id:'iwxa.workspace.integration'},
    granted_operations:['t1.getWorkspace'],t1:{getWorkspace(){}}};
  assert.throws(()=>useOriginalT2ActivityKernelFacade(bare),
    {code:'T3_ACTIVITY_ORIGINAL_T2_SERVICE_REQUIRED'});
  assert.throws(()=>useOriginalT2ActivityKernelFacade({
    ...bare,runtime_version:'0.3.5',
  }),{code:'T3_ACTIVITY_ORIGINAL_T2_SERVICE_REQUIRED'});
});
