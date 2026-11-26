import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createOriginalControlHttpHandler} from '../../t3-core/src/t3/original-control-http-handler.mjs';
import {createT4OriginalInstalledControlFactories} from '../src/network/original-installed-control-factories.mjs';
const WS='ws:source',TECH='ws:technical',REG='ws:registry',OTHER='ws:other';
const token='x'.repeat(43);
const info={contract_version:'1.3.0',runtime_version:'0.3.6',service_id:'service:original',
  granted_operations:['t1.getWorkspace','t1.getObject','t1.listEventsSince','t1.commitObjectGraph']};
for(const role of ['SOURCE','RECIPIENT'])test('original installed '+role+' Control sends pinned scope over HTTP and gates UI on the exact relay',async()=>{
  const scope={schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1',role,sourceWorkspaceId:WS,technicalWorkspaceId:TECH,registryWorkspaceId:REG};
  let handler,selected=WS,profiles=0;
  const server=createServer((req,res)=>{void handler(req,res).catch(error=>{res.writeHead(500);res.end(String(error));});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port,uiOrigin='http://127.0.0.1:1';
  const f=createT4OriginalInstalledControlFactories({scope,createProfile:()=>{profiles++;throw Error('not admitted');},
    bindPeerHistoryReceiver:()=>()=>{},originalControlHandlerFactory:createOriginalControlHttpHandler});
  const relay=f.originalKernelRelayFactory({currentEpoch:()=>1,onAttach:()=>true});
  const owner={currentContext:()=>({workspace_id:selected,resource:selected}),actionFor:()=>assert.fail('select only'),
    operationDigest:()=>assert.fail('select only'),authorize:()=>assert.fail('select only'),verifyDecisionBinding:()=>false};
  handler=f.originalControlHandlerFactory({origin,token,uiOrigin,serviceId:'service:original',
    currentEpoch:()=>1,subscribeInvalidation:()=>()=>{},ownerFor:()=>owner,originalKernelRelayFor:()=>relay});
  const post=async(path,body)=>{
    const res=await fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,origin,
      'content-type':'application/json','x-iwxa-context-epoch':'1'},body:JSON.stringify(body)});
    return {status:res.status,data:await res.json()};
  };
  const select=async operation=>{
    const res=await post('/api/t3/owner',{scope:'kernel',operation,verb:'select'});
    assert.equal(res.status,200);return res.data.available;
  };
  try{
    const config=await (await fetch(origin+'/workspace/t3-kernel-realm.json')).json();
    assert.deepEqual(config.installed_network_scope,scope);
    if(role==='SOURCE')assert.deepEqual(config.local_source_capture,{schema:'IWXA_T4_ORIGINAL_LOCAL_SOURCE_CAPTURE/1',workspace_id:WS});
    else assert.equal(config.local_source_capture,undefined);
    const launch=await (await fetch(origin+'/workspace/t3-signed-ui.json')).json();
    assert.equal(launch.installed_network_scope,undefined);assert.equal(launch.local_source_capture,undefined);
    assert.equal(await select('getObject'),true);assert.equal(await select('putObject'),false);
    for(const id of [TECH,REG]){selected=id;assert.equal(await select('getObject'),false);assert.equal(await select('putObject'),false);}
    selected=OTHER;assert.equal(await select('putObject'),true);selected=WS;
    const bad=await post('/api/t3/original-kernel',{verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1}});
    assert.equal(bad.status,403);assert.equal(relay.attached,false);
    const good=await post('/api/t3/original-kernel',{verb:'attach',payload:{sessionInfo:info,networkRelayVersion:1,networkActivationVersion:1,
      installedNetworkScope:scope,...(role==='SOURCE'?{localSourceMutationVersion:1,localSourceGraphVersion:1}:{})}});
    assert.equal(good.status,200);assert.equal(good.data.result.networkActivationPending,1);
    assert.equal(profiles,0);assert.equal(relay.networkAttached,false);assert.equal(await select('putObject'),false);
    await post('/api/t3/original-kernel',{verb:'detach',payload:{sessionId:good.data.result.sessionId}});
    assert.equal(relay.attached,false);
  }finally{relay.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
