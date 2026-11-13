import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {bindSignedOriginalKernelPort,createIsolatedKernelClient}
  from '../src/t3/origin-isolated-kernel-transport.mjs';
import {createIsolatedOriginalKernelBootstrap,ORIGINAL_KERNEL_CONTRACT_OPERATIONS}
  from '../src/t3/origin-isolated-kernel-bootstrap.mjs';
const meta={contract_version:'1.3.0',runtime_version:'0.3.6',
  service:{service_id:'iwxa.workspace.demo',base_path:'/workspace',service_version:'1.0.0'},
  mode:'full',granted_levels:['T0','T1','T2'],granted_operations:['t0.validate','t1.getWorkspace','t1.putObject']};
const denied=code=>Object.assign(new Error(code),{code});

test('actual T2 public 1.3.0 surface is carried by signed realm and not reimplemented',async()=>{
  const ch=new MessageChannel();let authorized=0,written=0;
  const facade=Object.freeze({
    async getWorkspace(ws){authorized++;if(ws!=='ws:own')throw denied('T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE');return {workspace_id:ws};},
    async putObject(cmd){authorized++;if(cmd.workspace_id!=='ws:own')throw denied('T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE');written++;return {object:{...cmd}};},
  });
  const host=bindSignedOriginalKernelPort({port:ch.port1,createSignedFacade:async()=>facade,
    describeOriginalSession:async()=>meta,
    validateOriginalObjects:async input=>({tier:'t0',service_id:meta.service.service_id,ok:true,objects:input.objects}),
    isActive:()=>true});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    const loader=createIsolatedOriginalKernelBootstrap({client,serviceId:meta.service.service_id});
    const original=await loader.connect({service_id:meta.service.service_id});
    assert.equal(original.contract_version,'1.3.0');
    assert.deepEqual(original.granted_operations,meta.granted_operations);
    assert.equal(Object.isFrozen(original.t1),true);
    assert.equal(Object.hasOwn(original,'rawKernel'),false);
    assert.equal((await original.t1.getWorkspace('ws:own')).workspace_id,'ws:own');
    await assert.rejects(original.t1.getWorkspace('ws:foreign'),{code:'T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE'});
    const result=await original.t1.putObject({workspace_id:'ws:own',object_id:'item:1'});
    assert.equal(result.object.workspace_id,'ws:own');
    assert.equal((await original.t0.validate({objects:[{x:1}]})).objects.length,1);
    assert.equal(authorized,3);assert.equal(written,1);
    assert.equal(ORIGINAL_KERNEL_CONTRACT_OPERATIONS.includes('t1.putObject'),true);
    assert.equal(typeof original.t2.importCommit,'function');
  }finally{client.close();host.close();}
});

test('wrong selected service and malformed original metadata are never accepted',async()=>{
  const ch=new MessageChannel(),host=bindSignedOriginalKernelPort({port:ch.port1,
    createSignedFacade:async()=>Object.freeze({getWorkspace:async()=>null}),
    describeOriginalSession:async()=>({...meta,contract_version:'1.2.0'}),
    isActive:()=>true});
  const client=createIsolatedKernelClient({port:ch.port2});
  try{
    const bootstrap=createIsolatedOriginalKernelBootstrap({client,serviceId:meta.service.service_id});
    await assert.rejects(bootstrap.connect({service_id:'iwxa.other'}),{code:'T3_D1_ORIGINAL_KERNEL_SERVICE_MISMATCH'});
    await assert.rejects(bootstrap.connect({service_id:meta.service.service_id}),{code:'T3_D1_ORIGINAL_KERNEL_DESCRIPTION_INVALID'});
  }finally{client.close();host.close();}
});