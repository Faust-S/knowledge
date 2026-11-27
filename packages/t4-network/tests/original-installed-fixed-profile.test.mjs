import test from 'node:test';
import assert from 'node:assert/strict';
import {assertT4InstalledProductProfile as admit,requiredT4ProductNetworkActions as actions,bindT4ProductNetworkSelection as bind} from '../src/network/original-product-network-selection.mjs';
const profile=(role='SOURCE')=>({role,getMode:()=> 'T4_NETWORK',enableSourceEventWindowRead:true,
  enableSourceCaptureBinding:true,enableRecipientResultRead:true});
for(const role of ['SOURCE','RECIPIENT']){
  test(role+' accepts only an explicit network mode with original independent evidence',()=>{
    const p=profile(role);assert.equal(admit(p),p);
    const a=actions(p);assert.equal(a.length,11);
    assert.ok(a.includes(role==='SOURCE'?'t4.network.original.source.owner.read-window':'t4.network.original.source.peer.read-window'));
    assert.ok(a.includes(role==='SOURCE'?'t4.network.original.recipient.peer.read-result':'t4.network.original.recipient.owner.read-result'));
    assert.throws(()=>admit({...p,getMode:()=> 'LOCAL_T3'}),{code:'T4_INSTALLED_PRODUCT_NETWORK_MODE_REQUIRED'});
    for(const k of ['enableSourceEventWindowRead','enableSourceCaptureBinding','enableRecipientResultRead']){
      assert.throws(()=>admit({...p,[k]:false}),{code:'T4_INSTALLED_PRODUCT_ORIGINAL_EVIDENCE_REQUIRED'});
      const q={...p};delete q[k];assert.throws(()=>admit(q),{code:'T4_INSTALLED_PRODUCT_ORIGINAL_EVIDENCE_REQUIRED'});
    }
  });
  test(role+' rejects unsupported DB9 and replacement attempts before transport admission',()=>{
    for(const k of ['enableOriginalCommitOrder','enableOriginalTechnicalObjectHistory','enableOriginalObjectCatalogWindow',
      'enableOriginalRecipientFrontierCommitOrder','enableOriginalDispatchEvidence','enableOriginalMultipartNegotiation',
      'enableOriginalReplacementMultipartNegotiation','enableOriginalReplacementAttempts']){
      const p=profile(role);assert.equal(admit({...p,[k]:false})[k],false);
      for(const value of [true,'false',null])assert.throws(()=>admit({...p,[k]:value}),{code:'T4_INSTALLED_PRODUCT_EXTENDED_PROFILE_NOT_QUALIFIED'});
    }
  });
}
test('switching to T3 closes the T4 selection and does not silently reactivate it',()=>{
  let mode='T4_NETWORK';const p=profile();p.getMode=()=>mode;
  const c={kind:'CORP',context_id:'ctx:1',actor_id:'person:1',principal_id:'org:1',role_id:'reviewer',grant_id:'grant:1',
    realm_id:'realm:1',audience:'audience:1',resource:'ws:1',purpose:'network.synchronization',workspace_id:'ws:1',organization_id:'org:1',scope_revision:1};
  const selected=bind({...admit(p),sourceWorkspaceId:'ws:1',expectedContext:c,currentContext:()=>c});
  selected.current();mode='LOCAL_T3';
  assert.throws(()=>selected.current(),{code:'T4_PRODUCT_NETWORK_MODE_DISABLED'});
  mode='T4_NETWORK';assert.throws(()=>selected.current(),{code:'T4_PRODUCT_NETWORK_SELECTION_CLOSED'});
  assert.equal(bind({...admit(p),sourceWorkspaceId:'ws:1',expectedContext:c,currentContext:()=>c}).current().context_id,'ctx:1');
});
