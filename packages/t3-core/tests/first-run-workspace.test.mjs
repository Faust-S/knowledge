import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findExistingFirstRunWorkspace as find,
  provisionFirstRunWorkspace as create,
  selectFirstRunProvisioner as select,
} from '../src/workspace-host/bootstrap/first-run-workspace.ts';
const ws='ws-11111111-1111-4111-8111-111111111111';
const record=(id=ws,profile='personal')=>({workspace_id:id,profile,deleted_at:null,read_only:false});
const domain=(origin='https://localhost:8443')=>({origin,modules:[
  {service_id:'test.workspace',base_path:'/workspace/'},
  {service_id:'test.provisioner',base_path:'/workspace/',host_role:'workspace-first-run-provisioner',provisioning_scope:'https-loopback-development-only'},
]});
function setup(){
  const store=new Map();let createCount=0;
  const ops=new Set(['t1.listWorkspaces','t1.getWorkspace','t1.createWorkspace']);
  const base={hasOperation:o=>ops.has(o),listWorkspaces:async()=>[...store.values()],getWorkspace:async id=>store.get(id)??null};
  return {store,ops,primary:{...base},provisioner:{...base,createWorkspace:async o=>{
    createCount++;const row=record(o.workspace_id,o.profile);store.set(o.workspace_id,row);return row;
  }},calls:()=>createCount};
}
const request=(s,id=ws,profile='personal')=>({primary:s.primary,provisioner:s.provisioner,workspaceId:id,profile});
test('first-run opt-in needs explicit HTTPS loopback registration',()=>{
  assert.equal(select({origin:domain().origin,modules:[]},'test.workspace',domain().origin).status,'disabled');
  assert.equal(select(domain(),'test.workspace',domain().origin).status,'enabled');
  assert.equal(select(domain('https://example.org'),'test.workspace','https://example.org').status,'blocked');
  assert.equal(select(domain(),'test.workspace','http://localhost:8443').status,'blocked');
  const d=domain();d.modules.push({...d.modules[1]});assert.equal(select(d,'test.workspace',d.origin).status,'blocked');
});
test('empty list does not create anything',async()=>{let s=setup();assert.equal(await find(s.primary,'personal'),false);assert.equal(s.store.size,0);});
test('create only after explicit call and read back through both services',async()=>{
  const s=setup(),r=await create(request(s));assert.equal(r.status,'created');assert.equal(s.calls(),1);
  assert.deepEqual(await s.primary.getWorkspace(ws),r.workspace);
});
test('existing exact-profile workspace avoids a second write',async()=>{
  const s=setup();s.store.set(ws,record());const r=await create(request(s,'ws-second','personal'));
  assert.equal(r.status,'existing');assert.equal(s.calls(),0);assert.equal(r.workspace.profile,'personal');
});
test('foreign profile cannot satisfy a new profile, but can coexist',async()=>{
  const s=setup();s.store.set(ws,record(ws,'organization'));
  assert.equal(await find(s.primary,'personal'),false);
  const id='ws-22222222-2222-4222-8222-222222222222';
  assert.equal((await create(request(s,id))).workspace.workspace_id,id);
  assert.equal(s.store.size,2);assert.equal(s.calls(),1);
});
test('read-only Workspace never counts as a writable first-run Workspace',async()=>{
  const s=setup();s.store.set(ws,{...record(),read_only:true});
  assert.equal(await find(s.primary,'personal'),false);
  assert.equal((await create(request(s,'ws-2222'))).status,'created');
});
test('a denied list is not treated as an empty list',async()=>{
  const s=setup();s.primary.listWorkspaces=async()=>{throw new Error('CAPABILITY_DENIED')};
  await assert.rejects(find(s.primary,'personal'),/CAPABILITY_DENIED/);
  await assert.rejects(create(request(s)),/CAPABILITY_DENIED/);assert.equal(s.calls(),0);
});
test('a visible but unreadable Workspace fails closed',async()=>{
  const s=setup();s.store.set(ws,record());s.primary.getWorkspace=async()=>null;
  await assert.rejects(find(s.primary,'personal'),/READBACK_MISMATCH/);
  await assert.rejects(create(request(s,'ws-2222')),/READBACK_MISMATCH/);
  assert.equal(s.calls(),0);
});
test('provisioner-only Workspace cannot silently become a domain Workspace',async()=>{
  const s=setup();s.store.set(ws,record());s.primary.listWorkspaces=async()=>[];s.primary.getWorkspace=async()=>null;
  await assert.rejects(create(request(s,'ws-2222')),/WORKSPACE_NOT_VISIBLE_TO_DOMAIN/);
  assert.equal(s.calls(),0);
});
test('creation requires granted primitive, not a UI permission',async()=>{
  const s=setup();s.provisioner.hasOperation=o=>o!=='t1.createWorkspace';
  await assert.rejects(create(request(s)),/CREATE_OPERATION_NOT_GRANTED/);assert.equal(s.calls(),0);
});
test('lost acknowledgement reads back exactly one persisted creation',async()=>{
  const s=setup(),real=s.provisioner.createWorkspace;
  s.provisioner.createWorkspace=async x=>{await real(x);throw new Error('LOST_ACK')};
  const r=await create(request(s));assert.equal(r.status,'created');assert.equal(s.calls(),1);assert.equal(s.store.size,1);
});
test('creation failure never becomes a fake PASS',async()=>{
  const s=setup();s.provisioner.createWorkspace=async()=>{throw new Error('DENIED')};
  await assert.rejects(create(request(s)),/CREATE_UNCONFIRMED_KEEP_WORKSPACE_ID/);assert.equal(s.store.size,0);
});
test('retry of pending ID does not issue another write after a lost acknowledgement',async()=>{
  const s=setup();s.store.set(ws,record());s.primary.listWorkspaces=async()=>[];s.provisioner.listWorkspaces=async()=>[];
  const r=await create(request(s));assert.equal(r.status,'recovered');assert.equal(s.calls(),0);
});
test('invalid profile, cross-profile or read-only readback never claims success',async()=>{
  const s=setup();await assert.rejects(find(s.primary,''),/PROFILE_REQUIRED/);
  s.provisioner.createWorkspace=async x=>{const row=record(x.workspace_id,'organization');s.store.set(x.workspace_id,row);return row;};
  await assert.rejects(create(request(s)),/READBACK_MISMATCH/);
});
test('failed post-commit domain readback blocks success',async()=>{
  const s=setup();s.primary.getWorkspace=async()=>null;
  await assert.rejects(create(request(s)),/READBACK_MISMATCH/);assert.equal(s.store.size,1);
});
