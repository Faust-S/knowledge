import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {createOriginalKernelNativeRelay,isOriginalKernelNativeRelayForNetworkOwner} from '../../t3-core/src/t3/original-kernel-native-relay.mjs';
const WS='ws:subject',TECH='ws:technical',REG='ws:registry',OBJ='t3.access.signed-registry';
const base=['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.commitObjectGraph'];
const methods=['getObject','listEventsSince','putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph'];
const operations=methods.map(name=>'t1.'+name);
const info=grants=>({contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'iwxa.workspace.relay',mode:'ready',granted_operations:grants});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const resultFor=(method,args)=>method==='getObject'?{object:{workspace_id:args[0],object_id:args[1]},relations:{incoming:[],outgoing:[]}}:
  method==='listEventsSince'?[]:method==='getWorkspace'?{workspace_id:args[0]}:{object:{workspace_id:args[0].workspace_id,object_id:args[0].object.object_id,revision:1},event:{workspace_id:args[0].workspace_id,event_id:'event:1'},workspace_id:args[0].workspace_id,relations_put:[]};
const graph=()=>({workspace_id:REG,idempotency_key:'a'.repeat(64),object:{object_id:OBJ,schema_id:'iwxa.t3.access.signed-registry',schema_version:'1.0.0',base_revision:0,data:{},extensions:{}},event:{event_type:'t3.access.signed_registry.persisted',payload:{object_id:OBJ}}});
const context={kind:'PERSONAL',context_id:'context:local',actor_id:'person:local',principal_id:'person:local',role_id:'role:local',grant_id:'grant:read',realm_id:'realm:local',audience:'host:local',resource:WS,purpose:'workspace.work',workspace_id:WS,organization_id:null,scope_revision:1};
// This fixture models the Access decision and original T2 receipts ONLY.
// Both the production Relay and SubjectKernelBinding are used unchanged
// apart from the candidate relay changes; no original Kernel execution is claimed.
function fixture({role='SOURCE',installed=false,registryExchangeOperations=[],grants=[...new Set([...base,...operations])],profilePatch={},ownerPatch={},createHook=null,bindHook=null,attachHook=null,nativeAttach=null,wake=null,history=null,local=null}={}){
  const installedScope={schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1',role,sourceWorkspaceId:WS,technicalWorkspaceId:TECH,registryWorkspaceId:REG};
  let epoch=1,registry=null,kernel=null,profile=null,revoked=false,lateRead=null;
  const counts={create:0,attach:0,detach:0,close:0,bind:0,stop:0,proofs:0},calls=[];
  const access={currentContext:()=>context,actionFor:op=>op,operationDigest:digest,
    async authorize(request){
      counts.proofs++;
      await registry.getObject(REG,OBJ);await registry.listEventsSince(REG);
      const now=Date.now();
      return {schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed:!revoked,outcome:revoked?'DENIED':'PERMITTED',evidenceOnly:true,
        requestDigest:digest(request),policyDigest:'a'.repeat(64),authorityPath:[{grantId:context.grant_id}],statusSequence:1,
        validUntil:new Date(now+60000).toISOString(),evaluatedAt:new Date(now).toISOString(),statusObservedAt:new Date(now-1).toISOString()};
    },verifyDecisionBinding:(request,decision)=>decision.requestDigest===digest(request)};
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>epoch,onAttach:nativeAttach??(()=>true),timeoutMs:2000,
    originalRegistryScope:{workspaceId:REG,objectId:OBJ},networkActivation:{role,sourceWorkspaceId:WS,technicalWorkspaceId:TECH,
      ...(installed?{installedScope}:{}),
      async createProfile(p){
        counts.create++;registry=p.registryKernel;
        assert.equal(registry,relay.nativeRegistryKernel);assert.equal(registry.hasOperation('t1.getObject'),true);
        assert.equal(registry.hasOperation('t1.putObject'),false);
        if(createHook)await createHook(p);else await registry.getObject(REG,OBJ);
        const networkOwner={role,identity:{sourceWorkspaceId:WS,technicalWorkspaceId:TECH},operations,
          async onAttach(p){counts.attach++;kernel=p.kernel;assert.equal(p.isHostActive(),false);assert.equal(kernel.hasOperation('t1.getObject'),true);
            if(attachHook)return attachHook(registry,p);await registry.listEventsSince(REG);return true;},
          onDetach(){counts.detach++;},async resolveOriginalAccess(p){
            if((p.method==='commitObjectGraph'?p.args[0]?.workspace_id:p.args[0])!==WS)return null;
            await registry.getObject(REG,OBJ);return access;},
          originalSignedReplacementHistoryBound:true,async readOriginalReplacementOwnerHistory(input){
            if(history)return history({input,registry,kernel});await registry.getObject(REG,OBJ);return {ok:true};},
          ...(wake?{onIdleWake:p=>wake({registry,kernel,p})}:{}),
          ...(role==='SOURCE'?{localSourceMutation:{workspaceId:WS,methods:methods.filter(x=>!['getObject','listEventsSince'].includes(x)),
            async invoke(p){if(local)return local({registry,kernel,p});await registry.getObject(REG,OBJ);return {state:'LOCAL_T3_BYPASS'};}}}:{}),...ownerPatch};
        profile={schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_PROFILE_V1',role,networkOwner,
          close(){counts.close++;},bindOriginalPeerHistoryReceiver(r){assert.equal(r,relay);assert.equal(isOriginalKernelNativeRelayForNetworkOwner(r,networkOwner),true);return {read:r.readOriginalReplacementOwnerHistory};},...profilePatch};
        return profile;
      },async bindPeerHistoryReceiver(receiver){counts.bind++;assert.equal(typeof receiver.read,'function');if(bindHook)return bindHook(receiver);return ()=>{counts.stop++;};}
    }});
  const attach=(version=1)=>relay.exchange({verb:'attach',payload:{sessionInfo:info(grants),networkRelayVersion:1,
    networkActivationVersion:version,...(installed?{installedNetworkScope:installedScope,registryExchangeOperations}:{}),...(role==='SOURCE'?{localSourceMutationVersion:1,localSourceGraphVersion:1}:{})}},epoch);
  const ex=(s,verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},s.contextEpoch);
  const next=s=>ex(s,'next');
  async function command(s,method,args,result){
    const c=await next(s);assert.equal(c.kind,'COMMAND');assert.equal(c.method,method);assert.deepEqual(c.args,args);
    calls.push([c.method,...c.args]);await ex(s,'result',{id:c.id,ok:true,result:result===undefined?resultFor(method,args):result});return c;
  }
  async function activate(s){
    assert.equal(s.networkActivationPending,1);assert.equal(s.networkMethods,undefined);assert.equal(relay.networkAttached,false);
    await command(s,'getObject',[REG,OBJ]);assert.equal(relay.networkAttached,false);
    await command(s,'listEventsSince',[REG]);const r=await next(s);
    assert.equal(r.kind,'NETWORK_ACTIVATION');assert.equal(r.activation.state,'READY');assert.equal(relay.networkAttached,true);return r.activation;
  }
  return {relay,attach,ex,next,command,activate,counts,calls,get registry(){return registry;},get kernel(){return kernel;},get profile(){return profile;},
    revoke(){revoked=true;},invalidate(){epoch++;relay.invalidate();},setLateRead(fn){lateRead=fn;},get lateRead(){return lateRead;}};
}
test('deferred native activation reads the existing Registry only after attach, and announces admission once',async()=>{
  const f=fixture();try{const s=await f.attach();assert.equal(f.counts.create,0);assert.equal(f.relay.attached,true);
    assert.equal(f.relay.networkAttached,false);assert.equal(s.networkActivationPending,1);assert.equal(s.localSourceMutationVersion,undefined);
    await assert.rejects(f.ex(s,'sourceMutation',{method:'putObject',args:[{workspace_id:WS}]}),{code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_NOT_AVAILABLE'});
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph({workspace_id:WS}),{code:'T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED'});
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph({workspace_id:TECH}),{code:'T3_ORIGINAL_NETWORK_OWNER_WRITE_REQUIRED'});
    await assert.rejects(f.relay.nativeRegistryKernel.getObject(REG,OBJ),{code:'T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED'});
    const a=await f.activate(s);assert.equal(a.localSourceMutationVersion,1);assert.equal(a.localSourceGraphVersion,1);assert.equal(a.localSourceWorkspaceId,WS);
    assert.equal(f.counts.create,1);assert.equal(f.counts.attach,1);assert.equal(f.counts.bind,1);
    const p=f.kernel.getObject(WS,'item:1');await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);
    await f.command(s,'getObject',[WS,'item:1']);assert.deepEqual(await p,resultFor('getObject',[WS,'item:1']));assert.equal(f.counts.proofs,1);
    f.revoke();const denied=f.kernel.getObject(WS,'item:2');denied.catch(()=>{});await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);
    await assert.rejects(denied,{code:'T3_ACCESS_NOT_PERMITTED'});assert.equal(f.calls.some(x=>x[2]==='item:2'),false);
  }finally{f.relay.close();}assert.equal(f.counts.close,1);assert.equal(f.counts.stop,1);assert.equal(f.counts.detach,1);assert.equal(isOriginalKernelNativeRelayForNetworkOwner(f.relay,f.profile.networkOwner),false);
});
test('unrelated registry reads and raw writes cannot enter an active subject reservation',async()=>{
  const f=fixture();try{const s=await f.attach();await f.activate(s);const p=f.kernel.getObject(WS,'item:1');p.catch(()=>{});
    const c=await f.next(s);assert.equal(c.method,'getObject');assert.deepEqual(c.args,[REG,OBJ]);
    await assert.rejects(f.registry.getObject(REG,OBJ),{code:'T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED'});
    await assert.rejects(f.registry.getObject(WS,'item:1'),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    assert.throws(()=>f.relay.nativeKernel.getObject(REG,OBJ),{code:'T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS'});
    await assert.rejects(f.kernel.getObject(WS,'other'),{code:'T3_D3_ORIGINAL_KERNEL_OPERATION_IN_PROGRESS'});
    await f.ex(s,'result',{id:c.id,ok:true,result:resultFor(c.method,c.args)});
    await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);await f.command(s,'getObject',[WS,'item:1']);await p;
  }finally{f.relay.close();}
});
test('history reads share the same reserved command slot and cannot mutate Registry',async()=>{
  const f=fixture({history:async({registry,kernel})=>{
    await assert.rejects(registry.commitObjectGraph(graph()),{code:'T3_ORIGINAL_REGISTRY_RELAY_NESTED_WRITE_DENIED'});
    await registry.getObject(REG,OBJ);return kernel.getObject(WS,'item:history');}});
  try{const s=await f.attach();await f.activate(s);const p=f.relay.readOriginalReplacementOwnerHistory({request:'history'});p.catch(()=>{});
    await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);
    await f.command(s,'getObject',[WS,'item:history']);assert.deepEqual(await p,resultFor('getObject',[WS,'item:history']));
  }finally{f.relay.close();}
});
test('source mutation uses the reserved original task, not a new Registry write authority',async()=>{
  const f=fixture();try{const s=await f.attach();await f.activate(s);
    const p=f.ex(s,'sourceMutation',{method:'putObject',args:[{workspace_id:WS,object_id:'item:local'}]});p.catch(()=>{});
    await f.command(s,'getObject',[REG,OBJ]);assert.deepEqual(await p,{state:'LOCAL_T3_BYPASS'});
  }finally{f.relay.close();}
});
test('wake can use original registry reads without releasing the subject reservation',async()=>{
  let once=false,completed;const done=new Promise(resolve=>{completed=resolve;});
  const f=fixture({wake:async({registry,kernel})=>{if(once)return;once=true;await registry.getObject(REG,OBJ);const row=await kernel.getObject(WS,'item:wake');completed(row);}});
  try{const s=await f.attach();await f.activate(s);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);await f.command(s,'getObject',[WS,'item:wake']);assert.deepEqual(await done,resultFor('getObject',[WS,'item:wake']));}
  finally{f.relay.close();}
});
test('old realm cannot trigger deferred factory without explicit negotiation',async()=>{
  const f=fixture();try{const s=await f.attach(0);assert.equal(s.networkActivationPending,undefined);assert.equal(f.counts.create,0);assert.equal(f.relay.networkAttached,false);
    const p=f.relay.nativeKernel.getWorkspace('ws:local');await f.command(s,'getWorkspace',['ws:local']);assert.deepEqual(await p,{workspace_id:'ws:local'});
  }finally{f.relay.close();}
});
test('insufficient original Kernel grants deny the candidate without creating an admitted T4 owner',async()=>{
  const f=fixture({grants:base});try{const s=await f.attach();await f.command(s,'getObject',[REG,OBJ]);const r=await f.next(s);
    assert.equal(r.kind,'NETWORK_ACTIVATION');assert.equal(r.activation.state,'DENIED');assert.equal(r.activation.networkMethods,undefined);assert.equal(f.relay.networkAttached,false);assert.equal(f.relay.attached,true);assert.equal(f.counts.attach,0);assert.equal(f.counts.close,1);
    const p=f.relay.nativeKernel.getWorkspace('ws:local');await f.command(s,'getWorkspace',['ws:local']);await p;
  }finally{f.relay.close();}
});
test('wrong profile scope or failed peer binding is terminal and closes the candidate',async()=>{
  for(const opts of [{ownerPatch:{identity:{sourceWorkspaceId:'ws:foreign',technicalWorkspaceId:TECH}}},{bindHook:()=>null}]){
    const f=fixture(opts);try{const s=await f.attach();await f.command(s,'getObject',[REG,OBJ]);if(opts.bindHook)await f.command(s,'listEventsSince',[REG]);const r=await f.next(s);
      assert.equal(r.activation.state,'DENIED');assert.equal(f.relay.networkAttached,false);assert.equal(f.counts.close,1);assert.equal(isOriginalKernelNativeRelayForNetworkOwner(f.relay,f.profile.networkOwner),false);
    }finally{f.relay.close();}
  }
});
test('recipient profile cannot bypass its single writer through the raw D3 graph route',async()=>{
  const f=fixture({role:'RECIPIENT'});try{const s=await f.attach();const a=await f.activate(s);assert.equal(a.localSourceMutationVersion,undefined);
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph({workspace_id:WS}),{code:'T3_ORIGINAL_NETWORK_OWNER_WRITE_REQUIRED'});
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph({workspace_id:TECH}),{code:'T3_ORIGINAL_NETWORK_OWNER_WRITE_REQUIRED'});
  }finally{f.relay.close();}
});
test('registry standalone provisioning is confined to exact graph without extra mutations',async()=>{
  const f=fixture();try{const s=await f.attach(0),reg=f.relay.nativeRegistryKernel;
    await assert.rejects(reg.commitObjectGraph({...graph(),relations_put:[]}),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    await assert.rejects(reg.commitObjectGraph({...graph(),object:{...graph().object,object_id:'item:other'}}),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph(graph()),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    const p=reg.commitObjectGraph(graph());await f.command(s,'commitObjectGraph',[graph()]);assert.equal((await p).object.object_id,OBJ);
    f.invalidate();await assert.rejects(reg.getObject(REG,OBJ),{code:'T3_ORIGINAL_REGISTRY_RELAY_NOT_CONNECTED'});
  }finally{f.relay.close();}
});
test('detaching during late profile creation disposes it and never activates the old session',async()=>{
  let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  const f=fixture({createHook:async()=>{entered();await gate;}});try{const s=await f.attach(),p=f.next(s);p.catch(()=>{});await started;
    f.invalidate();release();await assert.rejects(p,{code:'T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED'});await tick();
    assert.equal(f.counts.close,1);assert.equal(f.counts.attach,0);assert.equal(f.relay.attached,false);assert.equal(f.relay.nativeRegistryKernel,null);
  }finally{release();f.relay.close();}
});
test('invalidating the Host cancels an in-flight native connection startup before timeout',async()=>{
  let entered,signal;const started=new Promise(r=>{entered=r;});
  const f=fixture({createHook:p=>new Promise((resolve,reject)=>{
    signal=p.activationSignal;entered();
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
  })});
  try{const s=await f.attach(),p=f.next(s);p.catch(()=>{});await started;
    assert.equal(signal.aborted,false);f.invalidate();assert.equal(signal.aborted,true);
    await assert.rejects(p,{code:'T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED'});await tick();
    assert.equal(f.counts.attach,0);assert.equal(f.relay.attached,false);
    const next=await f.attach();assert.notEqual(next.sessionId,s.sessionId);
  }finally{f.relay.close();}
});
test('detached asynchronous native continuation cannot reuse a completed Registry lease',async()=>{
  let late,release;const gate=new Promise(r=>{release=r;});
  const f=fixture({history:async({registry})=>{late=gate.then(()=>registry.getObject(REG,OBJ));late.catch(()=>{});return {done:true};}});
  try{const s=await f.attach();await f.activate(s);assert.deepEqual(await f.relay.readOriginalReplacementOwnerHistory({}),{done:true});release();await assert.rejects(late,{code:'T3_ORIGINAL_REGISTRY_RELAY_LIFETIME_ENDED'});}
  finally{release();f.relay.close();}
});

import {readOriginalNativeRelayNegotiation as negotiate} from '../../t3-core/src/t3/original-kernel-native-relay-codec.mjs';
const session={sessionId:'a'.repeat(43),contextEpoch:1};
const ready={...session,networkRelayVersion:1,networkMethods:['getObject','listEventsSince']};
const parse=(reply,selected=null)=>negotiate({reply,grantedOperations:base,session:selected});
const activationReply=body=>({kind:'NETWORK_ACTIVATION',activation:{...session,networkActivationVersion:1,...body}});
test('trusted realm distinguishes legacy, pending, ready and denied native replies',()=>{
  assert.equal(parse(session).state,'LEGACY');
  assert.equal(parse({...session,networkActivationPending:1}).state,'PENDING');
  assert.deepEqual(parse(ready).networkMethods,ready.networkMethods);
  assert.equal(parse(activationReply({state:'DENIED'}),session).state,'DENIED');
  assert.equal(parse(activationReply({...ready,state:'READY'}),session).state,'READY');
});
test('trusted realm rejects premature methods, wrong session, unsupported capabilities and malformed activation',()=>{
  for(const reply of [{...ready,networkActivationPending:1},{...session,networkActivationPending:0},
    {...session,localSourceMutationVersion:1},{...ready,networkMethods:['getObject','getObject']},
    {...ready,networkMethods:['putAsset']},{...ready,networkMethods:['toString']}])
    assert.throws(()=>parse(reply),{code:'T3_ORIGINAL_NETWORK_RELAY_NEGOTIATION_INVALID'});
  for(const reply of [activationReply({state:'READY'}),activationReply({...ready,state:'DENIED'}),
    activationReply({...ready,state:'READY',contextEpoch:2}),activationReply({...ready,state:'READY',sessionId:'b'.repeat(43)}),
    activationReply({...ready,state:'READY',networkActivationVersion:2}),activationReply({state:'DENIED',localSourceMutationVersion:1})])
    assert.throws(()=>parse(reply,session),{code:'T3_ORIGINAL_NETWORK_RELAY_NEGOTIATION_INVALID'});
});

test('convergence preserves optional native workspace creation outside reserved network scopes',async()=>{
  const f=fixture({grants:[...new Set([...base,...operations,'t1.createWorkspace'])]});
  try{const s=await f.attach(0);
    assert.equal(f.relay.nativeKernel.hasOperation('t1.createWorkspace'),true);
    for(const id of [WS,TECH,REG])assert.throws(()=>f.relay.nativeKernel.createWorkspace({workspace_id:id,profile:'generic'}),{code:'T3_ORIGINAL_NETWORK_WORKSPACE_CREATION_DENIED'});
    const input={workspace_id:'ws:other',profile:'generic'},created=f.relay.nativeKernel.createWorkspace(input);
    await f.command(s,'createWorkspace',[input],input);assert.deepEqual(await created,input);
  }finally{f.relay.close();}
});
test('convergence permits only the pinned Registry workspace read in the original activation slot',async()=>{
  const f=fixture({createHook:async({registryKernel})=>{
    assert.equal(registryKernel.hasOperation('t1.getWorkspace'),true);
    assert.equal(registryKernel.hasOperation('t1.createWorkspace'),false);
    assert.equal(registryKernel.createWorkspace,undefined);
    await assert.rejects(registryKernel.getWorkspace(WS),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    const w=await registryKernel.getWorkspace(REG);assert.equal(w.workspace_id,REG);
    await registryKernel.getObject(REG,OBJ);
  }});
  try{const s=await f.attach();await f.command(s,'getWorkspace',[REG]);await f.activate(s);
    assert.equal(f.relay.networkAttached,true);
  }finally{f.relay.close();}
});


const nativeGraph=()=>({...graph(),workspace_id:WS,object:{...graph().object,object_id:'item:native',schema_id:'app.record',data:{title:'original'}},event:{event_type:'app.record.saved',payload:{object_id:'item:native'}}});
const captured=receipt=>({state:'ORIGINAL_SOURCE_MUTATION_CAPTURED',originalReceipt:receipt,captureRef:'t4:local:graph:fixture',originalT3OutboxVerified:true,networkPublished:false});
test('installed native SOURCE graph shares capture owner and exact original signed dispatch',async()=>{
  let f,invocations=0;const input=nativeGraph(),exact=structuredClone(input);
  f=fixture({installed:true,local:async({kernel,p})=>{
    invocations++;assert.equal(p.method,'commitObjectGraph');assert.deepEqual(p.args,[exact]);
    assert.throws(()=>f.relay.nativeKernel.commitObjectGraph(exact),{code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY'});
    return captured(await kernel.commitObjectGraph(p.args[0]));
  }});
  try{const s=await f.attach();await f.activate(s);
    const result=f.relay.nativeKernel.commitObjectGraph(input);result.catch(()=>{});input.object.data.title='changed';
    await assert.rejects(f.ex(s,'sourceMutation',{method:'commitObjectGraph',args:[exact]}),{code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_BUSY'});
    await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);
    const receipt=resultFor('commitObjectGraph',[exact]);await f.command(s,'commitObjectGraph',[exact],receipt);
    assert.deepEqual(await result,receipt);assert.equal(invocations,1);assert.equal(f.counts.proofs,1);
    assert.equal(f.calls.filter(x=>x[0]==='commitObjectGraph').length,1);
  }finally{f.relay.close();}
});
test('installed native SOURCE graph cannot fall back to raw write after capture mode change, malformed receipt or signed denial',async()=>{
  for(const outcome of [{state:'LOCAL_T3_BYPASS'}, {state:'ORIGINAL_SOURCE_MUTATION_CAPTURED',originalReceipt:{}},null]){
    let attempts=0;
    const f=fixture({installed:true,local:async({kernel,p})=>{attempts++;return outcome??captured(await kernel.commitObjectGraph(p.args[0]));}});
    try{const s=await f.attach();await f.activate(s);f.revoke();
      const p=f.relay.nativeKernel.commitObjectGraph(nativeGraph());p.catch(()=>{});
      if(outcome===null){await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'getObject',[REG,OBJ]);await f.command(s,'listEventsSince',[REG]);}
      await assert.rejects(p,{code:outcome===null?'T3_ACCESS_NOT_PERMITTED':outcome.state==='LOCAL_T3_BYPASS'?'T3_LOCAL_SOURCE_CAPTURE_MODE_CHANGED':'T3_LOCAL_SOURCE_CAPTURE_RECEIPT_INVALID'});
      assert.equal(attempts,1);assert.equal(f.calls.some(x=>x[0]==='commitObjectGraph'),false);
    }finally{f.relay.close();}
  }
});
test('native graph capture is opt-in and remains unavailable to installed RECIPIENT or stale owner',async()=>{
  for(const opts of [{role:'RECIPIENT',installed:true},{role:'SOURCE',installed:false}]){
    const f=fixture(opts);try{const s=await f.attach();await f.activate(s);
      assert.throws(()=>f.relay.nativeKernel.commitObjectGraph(nativeGraph()),{code:opts.role==='RECIPIENT'?'T3_ORIGINAL_NETWORK_OWNER_WRITE_REQUIRED':'T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED'});
    }finally{f.relay.close();}
  }
  let entered,release;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  const f=fixture({installed:true,local:async()=>{entered();await gate;return captured({});}});
  try{const s=await f.attach();await f.activate(s);const native=f.relay.nativeKernel;
    const p=native.commitObjectGraph(nativeGraph());p.catch(()=>{});await started;f.invalidate();release();
    await assert.rejects(p,{code:'T3_ORIGINAL_LOCAL_SOURCE_MUTATION_OUTCOME_UNKNOWN'});
    assert.throws(()=>native.commitObjectGraph(nativeGraph()),{code:'T3_D3_ORIGINAL_KERNEL_NOT_CONNECTED'});
    assert.equal(f.calls.some(x=>x[0]==='commitObjectGraph'),false);
  }finally{release();f.relay.close();}
});


import {createSubjectKernelBinding} from '../../t3-core/src/t3/subject-access-binding.mjs';
test('original Admin signed D3 receipt can share management Workspace without opening a raw Registry write',async()=>{
  const storage='workspace:registry:'+'b'.repeat(64),effect='c'.repeat(64);
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach:()=>true,timeoutMs:2000,
    originalRegistryScope:{workspaceId:storage,objectId:OBJ}});
  const c={...context,kind:'CORP',principal_id:'org:admin',organization_id:'org:admin',purpose:'application'};
  let permitted=true,authorized=0;
  const access={currentContext:()=>c,actionFor:op=>op,operationDigest:digest,
    authorize(request){authorized++;return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',allowed:permitted,
      outcome:permitted?'PERMITTED':'DENIED',evidenceOnly:true,requestDigest:digest(request),policyDigest:'a'.repeat(64),
      organizationId:c.organization_id,workspaceId:c.workspace_id,grantId:c.grant_id,operationDigest:request.operationDigest,
      evidenceDigest:'d'.repeat(64),productionActivation:false,doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
      statusSequence:1,validUntil:new Date(Date.now()+60000).toISOString()};},verifyDecisionBinding:(request,decision)=>decision.requestDigest===digest(request)};
  const logical={workspace_id:WS,idempotency_key:effect,object:{object_id:'result:applied:'+effect,
    schema_id:'iwxa.admin.applied-results',schema_version:'1.0.0',base_revision:0,
    data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[{workspaceId:WS,organizationId:c.organization_id}]},extensions:{}},
    event:{event_type:'iwxa.admin.result.applied',payload:{effectKey:effect}},relations_put:[],relations_deletes:[]};
  const physical={...logical,workspace_id:storage};
  try{
    const s=await relay.exchange({verb:'attach',payload:{sessionInfo:{...info(base),service_id:'iwxa.admin-center.workspace'}}},1);
    const raw=relay.nativeKernel;
    const ex=(verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},1);
    const signed=createSubjectKernelBinding({kernel:raw,access,isHostActive:()=>relay.attached,
      applicationReceiptScope:{workspaceId:storage,effectKey:effect}});
    assert.throws(()=>raw.commitObjectGraph(physical),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    await assert.rejects(relay.nativeRegistryKernel.commitObjectGraph(physical),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    await assert.rejects(signed.commitObjectGraph({...logical,idempotency_key:'e'.repeat(64)}),{code:'T3_D3_APPLICATION_RECEIPT_SCOPE_INVALID'});
    permitted=false;await assert.rejects(signed.commitObjectGraph(logical),{code:'T3_ACCESS_NOT_PERMITTED'});permitted=true;
    const p=signed.commitObjectGraph(logical);p.catch(()=>{});
    const command=await ex('next');assert.equal(command.kind,'COMMAND');assert.equal(command.method,'commitObjectGraph');
    assert.deepEqual(command.args,[physical]);assert.equal(command.network,undefined);
    const receipt=resultFor('commitObjectGraph',[physical]);await ex('result',{id:command.id,ok:true,result:receipt});
    assert.deepEqual(await p,receipt);assert.equal(authorized,2);
    assert.throws(()=>raw.commitObjectGraph(command.args[0]),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
    assert.throws(()=>raw.commitObjectGraph({...graph(),workspace_id:storage}),{code:'T3_ORIGINAL_REGISTRY_RELAY_SCOPE_DENIED'});
  }finally{relay.close();}
});


test('one native product Registry port is handed off before attach and reused by later profile',async()=>{
  let binding,raw,expectedEpoch=1;
  const f=fixture({installed:true,nativeAttach:async(k,b)=>{
    raw=k;binding=b;
    assert.ok(Object.isFrozen(b));assert.equal(b.workspaceId,REG);assert.equal(b.objectId,OBJ);
    assert.equal(b.contextEpoch,expectedEpoch);assert.equal(b.isHostActive(),false);
    assert.equal(b.registryKernel.hasOperation('t1.getWorkspace'),true);
    assert.equal(b.registryKernel.hasOperation('t1.commitObjectGraph'),true);
    assert.equal(b.registryKernel.hasOperation('t1.createWorkspace'),false);
    assert.equal(b.registryKernel.createWorkspace,undefined);
    await assert.rejects(b.registryKernel.getWorkspace(REG),{code:'T3_ORIGINAL_REGISTRY_RELAY_NOT_CONNECTED'});
    assert.equal(f.relay.nativeRegistryKernel,null);
    return true;
  },createHook:async lifetime=>{
    assert.equal(lifetime.registryKernel,binding.registryKernel);
    assert.equal(lifetime.sessionId,binding.sessionId);assert.equal(lifetime.contextEpoch,binding.contextEpoch);
    assert.equal(binding.isHostActive(),true);await lifetime.registryKernel.getObject(REG,OBJ);
  }});
  try{const s=await f.attach();assert.equal(s.sessionId,binding.sessionId);assert.equal(f.relay.nativeKernel,raw);
    assert.equal(f.relay.nativeRegistryKernel,binding.registryKernel);assert.equal(binding.isHostActive(),true);
    await f.activate(s);assert.equal(f.registry,binding.registryKernel);
    f.invalidate();assert.equal(binding.isHostActive(),false);assert.equal(binding.registryKernel.hasOperation('t1.getObject'),false);
    await assert.rejects(binding.registryKernel.getObject(REG,OBJ),{code:'T3_ORIGINAL_REGISTRY_RELAY_NOT_CONNECTED'});
    const prior=binding;expectedEpoch=2;const second=await f.attach();assert.notEqual(second.sessionId,prior.sessionId);
    assert.notEqual(binding.registryKernel,prior.registryKernel);assert.equal(prior.isHostActive(),false);
  }finally{f.relay.close();}
});

test('legacy unscoped native attach keeps its existing one-argument contract',async()=>{
  let count=0;
  const relay=createOriginalKernelNativeRelay({currentEpoch:()=>1,onAttach(...args){count=args.length;return true;},timeoutMs:2000});
  try{await relay.exchange({verb:'attach',payload:{sessionInfo:info(base)}},1);
    assert.equal(count,1);assert.equal(relay.nativeRegistryKernel,null);
  }finally{relay.close();}
});


test('original native peer receiver is released exactly at the READY announcement, not at binding',async()=>{
  let bound=false,released=0,historyRead=null;
  const f=fixture({bindHook:async receiver=>{
    bound=true;assert.equal(f.relay.networkAttached,false);assert.equal(released,0);
    await tick();assert.equal(released,0);
    return ()=>{f.counts.stop++;};
  },profilePatch:{activateOriginalPeerHistoryReceiver(){
    assert.equal(bound,true);assert.equal(f.relay.networkAttached,true);released++;
    historyRead=f.relay.readOriginalReplacementOwnerHistory({request:'early-peer'});
    historyRead.catch(()=>{});
  }}});
  try{const session=await f.attach();await f.activate(session);
    assert.equal(released,1);await f.command(session,'getObject',[REG,OBJ]);
    assert.deepEqual(await historyRead,{ok:true});
  }finally{f.relay.close();}
});
test('failed peer release denies activation instead of advertising a broken READY session',async()=>{
  const f=fixture({profilePatch:{activateOriginalPeerHistoryReceiver(){throw Error('PEER_CLOSED');}}});
  try{const session=await f.attach();await f.command(session,'getObject',[REG,OBJ]);await f.command(session,'listEventsSince',[REG]);
    const reply=await f.next(session);
    assert.equal(reply.kind,'NETWORK_ACTIVATION');assert.equal(reply.activation.state,'DENIED');
    assert.equal(reply.activation.networkMethods,undefined);assert.equal(reply.activation.localSourceMutationVersion,undefined);
    assert.equal(f.relay.networkAttached,false);assert.equal(f.counts.stop,1);assert.equal(f.counts.close,1);assert.equal(f.counts.detach,1);
  }finally{f.relay.close();}
});

const registryImportOps=['t2.importPreview','t2.importCommit','t2.importCancel'];
const registryExportOptions={workspaces:[REG],include_history:true,include_assets:false,
  include_relations:false,include_schemas:false,scope:{mode:'workspace'}};
const importPreview={preview_token:'registry-preview',package_digest:'d'.repeat(64),preview:{
  workspaces:[{workspace_id:REG,exists_locally:false}],objects:[{workspace_id:REG,object_id:OBJ,
    schema_id:'iwxa.t3.access.signed-registry',schema_version:'1.0.0',local_revision:null}]}};
const importCommand={preview_token:importPreview.preview_token,package_digest:importPreview.package_digest,
  plan:{mode:'full',conflict:'fail',include_workspaces:[REG],include_history:true,include_assets:false,include_relations:false}};
test('installed SOURCE transfers original T2 Registry archive before network READY using the existing command slot',async()=>{
  const bytes=Uint8Array.from([0,255,128,64,1]);
  let imported=false;
  const f=fixture({installed:true,registryExchangeOperations:registryImportOps,
    async createHook({registryKernel:reg}){
      assert.equal(reg.hasOperation('t2.importPreview'),true);
      assert.equal(reg.hasOperation('t2.exportPackage'),false);
      assert.equal(f.relay.nativeKernel.hasOperation('t2.importCommit'),false);
      const handle=await reg.importPreview(bytes);assert.deepEqual(handle,importPreview);
      await assert.rejects(reg.importCommit({...importCommand,plan:{...importCommand.plan,include_workspaces:[WS]}}),
        {code:'T3_ORIGINAL_REGISTRY_EXCHANGE_SCOPE_DENIED'});
      assert.deepEqual(await reg.importCommit(importCommand),{imported:true});
      imported=true;
    }});
  try{
    const s=await f.attach();
    await assert.rejects(f.relay.nativeRegistryKernel.importPreview(bytes),{code:'T3_ORIGINAL_REGISTRY_EXCHANGE_LIFETIME_ENDED'});
    await f.command(s,'importPreview',[Buffer.from(bytes).toString('base64url')],importPreview);
    assert.equal(f.relay.networkAttached,false);
    await f.command(s,'importCommit',[importCommand],{imported:true});
    await f.command(s,'listEventsSince',[REG]);
    const result=await f.next(s);assert.equal(result.activation.state,'READY');assert.equal(imported,true);
    await assert.rejects(f.registry.importPreview(bytes),{code:'T3_ORIGINAL_REGISTRY_EXCHANGE_LIFETIME_ENDED'});
  }finally{f.relay.close();}
});
test('installed SOURCE cancels a foreign original Exchange preview without dispatching import',async()=>{
  const bytes=Uint8Array.from([1,2,3]),foreign=structuredClone(importPreview);
  foreign.preview.objects[0].object_id='foreign';
  const f=fixture({installed:true,registryExchangeOperations:registryImportOps,
    async createHook({registryKernel:reg}){
      await reg.importPreview(bytes);
      await assert.rejects(reg.importCommit(importCommand),{code:'T3_ORIGINAL_REGISTRY_EXCHANGE_SCOPE_DENIED'});
      assert.equal(await reg.importCancel(importPreview.preview_token),true);
      throw Error('expected admission hold');
    }});
  try{const s=await f.attach();await f.command(s,'importPreview',[Buffer.from(bytes).toString('base64url')],foreign);
    await f.command(s,'importCancel',[importPreview.preview_token],true);const done=await f.next(s);
    assert.equal(done.activation.state,'DENIED');assert.equal(f.relay.networkAttached,false);
    assert.equal(f.calls.some(([method])=>method==='importCommit'),false);
  }finally{f.relay.close();}
});
test('installed RECIPIENT exports only its original Registry partition and returns exact archive bytes',async()=>{
  const f=fixture({installed:true,role:'RECIPIENT',registryExchangeOperations:['t2.exportPackage']});
  try{const s=await f.attach();await f.activate(s);const reg=f.registry;
    assert.equal(reg.hasOperation('t2.exportPackage'),true);assert.equal(reg.hasOperation('t2.importCommit'),false);
    await assert.rejects(reg.exportPackage({...registryExportOptions,workspaces:[WS]}),{code:'T3_ORIGINAL_REGISTRY_EXCHANGE_SCOPE_DENIED'});
    const bytes=Uint8Array.from([0,255,7]);
    const pending=reg.exportPackage(registryExportOptions);
    await f.command(s,'exportPackage',[registryExportOptions],{bytesBase64url:Buffer.from(bytes).toString('base64url'),size:bytes.length});
    assert.deepEqual(await pending,{bytes,size:3});
  }finally{f.relay.close();}
});
test('ordinary or wrong role cannot negotiate private Registry Exchange',async()=>{
  for(const options of [{installed:false,registryExchangeOperations:registryImportOps},
    {installed:true,role:'RECIPIENT',registryExchangeOperations:registryImportOps},
    {installed:true,registryExchangeOperations:['t2.exportPackage']}]){
    const f=fixture(options);try{await assert.rejects(f.attach(),{code:'T3_ORIGINAL_REGISTRY_EXCHANGE_OPERATIONS_INVALID'});}
    finally{f.relay.close();}
  }
});
