import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalHostDispatchTaskBinding}
  from '../src/network/original-host-dispatch-task-binding.mjs';

const ws='original:workspace',owner='original:t3:owner',target='node:owner',
  session='original:host:session:1';
const err=code=>e=>e?.code===code;
function fixture(){
  let mode='T4_NETWORK',scope={workspaceId:ws,originalWriteOwnerRef:owner,
    networkTargetRef:target,hostSessionRef:session},rights=true,
    dispatchCount=0,readCount=0;
  const result={
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
    networkTargetRef:target,workspaceId:ws,originalWriteOwnerRef:owner,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    originalRecipientApplied:false,newlyVerifiedCount:1,
  };
  let dispatch=async()=>result;
  const ports={
    expectedWorkspaceId:ws,expectedOriginalWriteOwnerRef:owner,
    expectedNetworkTargetRef:target,
    getMode:()=>mode,
    readOriginalHostContext:async()=>{readCount++;return {...scope};},
    authorizeOriginalHostTask:async proof=>{
      assert.equal(proof.operation,'t4.network.publish');
      assert.equal(proof.networkTargetRef,target);
      return rights;
    },
    dispatcher:{drain:async value=>{dispatchCount++;return dispatch(value);}},
  };
  return{ports,scope:()=>scope,
    setMode:v=>{mode=v;},setRights:v=>{rights=v;},
    setScope:v=>{scope={...scope,...v};},
    setDispatch:v=>{dispatch=v;},
    counts:()=>({dispatch:dispatchCount,read:readCount})};
}
test('original Host task tick delivers through existing dispatcher without a scheduler',async()=>{
  const f=fixture();
  const binding=createT4OriginalHostDispatchTaskBinding(f.ports);
  assert.equal(binding.createsScheduler,false);
  assert.equal(binding.createsTaskEngine,false);
  const result=await binding.run({maxEntries:2});
  assert.equal(result.dispatched,true);
  assert.equal(result.mode,'T4_NETWORK');
  assert.equal(result.originalRecipientApplied,false);
  assert.equal(result.originalHostTaskOwnerVerified,true);
  assert.equal(f.counts().dispatch,1);
});
test('T4 disabled preserves LOCAL_T3 without original outbox or authority reads',async()=>{
  const f=fixture();f.setMode('LOCAL_T3');
  const tick=await createT4OriginalHostDispatchTaskBinding(f.ports).run();
  assert.equal(tick.mode,'LOCAL_T3');
  assert.equal(tick.originalOutboxRead,false);
  assert.deepEqual(f.counts(),{dispatch:0,read:0});
});
test('changed original Host session prevents task dispatch',async()=>{
  const f=fixture();f.setScope({hostSessionRef:'other:session'});
  const binding=createT4OriginalHostDispatchTaskBinding({
    ...f.ports,readOriginalHostContext:async()=>({
      ...f.scope(),workspaceId:'other:workspace',
    }),
  });
  await assert.rejects(binding.run(),err('HOST_TASK_ORIGINAL_CONTEXT_CHANGED'));
  assert.equal(f.counts().dispatch,0);
});
test('revoked Host authorization blocks network task before dispatcher',async()=>{
  const f=fixture();f.setRights(false);
  await assert.rejects(createT4OriginalHostDispatchTaskBinding(f.ports).run(),
    err('HOST_TASK_ORIGINAL_AUTHORITY_DENIED'));
  assert.equal(f.counts().dispatch,0);
});
test('host session switches while network is in flight: never claim successful tick',async()=>{
  const f=fixture();
  f.setDispatch(async()=>{
    f.setScope({hostSessionRef:'original:host:session:2'});
    return{schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
      networkTargetRef:target,workspaceId:ws,originalWriteOwnerRef:owner,
      originalRecipientApplied:false,sourceCursorAdvanced:false,
      recipientCursorAdvanced:false};
  });
  await assert.rejects(createT4OriginalHostDispatchTaskBinding(f.ports).run(),
    e=>e.code==='HOST_TASK_CONTEXT_CHANGED_OUTCOME_UNKNOWN'&&
      e.details.automaticRetryAllowed===false);
  assert.equal(f.counts().dispatch,1);
});
test('two simultaneous ticks from one original Host share one in-flight dispatch',async()=>{
  const f=fixture();let release;
  f.setDispatch(()=>new Promise(resolve=>{release=resolve;}));
  const task=createT4OriginalHostDispatchTaskBinding(f.ports);
  const first=task.run(),second=task.run();
  for(let attempt=0;attempt<10&&!release;attempt++)await Promise.resolve();
  assert.equal(typeof release,'function');
  release({schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
    networkTargetRef:target,workspaceId:ws,originalWriteOwnerRef:owner,
    originalRecipientApplied:false,sourceCursorAdvanced:false,
    recipientCursorAdvanced:false});
  const [a,b]=await Promise.all([first,second]);
  assert.deepEqual(a,b);
  assert.equal(f.counts().dispatch,1);
});
test('disposed original Host rejects later scheduled tasks',async()=>{
  const f=fixture();
  const binding=createT4OriginalHostDispatchTaskBinding(f.ports);
  binding.dispose();
  await assert.rejects(binding.run(),err('HOST_TASK_ORIGINAL_HOST_DISPOSED'));
  assert.equal(f.counts().dispatch,0);
});
test('task callback refuses invented recipient acknowledgement and cursors',async()=>{
  const f=fixture();
  f.setDispatch(async()=>({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
    networkTargetRef:target,workspaceId:ws,originalWriteOwnerRef:owner,
    originalRecipientApplied:true,sourceCursorAdvanced:true,
    recipientCursorAdvanced:true,
  }));
  await assert.rejects(createT4OriginalHostDispatchTaskBinding(f.ports).run(),
    err('HOST_TASK_DISPATCH_RESULT_INVALID'));
});
