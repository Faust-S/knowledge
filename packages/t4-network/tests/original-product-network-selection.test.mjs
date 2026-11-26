import test from 'node:test';
import assert from 'node:assert/strict';
import {bindT4ProductNetworkSelection as bind,requiredT4ProductNetworkActions as actions} from '../src/network/original-product-network-selection.mjs';
const context=Object.freeze({kind:'PERSONAL',context_id:'context:person',actor_id:'person:a',principal_id:'person:a',
  role_id:'role:member',grant_id:'grant:network',realm_id:'realm:local',audience:'host:t3',resource:'ws:subject',
  purpose:'network.synchronization',workspace_id:'ws:subject',organization_id:null,scope_revision:1});
function fixture(patch={}){
  let current={...context,...patch},mode='T4_NETWORK';
  const opts={role:'SOURCE',sourceWorkspaceId:'ws:subject',expectedContext:current,currentContext:()=>current,getMode:()=>mode,
    enableSourceEventWindowRead:true,enableRecipientResultRead:true};
  return {opts,setContext:value=>{current=value;},setMode:value=>{mode=value;},get context(){return current;}};
}
const source=actions({role:'SOURCE',enableSourceEventWindowRead:true,enableRecipientResultRead:true});
const recipient=actions({role:'RECIPIENT',enableSourceEventWindowRead:true,enableRecipientResultRead:true});
test('RC.1 indexed base profile has nine minimum network actions per role',()=>{
  for(const role of ['SOURCE','RECIPIENT']){
    const list=actions({role});assert.equal(list.length,9);assert.equal(new Set(list).size,9);
    assert.ok(!list.includes('t4.network.frame.discover'));assert.ok(!list.includes('t4.network.key.manage'));
    assert.ok(!list.some(x=>x.startsWith('t1.')));assert.ok(Object.isFrozen(list));
  }
});
test('DB9 source and recipient get directional history and content actions only',()=>{
  assert.equal(source.length,11);assert.equal(recipient.length,11);
  assert.ok(source.includes('t4.network.content.seal'));assert.ok(!source.includes('t4.network.content.open'));
  assert.ok(recipient.includes('t4.network.content.open'));assert.ok(!recipient.includes('t4.network.content.seal'));
  assert.ok(source.includes('t4.network.original.source.owner.read-window'));
  assert.ok(recipient.includes('t4.network.original.source.peer.read-window'));
  assert.ok(source.includes('t4.network.original.recipient.peer.read-result'));
  assert.ok(recipient.includes('t4.network.original.recipient.owner.read-result'));
  assert.deepEqual(source.filter(x=>!recipient.includes(x)).sort(),['t4.network.content.seal',
    't4.network.original.recipient.peer.read-result','t4.network.original.source.owner.read-window'].sort());
});
test('rejects invalid role and flag types',()=>{
  for(const opts of [{role:'BOTH'},{role:'SOURCE',enableSourceEventWindowRead:1},{role:'RECIPIENT',enableRecipientResultRead:null}])
    assert.throws(()=>actions(opts),{code:'T4_PRODUCT_NETWORK_ROLE_INVALID'});
});
test('selected network purpose is separate from legacy workspace work',()=>{
  assert.throws(()=>bind(fixture({purpose:'workspace.work'}).opts),{code:'T4_PRODUCT_NETWORK_CONTEXT_INVALID'});
});
test('foreign workspace and invalid organization are refused',()=>{
  assert.throws(()=>bind(fixture({resource:'ws:other'}).opts),{code:'T4_PRODUCT_NETWORK_CONTEXT_INVALID'});
  assert.throws(()=>bind(fixture({kind:'CORP',principal_id:'org:a',organization_id:'org:b'}).opts),{code:'T4_PRODUCT_NETWORK_CONTEXT_INVALID'});
  const f=fixture({kind:'CORP',principal_id:'org:a',organization_id:'org:a'});assert.equal(bind(f.opts).selected.kind,'CORP');
});
test('no default enablement or automatic reactivation after disabling T4',()=>{
  const f=fixture();f.setMode('LOCAL_T3');assert.throws(()=>bind(f.opts),{code:'T4_PRODUCT_NETWORK_MODE_DISABLED'});
  f.setMode('T4_NETWORK');const s=bind(f.opts);f.setMode('LOCAL_T3');
  assert.throws(()=>s.current(),{code:'T4_PRODUCT_NETWORK_MODE_DISABLED'});f.setMode('T4_NETWORK');
  assert.throws(()=>s.current(),{code:'T4_PRODUCT_NETWORK_SELECTION_CLOSED'});
});
test('selected context is copied and a changed scope epoch is terminal',()=>{
  const f=fixture(),s=bind(f.opts);f.context.scope_revision=2;assert.equal(s.selected.scope_revision,1);
  assert.throws(()=>s.current(),{code:'T4_PRODUCT_NETWORK_CONTEXT_CHANGED'});f.setContext({...context});
  assert.throws(()=>s.current(),{code:'T4_PRODUCT_NETWORK_SELECTION_CLOSED'});
});
test('rejects legacy Kernel and other role actions without closing valid selection',()=>{
  const s=bind(fixture().opts);
  for(const action of ['t1.putObject','object.write','t4.network.key.manage','t4.network.content.open','t4.network.frame.discover',
    't4.network.original.source.peer.read-window','t4.network.original.recipient.owner.read-result'])
    assert.throws(()=>s.requireAction(action),{code:'T4_PRODUCT_NETWORK_ACTION_DENIED'});
  assert.equal(s.requireAction('t4.network.frame.read'),'t4.network.frame.read');
});
test('every proof field must match the exact selected grant and purpose',()=>{
  const s=bind(fixture().opts),request={action:'t4.network.frame.read',actorId:context.actor_id,principalId:context.principal_id,
    roleId:context.role_id,grantId:context.grant_id,realmId:context.realm_id,audience:context.audience,resource:context.resource,purpose:context.purpose};
  s.requireRequest(request,context);
  for(const key of Object.keys(request).filter(k=>k!=='action'))
    assert.throws(()=>s.requireRequest({...request,[key]:'foreign:value'},context),{code:'T4_PRODUCT_NETWORK_REQUEST_SCOPE_DENIED'});
  assert.throws(()=>s.requireRequest(request,{...context,grant_id:'grant:other'}),{code:'T4_PRODUCT_NETWORK_CONTEXT_CHANGED'});
  assert.throws(()=>s.requireRequest({...request,action:'t1.putObject'},context),{code:'T4_PRODUCT_NETWORK_ACTION_DENIED'});
});
test('explicit close does not reactivate and invalid initial epoch is rejected',()=>{
  const s=bind(fixture().opts);s.close();s.close();assert.throws(()=>s.requireAction(source[0]),{code:'T4_PRODUCT_NETWORK_SELECTION_CLOSED'});
  assert.throws(()=>bind(fixture({scope_revision:0}).opts),{code:'T4_PRODUCT_NETWORK_CONTEXT_INVALID'});
});
