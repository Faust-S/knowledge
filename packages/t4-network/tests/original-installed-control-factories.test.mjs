import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalInstalledControlFactories as factories} from '../src/network/original-installed-control-factories.mjs';
import {normalizeOriginalInstalledNetworkScope as normalize,allowOriginalInstalledNetworkUiOperation as allow,
  createOriginalInstalledNetworkMutationRoute as route} from '../../t3-core/src/t3/original-installed-network-scope.mjs';
import {createOriginalLocalSourceMutationRoute} from '../../t3-core/src/t3/original-local-source-mutation-route.mjs';
import {isOriginalKernelNativeRelayForNetworkOwner} from '../../t3-core/src/t3/original-kernel-native-relay.mjs';
const WS='ws:source',TECH='ws:network',REG='ws:registry',OTHER='ws:other',OBJ='t3.access.signed-registry';
const source={schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1',role:'SOURCE',sourceWorkspaceId:WS,technicalWorkspaceId:TECH,registryWorkspaceId:REG};
const recipient={...source,role:'RECIPIENT'};
const mutations=['putObject','deleteObject','putAsset','deleteAsset','putRelation','deleteRelation','commitObjectGraph'];
const reads=['getWorkspace','getObject','listObjects','listObjectWindow','getAsset','listAssets','listEventsSince','listEventCommitWindow','listEventObjectCommitWindow','exportPreview','exportPackage','activity.read'];
const base=['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.commitObjectGraph'];
const operations=[...new Set([...base,...mutations.map(m=>'t1.'+m)])];
const info={contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'service:original',granted_operations:operations};
const ctx=id=>({workspace_id:id,resource:id});
const mutationArgs=(m,id)=>[m==='softDeleteWorkspace'||m==='restoreWorkspace'?id:m==='confirmExport'?{workspace_ids:[id]}:{workspace_id:id}];
const expectedSourceReady={sessionId:'s'.repeat(43),contextEpoch:1,networkRelayVersion:1,networkMethods:mutations,
  localSourceMutationVersion:1,localSourceGraphVersion:1,localSourceWorkspaceId:WS,localSourceMutationMethods:mutations};
function nativeRoute({receipt={state:'ORIGINAL_SOURCE_MUTATION_CAPTURED',originalT3OutboxVerified:true,networkPublished:false,
  captureRef:'capture:one',originalReceipt:{object:{object_id:'item:1'}}}}={}){
  let active=true;const calls=[];const r=createOriginalLocalSourceMutationRoute({workspaceId:WS,isHostActive:()=>active,
    originalKernelRelay:async(verb,payload)=>{calls.push([verb,payload]);return receipt;}});
  return {r,calls,close(){active=false;},get active(){return active;}};
}
function fixture({scope=source,profileFails=false}={}){
  let handlerOptions,selected=WS,ownerCount=0,profileCount=0,attachedCount=0,closedCount=0,stops=0,profile;
  const grant=Object.freeze({currentContext:()=>ctx(selected)});
  const f=factories({scope,
    originalControlHandlerFactory(options){handlerOptions=options;return async()=>true;},
    async createProfile(p){profileCount++;await p.registryKernel.getObject(REG,OBJ);if(profileFails)throw Error('profile denied');
      const owner={role:scope.role,identity:{sourceWorkspaceId:WS,technicalWorkspaceId:TECH},operations,
        onAttach(){attachedCount++;return true;},onDetach(){},resolveOriginalAccess:()=>null,
        originalSignedReplacementHistoryBound:true,readOriginalReplacementOwnerHistory:()=>null,
        ...(scope.role==='SOURCE'?{localSourceMutation:{workspaceId:WS,methods:mutations,invoke:()=>null}}:{})};
      profile={schema:'IWXA_T4_ORIGINAL_NATIVE_HOST_NETWORK_PROFILE_V1',role:scope.role,networkOwner:owner,
        close(){closedCount++;},bindOriginalPeerHistoryReceiver(relay){assert.equal(isOriginalKernelNativeRelayForNetworkOwner(relay,owner),true);return {};}};
      return profile;
    },bindPeerHistoryReceiver:()=>()=>{stops++;}});
  const relay=f.originalKernelRelayFactory({currentEpoch:()=>1,onAttach:()=>true});
  let suppliedRelay=relay;
  const handler=f.originalControlHandlerFactory({ownerFor(){ownerCount++;return grant;},originalKernelRelayFor:()=>suppliedRelay});
  const attach=(patch={})=>relay.exchange({verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1,
    installedNetworkScope:scope,...(scope.role==='SOURCE'?{localSourceMutationVersion:1,localSourceGraphVersion:1}:{}),...patch}},1);
  const ex=(s,verb,rest={})=>relay.exchange({verb,payload:{sessionId:s.sessionId,...rest}},1);
  async function activate(){const s=await attach();assert.equal(s.networkActivationPending,1);assert.equal(profileCount,0);
    const cmd=await ex(s,'next');assert.equal(cmd.method,'getObject');assert.deepEqual(cmd.args,[REG,OBJ]);
    await ex(s,'result',{id:cmd.id,ok:true,result:null});const r=await ex(s,'next');return {s,r};}
  return {f,relay,handler,attach,ex,activate,select:id=>{selected=id;},replaceRelay:value=>{suppliedRelay=value;},
    get opts(){return handlerOptions;},get counts(){return {ownerCount,profileCount,attachedCount,closedCount,stops};},grant};
}
test('installed scope snapshots exact separated workspaces, rejects malformed or aliased scope',()=>{
  const raw={...source},s=normalize(raw);raw.role='RECIPIENT';assert.equal(s.role,'SOURCE');assert.ok(Object.isFrozen(s));
  for(const bad of [null,[],{...source,role:'BOTH'},{...source,registryWorkspaceId:TECH},{...source,technicalWorkspaceId:WS},
    {...source,registryWorkspaceId:'not a workspace'},{...source,extra:true}])assert.throws(()=>normalize(bad),{code:'T3_ORIGINAL_INSTALLED_NETWORK_SCOPE_INVALID'});
});
test('original signed UI is subject to an additional role ceiling, not an implicit grant',()=>{
  for(const scope of [source,recipient]){
    for(const op of reads){assert.equal(allow(scope,op,ctx(WS),false),true);for(const id of [REG,TECH])assert.equal(allow(scope,op,ctx(id),true),false);}
    for(const op of [...mutations,'createWorkspace','restoreWorkspace','purgeCommit','importCommit','confirmExport','unknown']){
      assert.equal(allow(scope,op,ctx(WS),false),false);assert.equal(allow(scope,op,ctx(WS),true),scope===source&&mutations.includes(op));
      assert.equal(allow(scope,op,ctx(OTHER),false),true);
    }
    assert.equal(allow(scope,'getObject',{workspace_id:WS,resource:OTHER},true),false);
  }
});
test('recipient cannot mutate replicated or technical/registry workspace even if a legacy UI grant exists',async()=>{
  const r=route({scope:recipient,isHostActive:()=>true});
  for(const m of [...mutations,'createWorkspace','restoreWorkspace','softDeleteWorkspace','confirmExport']){
    await assert.rejects(r(m,mutationArgs(m,WS)),{code:'T3_ORIGINAL_INSTALLED_NETWORK_REPLICA_READ_ONLY'});
    for(const id of [REG,TECH])await assert.rejects(r(m,mutationArgs(m,id)),{code:'T3_ORIGINAL_INSTALLED_NETWORK_INTERNAL_WRITE_DENIED'});
    assert.deepEqual(await r(m,mutationArgs(m,OTHER)),{kind:'LOCAL_T3'});
  }
});
test('source guard uses real original local capture route and does not fall back before admission',async()=>{
  const f=nativeRoute(),r=route({scope:source,sourceRoute:f.r,isHostActive:()=>f.active});
  await assert.rejects(r('putObject',mutationArgs('putObject',WS)),{code:'T3_LOCAL_SOURCE_CAPTURE_BINDING_REQUIRED'});
  assert.equal(f.calls.length,0);f.r.accept(expectedSourceReady);
  const input={workspace_id:WS,object_id:'item:1',bytes:Uint8Array.from([0,255])};
  const p=r('putAsset',[input]);input.bytes[0]=99;
  assert.equal((await p).kind,'CAPTURED');assert.equal(f.calls[0][0],'sourceMutation');assert.equal(f.calls[0][1].args[0].bytesBase64url,'AP8');
  await assert.rejects(r('putObject',mutationArgs('putObject',REG)),{code:'T3_ORIGINAL_INSTALLED_NETWORK_INTERNAL_WRITE_DENIED'});
  await assert.rejects(r('createWorkspace',mutationArgs('createWorkspace',WS)),{code:'T3_LOCAL_SOURCE_CAPTURE_OPERATION_NOT_SUPPORTED'});
  assert.deepEqual(await r('putObject',mutationArgs('putObject',OTHER)),{kind:'LOCAL_T3'});
  f.r.clear();await assert.rejects(r('putObject',mutationArgs('putObject',WS)),{code:'T3_LOCAL_SOURCE_CAPTURE_BINDING_REQUIRED'});
  f.close();await assert.rejects(r('putObject',mutationArgs('putObject',OTHER)),{code:'T3_HOST_DISPOSED'});
});
test('no ambiguous import/purge token or multi-workspace export confirmation bypasses the configured guard',async()=>{
  for(const scope of [source,recipient]){const r=route({scope,sourceRoute:scope===source?nativeRoute().r:null,isHostActive:()=>true});
    for(const m of ['purgeCommit','importCommit'])await assert.rejects(r(m,[{workspace_id:OTHER}]),{code:'T3_ORIGINAL_INSTALLED_NETWORK_MUTATION_SCOPE_UNKNOWN'});
    await assert.rejects(r('confirmExport',[{workspace_ids:[OTHER,WS]}]),{code:'T3_ORIGINAL_INSTALLED_NETWORK_MUTATION_SCOPE_UNKNOWN'});
    await assert.rejects(r('putObject',[]),{code:'T3_ORIGINAL_INSTALLED_NETWORK_MUTATION_INVALID'});
  }
});
test('disabled mode or unverified capture cannot silently turn into local T3 write',async()=>{
  const f=nativeRoute({receipt:{state:'LOCAL_T3_BYPASS'}});f.r.accept(expectedSourceReady);
  await assert.rejects(route({scope:source,sourceRoute:f.r,isHostActive:()=>true})('putObject',mutationArgs('putObject',WS)),{code:'T3_LOCAL_SOURCE_CAPTURE_MODE_CHANGED'});
  const r=route({scope:source,sourceRoute:{route:()=>({kind:'LOCAL_T3'})},isHostActive:()=>true});
  await assert.rejects(r('putObject',mutationArgs('putObject',WS)),{code:'T3_ORIGINAL_INSTALLED_NETWORK_CAPTURE_REQUIRED'});
});
test('factory plugs into original Control options, refuses duplicate Relay or handler and wrong relay identity',async()=>{
  const f=fixture();try{assert.equal(typeof f.handler,'function');assert.deepEqual(f.opts.installedNetworkScope,source);assert.equal(await f.opts.originalKernelRelayFor({}),f.relay);
    assert.throws(()=>f.f.originalKernelRelayFactory({}),{code:'T4_INSTALLED_CONTROL_SINGLE_ORIGINAL_RELAY_REQUIRED'});
    assert.throws(()=>f.f.originalControlHandlerFactory({}),{code:'T4_INSTALLED_CONTROL_SINGLE_ORIGINAL_HANDLER_REQUIRED'});
    f.replaceRelay({});await assert.rejects(f.opts.originalKernelRelayFor({}),{code:'T4_INSTALLED_CONTROL_ORIGINAL_RELAY_MISMATCH'});
  }finally{f.relay.close();}
});
test('installed Relay refuses legacy, mismatched role, wrong scope and source graph negotiation',async()=>{
  const f=fixture();try{
    for(const p of [{installedNetworkScope:undefined},{networkActivationVersion:undefined},{networkRelayVersion:0},
      {installedNetworkScope:recipient},{installedNetworkScope:{...source,registryWorkspaceId:'ws:foreign'}},{localSourceGraphVersion:0}])
      await assert.rejects(f.attach(p));
    assert.equal(f.counts.profileCount,0);assert.equal(f.relay.attached,false);
  }finally{f.relay.close();}
});
test('source UI receives original grant unchanged only after real native Relay activation; internal scope never exposed',async()=>{
  const f=fixture();try{
    const op=operation=>f.opts.ownerFor({scope:'kernel',operation});
    assert.equal(await op('getWorkspace'),f.grant);assert.equal(await op('putObject'),null);
    for(const id of [REG,TECH]){f.select(id);assert.equal(await op('getObject'),null);assert.equal(await op('putObject'),null);}
    f.select(OTHER);assert.equal(await op('putObject'),f.grant);f.select(WS);
    const {r}=await f.activate();assert.equal(r.activation.state,'READY');assert.equal(f.relay.networkAttached,true);assert.equal(await op('putObject'),f.grant);
    assert.equal(await op('importCommit'),null);f.relay.invalidate();assert.equal(await op('putObject'),null);
    assert.equal(f.counts.closedCount,1);assert.equal(f.counts.stops,1);
  }finally{f.relay.close();}
});
test('recipient remains read-only after native profile READY',async()=>{
  const f=fixture({scope:recipient});try{const {r}=await f.activate();assert.equal(r.activation.state,'READY');
    assert.equal(await f.opts.ownerFor({operation:'getObject'}),f.grant);
    for(const m of mutations)assert.equal(await f.opts.ownerFor({operation:m}),null);
  }finally{f.relay.close();}
});
test('failed native activation leaves local reads and unrelated original T3 work available',async()=>{
  const f=fixture({profileFails:true});try{const {r}=await f.activate();assert.equal(r.activation.state,'DENIED');
    assert.equal(f.relay.attached,true);assert.equal(f.relay.networkAttached,false);
    assert.equal(await f.opts.ownerFor({operation:'putObject'}),null);assert.equal(await f.opts.ownerFor({operation:'getObject'}),f.grant);
    f.select(OTHER);assert.equal(await f.opts.ownerFor({operation:'putObject'}),f.grant);
  }finally{f.relay.close();}
});
