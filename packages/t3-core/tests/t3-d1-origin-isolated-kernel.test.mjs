import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createIsolatedKernelClient,bindSignedOriginalKernelPort,
  acceptOriginalKernelRealmChannel,openOriginalKernelRealm,
  ALLOWED_ISOLATED_KERNEL_METHODS} from '../src/t3/origin-isolated-kernel-transport.mjs';
const id='workspace:north';
const denied=code=>Object.assign(new Error(code),{code});

test('signed facade is the only writer and foreign organizational reads fail closed',async()=>{
  const ch=new MessageChannel();let signedCalls=0,reads=0,writes=0;
  const facade=Object.freeze({
    async getWorkspace(ws){reads++;if(ws!==id)throw denied('T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE');return {workspace_id:id};},
    async putObject(cmd){writes++;if(cmd.workspace_id!==id)throw denied('T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE');return {object:{...cmd}};},
  });
  const receiver=bindSignedOriginalKernelPort({port:ch.port1,
    isActive:()=>true,createSignedFacade:async()=>{signedCalls++;return facade;}});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    assert.deepEqual(await client.invoke('getWorkspace',id),{workspace_id:id});
    await assert.rejects(client.invoke('getWorkspace','workspace:south'),{code:'T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE'});
    assert.deepEqual(await client.invoke('putObject',{workspace_id:id,object_id:'item:1'}),
      {object:{workspace_id:id,object_id:'item:1'}});
    await assert.rejects(client.invoke('putObject',{workspace_id:'workspace:south'}),
      {code:'T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE'});
    assert.equal(reads,2);assert.equal(writes,2);assert.equal(signedCalls,4);
    assert.equal(Object.hasOwn(client,'session'),false);
    assert.equal(Object.hasOwn(client,'connect'),false);
    assert.equal(ALLOWED_ISOLATED_KERNEL_METHODS.includes('constructor'),false);
  }finally{client.close();receiver.close();}
});

test('unknown and inherited method names never resolve a signed facade',async()=>{
  const ch=new MessageChannel();let called=0;
  const receiver=bindSignedOriginalKernelPort({port:ch.port1,
    isActive:()=>true,createSignedFacade:async()=>{called++;return Object.freeze({});}});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    for(const name of ['constructor','__proto__','setPrototypeOf','connect','toString'])
      await assert.rejects(client.invoke(name),{code:'T3_D1_ORIGINAL_KERNEL_METHOD_FORBIDDEN'});
    await assert.rejects(client.invoke('getWorkspace',id),{code:'T3_D1_SIGNED_KERNEL_FACADE_REQUIRED'});
    assert.equal(called,1);
  }finally{client.close();receiver.close();}
});

test('context epoch change while signed owner resolves prevents Kernel dispatch',async()=>{
  const ch=new MessageChannel();let started,release,writes=0;
  const entered=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const facade=Object.freeze({putObject:async()=>{writes++;return {status:'wrong'};}});
  const receiver=bindSignedOriginalKernelPort({port:ch.port1,
    isActive:()=>true,createSignedFacade:async()=>{started();await gate;return facade;}});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    const pending=client.invoke('putObject',{workspace_id:id});
    await entered;receiver.invalidate();release();
    await assert.rejects(pending,{code:'T3_D1_ISOLATED_KERNEL_DISCONNECTED'});
    await assert.rejects(client.invoke('putObject',{workspace_id:id}),
      {code:'T3_D1_ISOLATED_KERNEL_DISCONNECTED'});
    assert.equal(writes,0);
  }finally{client.close();receiver.close();}
});

test('closed original Control or client never reopens through a live port',async()=>{
  const ch=new MessageChannel();let alive=false,writes=0;
  const facade=Object.freeze({putObject:async()=>{writes++;return {status:'wrong'};}});
  const receiver=bindSignedOriginalKernelPort({port:ch.port1,
    isActive:()=>alive,createSignedFacade:async()=>facade});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    await assert.rejects(client.invoke('putObject',{workspace_id:id}),
      {code:'T3_D1_ORIGINAL_KERNEL_OWNER_UNAVAILABLE'});
    assert.equal(writes,0);
    alive=true;client.close();
    await assert.rejects(client.invoke('putObject',{workspace_id:id}),
      {code:'T3_D1_ISOLATED_KERNEL_DISCONNECTED'});
    assert.equal(writes,0);
  }finally{client.close();receiver.close();}
});

test('browser handshake rejects false origin/source and accepts exact isolated realm',async()=>{
  const parent={};const uiOrigin='http://127.0.0.1:45002';
  const kernelOrigin='http://127.0.0.1:45001';let accepted=0;
  let receiver=null;
  const channelFactory=()=>new MessageChannel();
  const nonceFactory=()=>('f'.repeat(32));
  const frame={postMessage(data,dest,ports){
    assert.equal(dest,kernelOrigin);
    const kwargs={uiOrigin,parentWindow:parent,isActive:()=>true,
      createSignedFacade:async()=>Object.freeze({getWorkspace:async ws=>({workspace_id:ws})})};
    const bad=acceptOriginalKernelRealmChannel({event:{data,origin:kernelOrigin,
      source:parent,ports},...kwargs});
    assert.equal(bad,null);
    const badSource=acceptOriginalKernelRealmChannel({event:{data,origin:uiOrigin,
      source:{},ports},...kwargs});
    assert.equal(badSource,null);
    receiver=acceptOriginalKernelRealmChannel({event:{data,origin:uiOrigin,
      source:parent,ports},...kwargs});
    assert.ok(receiver);accepted++;
  }};
  const client=await openOriginalKernelRealm({frame,realmOrigin:kernelOrigin,
    channelFactory,nonceFactory});
  try{
    assert.equal(accepted,1);
    assert.deepEqual(await client.invoke('getWorkspace',id),{workspace_id:id});
  }finally{client.close();receiver.close();}
});

test('trusted isolated realm accepts an exact PERSONAL selection and rejects a disguised corporate identity',async()=>{
  for(const extraOrg of [null,"org:intruder"]){
    const ch=new MessageChannel();
    const receiver=bindSignedOriginalKernelPort({port:ch.port1,
      isActive:()=>true,
      createSignedFacade:()=>Object.freeze({}),
      selectedWorkspaceContext:async()=>({
        kind:"PERSONAL",organization_id:extraOrg,
        workspace_id:id,resource:id
      })
    });
    const client=createIsolatedKernelClient({port:ch.port2});
    try{
      if(extraOrg===null){
        assert.deepEqual(await client.invoke("selectedWorkspaceContext","createWorkspace"),{
          kind:"PERSONAL",organization_id:null,workspace_id:id,resource:id
        });
      }else{
        await assert.rejects(client.invoke("selectedWorkspaceContext","createWorkspace"),
          {code:"T3_D1_SELECTED_CONTEXT_INVALID"});
      }
    }finally{client.close();receiver.close();}
  }
});


test('D3 uses the original native recipient, not the raw signed Kernel facade',async()=>{
  const ch=new MessageChannel();let nativeCalls=0,signedKernelCalls=0;
  const receiver=bindSignedOriginalKernelPort({
    port:ch.port1,isActive:()=>true,
    createSignedFacade:async()=>{signedKernelCalls++;return Object.freeze({});},
    reconciliationRequest:async(verb,payload)=>{
      nativeCalls++;
      assert.equal(verb,'preview');
      assert.deepEqual(payload,{packageSha256:'a'.repeat(64)});
      return {schema:'IWXA_T3_RECONCILIATION_PREVIEW/1'};
    },
  });
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    assert.deepEqual(await client.invoke('reconciliationRequest','preview',
      {packageSha256:'a'.repeat(64)}),
      {schema:'IWXA_T3_RECONCILIATION_PREVIEW/1'});
    assert.equal(nativeCalls,1);
    assert.equal(signedKernelCalls,0);
    receiver.invalidate();
    await assert.rejects(client.invoke('reconciliationRequest','preview',{}),
      {code:'T3_D1_ISOLATED_KERNEL_DISCONNECTED'});
    assert.equal(nativeCalls,1);
  }finally{client.close();receiver.close();}
});


test('native D3 APPLY losing the isolated port is UNKNOWN and never replayed',async()=>{
  const ch=new MessageChannel();let started;let calls=0;
  const entered=new Promise(resolve=>{started=resolve;});
  const receiver=bindSignedOriginalKernelPort({
    port:ch.port1,isActive:()=>true,createSignedFacade:()=>Object.freeze({}),
    reconciliationRequest:async()=>{
      calls++;started();
      return new Promise(()=>{}); // Native review is still pending.
    },
  });
  const client=createIsolatedKernelClient({port:ch.port2,timeoutMs:200});
  try{
    const pending=client.invoke('reconciliationRequest','applyAccepted',{
      acceptanceId:'a'.repeat(64),revisionIds:['b'.repeat(64)],target:{},
    });
    await entered;
    client.close(); // A lost ACK cannot imply the original write was denied.
    await assert.rejects(pending,{code:'T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN'});
    assert.equal(calls,1);
  }finally{client.close();receiver.close();}
});
