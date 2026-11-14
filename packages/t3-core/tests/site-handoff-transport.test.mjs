import test from 'node:test';
import assert from 'node:assert/strict';
import {launchT2SiteHandoff} from '../src/workspace-host/site-handoff/site-handoff.mjs';
import {mountT2SiteHandoffReceiver} from '../src/workspace-host/site-handoff/host-receiver.mjs';
import {HANDOFF_PROTOCOL} from '../src/workspace-host/site-handoff/protocol.mjs';

const siteOrigin='https://club.example';
const hostOrigin='https://localhost:4173';

function windowPair(){
  const listeners=new Map();
  const siteWindow={
    location:{origin:siteOrigin},
    setTimeout:()=>0,
    addEventListener(type,fn){const rows=listeners.get(type)??new Set();rows.add(fn);listeners.set(type,rows);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    dispatch(type,event){for(const fn of [...(listeners.get(type)??[])])fn(event);},
  };
  const hostListeners=new Set();
  const hostWindow={
    location:{origin:hostOrigin},
    opener:siteWindow,
    addEventListener(type,fn){if(type==='message')hostListeners.add(fn);},
    removeEventListener(type,fn){if(type==='message')hostListeners.delete(fn);},
    dispatch(event){for(const fn of [...hostListeners])fn(event);},
  };
  siteWindow.open=(url)=>{
    siteWindow.openedUrl=url;
    return hostWindow;
  };
  hostWindow.postMessage=(data,targetOrigin)=>{
    assert.equal(targetOrigin,hostOrigin);
    hostWindow.dispatch({data,origin:siteOrigin,source:siteWindow});
  };
  siteWindow.postMessage=(data,targetOrigin)=>{
    assert.equal(targetOrigin,siteOrigin);
    siteWindow.dispatch('message',{data,origin:hostOrigin,source:hostWindow});
  };
  const cryptoSource={counter:0,getRandomValues(bytes){
    const value=++this.counter;
    bytes.fill(value);
    return bytes;
  }};
  return {siteWindow,hostWindow,cryptoSource};
}

test('StrictMode setup-cleanup-setup sends one live ready nonce and transfers once',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let collected=0,previewed=0;
  const statuses=[];
  const raw='{"results":["synthetic"]}';
  const sender=launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup(){collected++;return raw;},onStatus:s=>statuses.push(s)});
  const strictModeProbe=mountT2SiteHandoffReceiver({hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource,validateSource:value=>({raw:value}),onPreview:()=>previewed++});
  strictModeProbe.dispose();
  const committedReceiver=mountT2SiteHandoffReceiver({hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource,validateSource:value=>({raw:value}),onPreview:proposal=>{
      assert.equal(proposal.raw,raw);previewed++;
    }});

  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(collected,1,'site collects only after the mounted Host receiver replies');
  assert.equal(previewed,1,'live receiver previews the candidate once');
  assert.equal(sender.awaitingReady,false);
  assert.deepEqual(statuses,['CANDIDATE_SENT_REQUIRES_HOST_CONFIRMATION']);
  assert.equal(committedReceiver.consumed,true);
  const readyNonce=cryptoSource.counter.toString(16).padStart(2,'0').repeat(24);
  hostWindow.dispatch({data:{protocol:HANDOFF_PROTOCOL,kind:'candidate',nonce:readyNonce,raw},
    origin:siteOrigin,source:siteWindow});
  assert.equal(previewed,1,'replayed one-time nonce is ignored');
});

test('remount rotates nonce; stale, wrong-origin, and wrong-window messages are ignored',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  const ready=[];
  siteWindow.addEventListener('message',event=>ready.push(event.data));
  let previewed=0;
  const first=mountT2SiteHandoffReceiver({hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource,validateSource:value=>value,onPreview:()=>previewed++});
  await new Promise(resolve=>queueMicrotask(resolve));
  const oldNonce=ready.at(-1).nonce;
  first.dispose();

  const second=mountT2SiteHandoffReceiver({hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource,validateSource:value=>value,onPreview:()=>previewed++});
  await new Promise(resolve=>queueMicrotask(resolve));
  const freshNonce=ready.at(-1).nonce;
  assert.notEqual(freshNonce,oldNonce);
  const candidate=nonce=>({protocol:HANDOFF_PROTOCOL,kind:'candidate',nonce,raw:'{}'});
  hostWindow.dispatch({data:candidate(oldNonce),origin:siteOrigin,source:siteWindow});
  hostWindow.dispatch({data:candidate(freshNonce),origin:'https://attacker.example',source:siteWindow});
  hostWindow.dispatch({data:candidate(freshNonce),origin:siteOrigin,source:{}});
  assert.equal(previewed,0);
  hostWindow.dispatch({data:candidate(freshNonce),origin:siteOrigin,source:siteWindow});
  hostWindow.dispatch({data:candidate(freshNonce),origin:siteOrigin,source:siteWindow});
  assert.equal(previewed,1);
  assert.equal(second.consumed,true);
});

test('Host receipt requires a live preview and site application is acknowledged',async()=>{
 const {siteWindow,hostWindow,cryptoSource}=windowPair();
 let applied=0;
 const sender=launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
  collectRawBackup:()=>'{"update":true}',
  onReceipt:raw=>{assert.equal(JSON.parse(raw).revision,2);applied++;}
 });
 const observed=[];
 const receiver=mountT2SiteHandoffReceiver({hostWindow,expectedSiteOrigin:siteOrigin,
  cryptoSource,validateSource:JSON.parse,onPreview:()=>{},
  onStatus:value=>observed.push(value)});
 assert.throws(()=>receiver.sendReceipt('{"revision":2}'),/RECEIPT_NOT_READY/);
 await new Promise(resolve=>queueMicrotask(resolve));
 receiver.sendReceipt('{"revision":2}');
 assert.equal(applied,1);
 assert.equal(receiver.consumed,true);
 assert.equal(receiver.sent,undefined);
 assert.equal(sender.awaitingReceipt,false);
 assert.ok(observed.includes('WRITE_RECEIPT_SITE_APPLIED'));
 assert.throws(()=>receiver.sendReceipt('{"revision":3}'),/RECEIPT_NOT_READY/);
});

test('asynchronous signed source validation and Host preview gate receipt until both finish',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let finishValidation,finishPresentation,previewed=0,applied=0;
  const observed=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"signedResult":"candidate"}',
    onReceipt:raw=>{assert.equal(JSON.parse(raw).revision,2);applied++;}});
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:()=>new Promise(resolve=>{finishValidation=resolve;}),
    onPreview:preview=>{
      assert.equal(preview.verified,true);
      previewed++;
      return new Promise(resolve=>{finishPresentation=resolve;});
    },
    onStatus:status=>observed.push(status),
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(previewed,0);
  assert.throws(()=>receiver.sendReceipt('{"revision":2}'),/RECEIPT_NOT_READY/);
  finishValidation({verified:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(previewed,1);
  assert.throws(()=>receiver.sendReceipt('{"revision":2}'),/RECEIPT_NOT_READY/);
  assert.equal(observed.includes('CANDIDATE_READY_FOR_EXPLICIT_REVIEW'),false);
  finishPresentation();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(observed.includes('CANDIDATE_READY_FOR_EXPLICIT_REVIEW'),true);
  receiver.sendReceipt('{"revision":2}');
  assert.equal(applied,1);
});

test('rejected asynchronous validation and disposed Host never expose a receipt',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let rejectValidation,previewed=0;
  const observed=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"signedResult":"untrusted"}'});
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:()=>new Promise((_,reject)=>{rejectValidation=reject;}),
    onPreview:()=>{previewed++;},onStatus:s=>observed.push(s),
  });
  await new Promise(resolve=>setImmediate(resolve));
  rejectValidation(new Error('UNTRUSTED_SIGNATURE'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(previewed,0);
  assert.ok(observed.includes('CANDIDATE_REJECTED_NO_WRITE'));
  assert.throws(()=>receiver.sendReceipt('{}'),/RECEIPT_NOT_READY/);

  const second=windowPair();
  let finishStale,stalePreviews=0;
  launchT2SiteHandoff({siteWindow:second.siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"signedResult":"stale"}'});
  const previous=mountT2SiteHandoffReceiver({
    hostWindow:second.hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource:second.cryptoSource,
    validateSource:()=>new Promise(resolve=>{finishStale=resolve;}),
    onPreview:()=>{stalePreviews++;},
  });
  await new Promise(resolve=>setImmediate(resolve));
  previous.dispose();
  finishStale({verified:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stalePreviews,0);
  assert.throws(()=>previous.sendReceipt('{}'),/RECEIPT_NOT_READY/);
});

test('site acknowledges write receipt only after asynchronous original Kernel persistence',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let commit,fail;
  const siteStatus=[],hostStatus=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"result":"selected"}',
    onReceipt:()=>new Promise((resolve,reject)=>{commit=resolve;fail=reject;}),
    onStatus:status=>siteStatus.push(status),
  });
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:JSON.parse,onPreview:()=>{},
    onStatus:status=>hostStatus.push(status),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  receiver.sendReceipt('{"revision":3}');
  assert.ok(!hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED'));
  assert.ok(!siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  commit();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED'));
  assert.ok(siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  assert.equal(typeof fail,'function');
});

test('asynchronously failed receipt never gets APPLIED acknowledgement',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let rejectWrite;
  const siteStatus=[],hostStatus=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"result":"selected"}',
    onReceipt:()=>new Promise((_,reject)=>{rejectWrite=reject;}),
    onStatus:status=>siteStatus.push(status),
  });
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:JSON.parse,onPreview:()=>{},
    onStatus:status=>hostStatus.push(status),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  receiver.sendReceipt('{"revision":3}');
  assert.ok(!hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED'));
  rejectWrite(new Error('KERNEL_READBACK_FAILED'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(hostStatus.includes('WRITE_RECEIPT_SITE_REJECTED'));
  assert.ok(siteStatus.includes('WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED'));
  assert.ok(!siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
});

test('explicit synchronous and asynchronous owner refusals never produce APPLIED',async()=>{
  for(const result of [false,{status:'REJECTED'},{applied:false},
    {status:'PENDING'},Promise.resolve({status:'INCOMPLETE'}),
    Promise.resolve(false)]){
    const {siteWindow,hostWindow,cryptoSource}=windowPair();
    const siteStatus=[],hostStatus=[];
    launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
      collectRawBackup:()=>'{"task":"accepted-but-not-applied"}',
      onReceipt:()=>result,onStatus:s=>siteStatus.push(s),
    });
    const receiver=mountT2SiteHandoffReceiver({
      hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
      validateSource:JSON.parse,onPreview:()=>{},
      onStatus:s=>hostStatus.push(s),
    });
    await new Promise(resolve=>queueMicrotask(resolve));
    receiver.sendReceipt('{"result":"pending"}');
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(hostStatus.includes('WRITE_RECEIPT_SITE_REJECTED'),
      'expected rejection for '+JSON.stringify(result));
    assert.ok(!hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED'));
    assert.ok(siteStatus.includes('WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED'));
    assert.ok(!siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  }
});

test('explicitly rejected preview, including async refusal, cannot enable sendReceipt',async()=>{
  for(const mode of ['source-false','source-async-false',
    'source-denied-object','source-async-denied','source-missing',
    'preview-false','preview-async-reject','preview-denied-object']){
    const {siteWindow,hostWindow,cryptoSource}=windowPair();
    const observed=[];
    launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
      collectRawBackup:()=>'{"result":"untrusted"}'});
    const receiver=mountT2SiteHandoffReceiver({
      hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
      validateSource:()=>mode==='source-false'?false:
        mode==='source-async-false'?Promise.resolve(false):
        mode==='source-denied-object'?{allowed:false}:
        mode==='source-async-denied'?Promise.resolve({status:'UNTRUSTED'}):
        mode==='source-missing'?undefined:{verified:true},
      onPreview:()=>mode==='preview-false'?false:
        mode==='preview-async-reject'?Promise.resolve(false):
          {allowed:false},
      onStatus:s=>observed.push(s),
    });
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(receiver.consumed,true);
    assert.ok(observed.includes('CANDIDATE_REJECTED_NO_WRITE'),mode);
    assert.ok(!observed.includes('CANDIDATE_READY_FOR_EXPLICIT_REVIEW'),mode);
    assert.throws(()=>receiver.sendReceipt('{"revision":2}'),
      /T2_HANDOFF_RECEIPT_NOT_READY/,mode);
  }
});

test('synchronous writer failure after side effect is unresolved, not SOURCE_UNCHANGED',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let writeAttempted=0;
  const siteStatus=[],hostStatus=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"result":"selected"}',
    onReceipt:()=>{writeAttempted++;throw new Error('READBACK_AFTER_COMMIT_FAILED');},
    onStatus:s=>siteStatus.push(s),
  });
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:JSON.parse,onPreview:()=>{},
    onStatus:s=>hostStatus.push(s),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  receiver.sendReceipt('{"revision":6}');
  assert.equal(writeAttempted,1);
  assert.ok(hostStatus.includes('WRITE_RECEIPT_SITE_REJECTED'));
  assert.ok(siteStatus.includes('WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED'));
  assert.ok(!siteStatus.includes('WRITE_RECEIPT_REJECTED_SOURCE_UNCHANGED'));
  assert.ok(!siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
});

test('reconciliation HOLD or unknown application status cannot be reported APPLIED',async()=>{
  for(const value of [{status:'HOLD_FOR_EXPLICIT_RECOVERY'},
    {status:'UNKNOWN_EVIDENCE'},{status:'COMMITTED'},{status:'BLOCKED'},
    null,Promise.resolve({status:'NOT_AUTHORIZED'})]){
    const {siteWindow,hostWindow,cryptoSource}=windowPair();
    const states=[],acks=[];
    launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
      collectRawBackup:()=>'{"source":"accepted-only"}',
      onReceipt:()=>value,onStatus:s=>states.push(s)});
    const receiver=mountT2SiteHandoffReceiver({
      hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
      validateSource:JSON.parse,onPreview:()=>{},
      onStatus:s=>acks.push(s)});
    await new Promise(resolve=>queueMicrotask(resolve));
    receiver.sendReceipt('{"source":"accepted-only"}');
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(acks.includes('WRITE_RECEIPT_SITE_REJECTED'),String(value?.status??value));
    assert.ok(!acks.includes('WRITE_RECEIPT_SITE_APPLIED'));
    assert.ok(states.includes('WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED'));
    assert.ok(!states.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  }
});

test('owner source BLOCKED and preview UNKNOWN cannot authorize receipt',async()=>{
  for(const mode of ['source-blocked','source-hold','preview-unresolved',
    'preview-expired','source-verified-false']){
    const {siteWindow,hostWindow,cryptoSource}=windowPair();
    const states=[];
    launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
      collectRawBackup:()=>'{"source":"candidate"}'});
    const receiver=mountT2SiteHandoffReceiver({
      hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
      validateSource:()=>mode==='source-blocked'?{status:'BLOCKED'}:
        mode==='source-hold'?Promise.resolve({status:'HOLD_FOR_EXPLICIT_RECOVERY'}):
        mode==='source-verified-false'?{verified:false}:{verified:true},
      onPreview:()=>mode==='preview-unresolved'?{status:'UNKNOWN_EVIDENCE'}:
        mode==='preview-expired'?Promise.resolve({status:'EXPIRED'}):undefined,
      onStatus:s=>states.push(s)});
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(states.includes('CANDIDATE_REJECTED_NO_WRITE'),mode);
    assert.ok(!states.includes('CANDIDATE_READY_FOR_EXPLICIT_REVIEW'),mode);
    assert.throws(()=>receiver.sendReceipt('{}'),/RECEIPT_NOT_READY/,mode);
  }
});

test('an explicit signed-owner denial is never converted to APPLIED by a receipt callback',async()=>{
  for(const decision of [
    {accepted:false},{allowed:false},{verified:false},
    {ok:false,status:'APPLIED'},
    {applied:false,status:'APPLIED'},
    Promise.resolve({accepted:false,status:'APPLIED'}),
    Promise.resolve({verified:false,status:'APPLIED'}),
  ]){
    const {siteWindow,hostWindow,cryptoSource}=windowPair();
    const statuses=[],ack=[];
    launchT2SiteHandoff({
      siteWindow,hostUrl:hostOrigin+'/workspace/',
      collectRawBackup:()=>'{"task":"selected"}',
      onReceipt:()=>decision,onStatus:x=>statuses.push(x),
    });
    const receiver=mountT2SiteHandoffReceiver({
      hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
      validateSource:JSON.parse,onPreview:()=>{},
      onStatus:x=>ack.push(x),
    });
    await new Promise(resolve=>queueMicrotask(resolve));
    receiver.sendReceipt('{"kernel_result":"requires_owner_decision"}');
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(ack.includes('WRITE_RECEIPT_SITE_REJECTED'),JSON.stringify(decision));
    assert.ok(!ack.includes('WRITE_RECEIPT_SITE_APPLIED'));
    assert.ok(statuses.includes('WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED'));
    assert.ok(!statuses.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  }
});

test('T3 owner readback gates BOTH Host receipt delivery and originating Site APPLIED',async()=>{
  const {siteWindow,hostWindow,cryptoSource}=windowPair();
  let confirmHost,confirmSite,siteWriterCalls=0,siteVerifierCalls=0;
  const hostStatus=[],siteStatus=[];
  launchT2SiteHandoff({siteWindow,hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"result":"accepted-by-owner"}',
    onReceipt:raw=>{siteWriterCalls++;assert.match(raw,/kernel-receipt/);},
    verifyAppliedReceipt:raw=>{
      siteVerifierCalls++;
      assert.match(raw,/kernel-receipt/);
      return new Promise(resolve=>{confirmSite=resolve;});
    },
    onStatus:value=>siteStatus.push(value),
  });
  const receiver=mountT2SiteHandoffReceiver({
    hostWindow,expectedSiteOrigin:siteOrigin,cryptoSource,
    validateSource:JSON.parse,onPreview:()=>{},
    verifyAppliedBeforeSend:raw=>{
      assert.match(raw,/kernel-receipt/);
      return new Promise(resolve=>{confirmHost=resolve;});
    },
    onStatus:value=>hostStatus.push(value),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  const pending=receiver.sendReceipt('{"kernel-receipt":"actual"}');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(siteWriterCalls,0,'unverified Host must not deliver a receipt');
  assert.throws(()=>receiver.sendReceipt('{"kernel-receipt":"replay"}'),/NOT_READY/);
  confirmHost(true);
  assert.equal(await pending,true);
  assert.equal(siteWriterCalls,1);
  assert.equal(siteVerifierCalls,1);
  assert.ok(!siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  assert.ok(!hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED'));
  confirmSite(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(siteStatus.includes('WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE'));
  assert.ok(hostStatus.includes('WRITE_RECEIPT_SITE_APPLIED_VERIFIED'));

  const denied=windowPair();
  let received=0;
  launchT2SiteHandoff({siteWindow:denied.siteWindow,
    hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"selected":"result"}',
    onReceipt:()=>{received++;},
  });
  const states=[];
  const reject=mountT2SiteHandoffReceiver({
    hostWindow:denied.hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource:denied.cryptoSource,validateSource:JSON.parse,
    onPreview:()=>{},verifyAppliedBeforeSend:async()=>false,
    onStatus:s=>states.push(s),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(await reject.sendReceipt('{"kernel-receipt":"not-applied"}'),false);
  assert.equal(received,0);
  assert.ok(states.includes('WRITE_RECEIPT_HOST_APPLICATION_NOT_CONFIRMED'));

  const legacy=windowPair(),unconfirmed=[];
  launchT2SiteHandoff({siteWindow:legacy.siteWindow,
    hostUrl:hostOrigin+'/workspace/',
    collectRawBackup:()=>'{"task":"legacy-saved"}',
    onReceipt:()=>undefined, // T2 legacy ACK without Kernel readback evidence.
  });
  const strictReceiver=mountT2SiteHandoffReceiver({
    hostWindow:legacy.hostWindow,expectedSiteOrigin:siteOrigin,
    cryptoSource:legacy.cryptoSource,validateSource:JSON.parse,
    onPreview:()=>{},verifyAppliedBeforeSend:async()=>true,
    onStatus:s=>unconfirmed.push(s),
  });
  await new Promise(resolve=>queueMicrotask(resolve));
  assert.equal(await strictReceiver.sendReceipt('{"kernel-receipt":"verified"}'),true);
  assert.ok(unconfirmed.includes('WRITE_RECEIPT_SITE_APPLICATION_NOT_CONFIRMED'));
  assert.ok(!unconfirmed.includes('WRITE_RECEIPT_SITE_APPLIED_VERIFIED'));
});
