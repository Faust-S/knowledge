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
