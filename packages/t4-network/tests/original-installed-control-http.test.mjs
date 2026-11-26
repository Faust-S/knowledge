import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createOriginalControlHttpHandler} from '../../t3-core/src/t3/original-control-http-handler.mjs';
import {createT4OriginalInstalledControlFactories} from '../src/network/original-installed-control-factories.mjs';
const WS='ws:source',TECH='ws:technical',REG='ws:registry',OTHER='ws:other';
const token='x'.repeat(43),serviceId='iwxa.workspace.relay';
const info={contract_version:'1.3.0',runtime_version:'0.3.6',service_id:serviceId,
  granted_operations:['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.commitObjectGraph']};
async function fixture(t,role){
  const scope={schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1',role,sourceWorkspaceId:WS,technicalWorkspaceId:TECH,registryWorkspaceId:REG};
  let handler,relay,selected=WS,profiles=0,drift=null,actions=0,authorizations=0,driftDuringProof=null;
  const server=createServer((req,res)=>{void Promise.resolve().then(()=>handler(req,res)).then(handled=>{
    if(!handled&&!res.headersSent){res.writeHead(404);res.end();}
  }).catch(error=>{if(!res.headersSent)res.writeHead(500);res.end(String(error));});});
  // Register cleanup BEFORE any setup or validation can throw. A failing
  // assertion or invalid service passport must not keep the CI worker open.
  t.after(async()=>{relay?.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port,uiOrigin='http://127.0.0.1:1';
  const f=createT4OriginalInstalledControlFactories({scope,createProfile:()=>{profiles++;throw Error('not admitted');},
    bindPeerHistoryReceiver:()=>()=>{},originalControlHandlerFactory:createOriginalControlHttpHandler});
  relay=f.originalKernelRelayFactory({currentEpoch:()=>1,onAttach:()=>true});
  const owner={currentContext(){
    const c={workspace_id:selected,resource:selected};
    if(drift!==null){selected=drift;drift=null;}return c;
  },actionFor(){actions++;return 'workspace.read';},operationDigest:()=> 'a'.repeat(64),
    authorize(){authorizations++;if(driftDuringProof!==null)selected=driftDuringProof;return {allowed:true};},verifyDecisionBinding:()=>true};
  handler=f.originalControlHandlerFactory({origin,token,uiOrigin,serviceId,
    currentEpoch:()=>1,subscribeInvalidation:()=>()=>{},ownerFor:()=>owner,originalKernelRelayFor:()=>relay});
  const get=async path=>await (await fetch(origin+path,{signal:AbortSignal.timeout(3000)})).json();
  const post=async(path,body)=>{
    const res=await fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,origin,
      'content-type':'application/json','x-iwxa-context-epoch':'1'},signal:AbortSignal.timeout(3000),body:JSON.stringify(body)});
    return {status:res.status,data:await res.json()};
  };
  const request=(operation,verb,extra={},scope='kernel')=>post('/api/t3/owner',{scope,operation,verb,...extra});
  const select=async operation=>{
    const res=await request(operation,'select');assert.equal(res.status,200);return res.data.available;
  };
  return {scope,relay,get,post,select,request,setSelected:id=>{selected=id;},driftTo:id=>{drift=id;},
    driftProofTo:id=>{driftDuringProof=id;},get profiles(){return profiles;},get actions(){return actions;},get authorizations(){return authorizations;}};
}
for(const role of ['SOURCE','RECIPIENT'])test('original installed '+role+' Control sends pinned scope over HTTP and gates UI on the exact relay',{timeout:10000},async t=>{
  const f=await fixture(t,role),{scope,relay}=f;
  const config=await f.get('/workspace/t3-kernel-realm.json');
  assert.deepEqual(config.installed_network_scope,scope);
  if(role==='SOURCE')assert.deepEqual(config.local_source_capture,{schema:'IWXA_T4_ORIGINAL_LOCAL_SOURCE_CAPTURE/1',workspace_id:WS});
  else assert.equal(config.local_source_capture,undefined);
  const launch=await f.get('/workspace/t3-signed-ui.json');
  assert.equal(launch.installed_network_scope,undefined);assert.equal(launch.local_source_capture,undefined);
  assert.equal(await f.select('getObject'),true);assert.equal(await f.select('putObject'),false);
  for(const id of [TECH,REG]){f.setSelected(id);assert.equal(await f.select('getObject'),false);assert.equal(await f.select('putObject'),false);}
  f.setSelected(OTHER);assert.equal(await f.select('putObject'),true);f.setSelected(WS);
  const bad=await f.post('/api/t3/original-kernel',{verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1}});
  assert.equal(bad.status,403);assert.equal(relay.attached,false);
  const good=await f.post('/api/t3/original-kernel',{verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1,
    installedNetworkScope:scope,...(role==='SOURCE'?{localSourceMutationVersion:1,localSourceGraphVersion:1}:{})}});
  assert.equal(good.status,200);assert.equal(good.data.result.networkActivationPending,1);
  assert.equal(f.profiles,0);assert.equal(relay.networkAttached,false);assert.equal(await f.select('putObject'),false);
  const detached=await f.post('/api/t3/original-kernel',{verb:'detach',payload:{sessionId:good.data.result.sessionId}});
  assert.equal(detached.status,200);assert.equal(relay.attached,false);
});
test('actual installed Control rechecks the selected context and operation before any signed decision',{timeout:10000},async t=>{
  const f=await fixture(t,'RECIPIENT');
  assert.equal((await f.request('getObject','action',{kernelOperation:'t1.getObject'})).status,200);
  assert.equal(f.actions,1);
  const mismatch=await f.request('getObject','action',{kernelOperation:'t1.putObject'});
  assert.equal(mismatch.status,403);assert.equal(mismatch.data.error,'T3_ORIGINAL_INSTALLED_NETWORK_UI_OPERATION_DENIED');assert.equal(f.actions,1);
  assert.equal((await f.request('activity.read','action',{kernelOperation:'t1.listEventsSince'},'activity')).status,200);
  assert.equal((await f.request('activity.read','action',{kernelOperation:'t1.putObject'},'activity')).status,403);
  // Even a method-specific owner selected under OTHER must not execute
  // after its next currentContext() observes a protected Workspace.
  f.setSelected(OTHER);f.driftTo(WS);
  const moved=await f.request('putObject','action',{kernelOperation:'t1.putObject'});
  assert.equal(moved.status,403);assert.equal(moved.data.error,'T3_ORIGINAL_INSTALLED_NETWORK_UI_OPERATION_DENIED');assert.equal(f.actions,2);
  f.setSelected(OTHER);f.driftTo(REG);
  assert.equal(await f.select('getObject'),false);
  f.setSelected(WS);
  assert.equal((await f.request('getObject','authorize',{request:{resource:REG}})).status,403);
  assert.equal(f.authorizations,0);
  // This fixture deliberately models the owner decision only. The genuine
  // original signed-owner proof is exercised by the separate D1 regression.
  f.setSelected(OTHER);f.driftProofTo(REG);
  const stale=await f.request('getObject','authorize',{request:{resource:OTHER}});
  assert.equal(stale.status,403);assert.equal(stale.data.error,'STALE_CONTEXT_OPERATION');
  assert.equal(f.authorizations,1);
});
