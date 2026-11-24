import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {decodeT4WebDavFrameAddressList} from '../src/network/webdav-frame-address-list.mjs';
import {createWebDavPackageTransport} from '../src/network/webdav-package-transfer.mjs';
import {createT4CandidateFrameTransport} from '../src/network/standard-network-wire-transport.mjs';
import {createT4CandidateUnsignedFrame,signT4CandidateFrame} from '../src/network/standard-network-wire-candidate.mjs';
const base='https://example.invalid/peer/',collection='/peer/';
const key=c=>c.repeat(64)+'.t4n',a=key('a'),b=key('b');
const xml=s=>Buffer.from(s,'utf8');
const resource=(href,type='',status='HTTP/1.1 200 OK')=>
  '<D:response><D:href>'+href+'</D:href><D:propstat><D:prop><D:resourcetype>'+
  type+'</D:resourcetype></D:prop><D:status>'+status+'</D:status></D:propstat></D:response>';
const root=resource(collection,'<D:collection/>');
const listing=(...rows)=>xml('<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">'+rows.join('')+'</D:multistatus>');
const code=c=>e=>{assert.equal(e?.code,c,String(e));return true;};
const policy={objectFamily:'owner-exported-package',workspaceId:'ws:one',
  authorityRoot:'owner:root',writeOwnerRef:'owner:write',
  primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['dav:one'],
  retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false};
test('DAV namespace-aware listing accepts only canonical flat immutable frame files and stable list digest',()=>{
  const x=decodeT4WebDavFrameAddressList(listing(resource(base+b),root,resource(collection+'nonwire.iwxa'),
    resource(collection+'child/','<D:collection/>'),resource(collection+a)),base);
  assert.deepEqual(x.addresses.map(v=>v.key),[a,b]);
  assert.equal(x.listingDigest,decodeT4WebDavFrameAddressList(listing(root,resource(collection+a),resource(collection+b)),base).listingDigest);
  assert.equal(x.originalBusinessApplied,false);
  assert.equal(x.addressMetadataIsNotSignatureOrAuthority,true);
  const defaultNs=listing(root,resource(collection+a)).toString().replaceAll('D:','').replace('xmlns:D=','xmlns=');
  assert.deepEqual(decodeT4WebDavFrameAddressList(xml(defaultNs),base).addresses,[{key:a,sha256:a.slice(0,-4)}]);
});
test('DAV rejects foreign origin, traversal, encoded separators, non-direct children and query URLs',()=>{
  for(const [href,expected] of [
    ['https://elsewhere.invalid/peer/'+a,'DAV_FRAME_LIST_HREF_INVALID'],
    ['/other/'+a,'DAV_FRAME_LIST_SCOPE_MISMATCH'],
    [collection+'nested/'+a,'DAV_FRAME_LIST_NOT_DIRECT_CHILD'],
    [collection+'%2e%2e/'+a,'DAV_FRAME_LIST_HREF_INVALID'],
    [collection+'a%2fb/'+a,'DAV_FRAME_LIST_HREF_INVALID'],
    [collection+a+'?token=1','DAV_FRAME_LIST_HREF_INVALID'],
    ['//example.invalid/peer/'+a,'DAV_FRAME_LIST_HREF_INVALID'],
  ])assert.throws(()=>decodeT4WebDavFrameAddressList(listing(root,resource(href)),base),code(expected));
});
test('DAV rejects duplicates, failed properties, collection pretending to be frame and missing root',()=>{
  for(const [rows,expected] of [
    [[root,resource(collection+a),resource(base+a)],'DAV_FRAME_LIST_DUPLICATE_RESOURCE'],
    [[root,resource(collection+a,'','HTTP/1.1 404 Not Found')],'DAV_FRAME_LIST_RESOURCE_TYPE_UNPROVEN'],
    [[root,resource(collection+a+'/','<D:collection/>')],'DAV_FRAME_LIST_FRAME_NOT_FILE'],
    [[resource(collection+a)],'DAV_FRAME_LIST_RESPONSE_INCOMPLETE'],
    [[resource(collection)],'DAV_FRAME_LIST_ROOT_INVALID'],
    [[root,resource(collection+a,'<D:collection/><D:collection/>')],'DAV_FRAME_LIST_RESOURCE_TYPE_UNPROVEN'],
  ])assert.throws(()=>decodeT4WebDavFrameAddressList(listing(...rows),base),code(expected));
});
test('DAV refuses DTD, malformed markup and wrong namespace rather than interpreting as empty list',()=>{
  assert.throws(()=>decodeT4WebDavFrameAddressList(xml('<!DOCTYPE D:multistatus [<!ENTITY x "evil">]><D:multistatus xmlns:D="DAV:">'+root+'</D:multistatus>'),base),code('DAV_FRAME_LIST_DTD_FORBIDDEN'));
  assert.throws(()=>decodeT4WebDavFrameAddressList(xml('<D:multistatus xmlns:D="DAV:">'),base),code('DAV_FRAME_LIST_XML_INVALID'));
  assert.throws(()=>decodeT4WebDavFrameAddressList(xml('<D:multistatus xmlns:D="urn:other"/>'),base),code('DAV_FRAME_LIST_XML_INVALID'));
});
function raw(overrides={}){
  return createWebDavPackageTransport({baseUrl:base,locationRef:'dav:one',placementPolicy:policy,
    keySuffix:'.t4n',candidateNetworkWire:true,getMode:()=> 'T4_NETWORK',
    authorize:async()=>true,getAuthorizationHeader:async()=> 'Basic dGVzdA==',
    fetchImpl:async()=>new Response(listing(root,resource(collection+a)),{status:207,
      headers:{'content-type':'application/xml; charset=utf-8'}}),...overrides});
}
test('PROPFIND targets configured collection, Depth 1 and separate original discovery grant',async()=>{
  const proofs=[],calls=[];
  const t=raw({authorize:async p=>{proofs.push(p);return p.operation==='t4.network.frame.discover';},
    fetchImpl:async(url,options)=>{calls.push({url:url.href,method:options.method,depth:options.headers.Depth});
      return new Response(listing(root,resource(collection+a)),{status:207,headers:{'content-type':'text/xml'}});}});
  const result=await t.listNativeFrameAddresses();
  assert.deepEqual(calls,[{url:base,method:'PROPFIND',depth:'1'}]);
  assert.equal(result.addresses.length,1);
  assert.ok(proofs.every(p=>p.collectionOnly===true&&p.depth===1&&!Object.hasOwn(p,'key')));
  t.close();
});
test('discovery has no automatic redirect or cross-collection credential reuse',async()=>{
  let calls=0;
  const t=raw({fetchImpl:async(u,o)=>{calls++;assert.equal(o.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://other.invalid'}});}});
  await assert.rejects(t.listNativeFrameAddresses(),code('REDIRECT_REFUSED'));
  assert.equal(calls,1);
  assert.equal(raw({keySuffix:'.iwxa',candidateNetworkWire:false}).listNativeFrameAddresses,undefined);
  t.close();
});
test('original Host loss during WebDAV credential acquisition prevents even the initial request',async()=>{
  let active=true,requests=0;
  const t=raw({getAuthorizationHeader:async()=>{active=false;return 'Basic dGVzdA==';},
    fetchImpl:async()=>{requests++;throw Error('should not call network');}});
  const scoped=t.forOriginalHostLifetime(()=>active);
  await assert.rejects(scoped.listNativeFrameAddresses(),code('ORIGINAL_HOST_LIFETIME_ENDED'));
  active=true;
  await assert.rejects(scoped.listNativeFrameAddresses(),code('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.equal(requests,0);t.close();
});
const suite='X25519_AES256GCM_ED25519',keys=generateKeyPairSync('ed25519'),hash=x=>createHash('sha256').update(x).digest('hex');
async function fixture(){
  let serial=0,active=true,network=true,allow=true,authorized=true;
  const entries=new Map(),replay=new Map(),reads=[],ops=[],stats={signatures:0,replayWrites:0,lists:0};
  const add=async(overrides={})=>{
    const unsigned=createT4CandidateUnsignedFrame({messageType:'HEADS',messageId:'message:'+ ++serial,
      sourceNodeRef:'node:peer',recipientNodeRef:'node:local',scopeRef:'scope:one',
      sessionRef:'session:one',permissionRef:'access:one',signerRef:'key:one',ownerEpoch:2,
      sequence:serial,cryptoSuite:suite,body:{familyRef:'family:one',ownerEpoch:2,heads:[]},...overrides});
    const bytes=await signT4CandidateFrame({unsignedFrame:unsigned,signOriginalNodeBytes:async p=>
      sign(null,Buffer.from(p.bytes),keys.privateKey)});
    const id=hash(bytes)+'.t4n';entries.set(id,bytes);return {id,unsigned,bytes};
  };
  const buildList=()=>{
    const names=[...entries.keys()].sort(),listingDigest=createHash('sha256')
      .update('IWXA-T4-FRAME-ADDRESS-LIST-V1\0').update(JSON.stringify(names)).digest('hex');
    return {schema:'IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1',addresses:names.map(key=>({key,sha256:key.slice(0,-4)})),
      listingDigest,collectionEnumerated:true,addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false};
  };
  const ports={
    wireTransport:{wireKind:'T4_NETWORK_CANDIDATE',forOriginalHostLifetime(){return this;},
      putSnapshot:async()=>{throw Error('no write');},inspectOutcome:async()=>{throw Error('no inspect');},
      async listNativeFrameAddresses(){stats.lists++;return buildList();},
      async getSnapshot({key}){reads.push(key);return {bytes:entries.get(key)};}},
    getMode:()=>network?'T4_NETWORK':'LOCAL_T3',originalHostNodeRef:'node:local',originalHostScopeRef:'scope:one',
    readOriginalHostContext:async()=>({nodeRef:'node:local',scopeRef:'scope:one',originalOwnerRef:'owner:one',hostSessionRef:'host:one'}),
    authorizeOriginalHostWire:async p=>{ops.push(p.operation);return allow;},
    verifyOriginalNodeSignature:async p=>{stats.signatures++;return verify(null,Buffer.from(p.bytes),keys.publicKey,Buffer.from(p.signature));},
    authorizeOriginalNetwork:async()=>authorized,
    persistOriginalReplayDecision:async p=>{stats.replayWrites++;const id=[p.sourceNodeRef,p.sessionRef,p.ownerEpoch,p.sequence].join(':');
      if(replay.has(id))return replay.get(id)===p.frameDigest?'SEEN_EXACT':'CONFLICT';
      replay.set(id,p.frameDigest);return 'RECORDED';},
  };
  const selector={sourceNodeRef:'node:peer',ownerEpoch:2,sessionRef:'session:one',messageType:'HEADS'};
  return {ports,selector,entries,replay,reads,ops,stats,add,
    stop:()=>{active=false;},deny:()=>{allow=false;},denyAccess:()=>{authorized=false;},
    off:()=>{network=false;},
    wire:()=>createT4CandidateFrameTransport(ports).forOriginalHostLifetime(()=>active)};
}
const opts=(f,extra={})=>({selector:f.selector,requiredCryptoSuite:suite,...extra});
test('discovery only verifies exact remote source, destination, session, epoch, scope and type',async()=>{
  const f=await fixture(),valid=await f.add();
  await f.add({recipientNodeRef:'node:other'});
  await f.add({sourceNodeRef:'node:other'});
  await f.add({sessionRef:'session:other'});
  await f.add({scopeRef:'scope:other'});
  await f.add({ownerEpoch:3,body:{familyRef:'family:one',ownerEpoch:3,heads:[]}});
  const page=await f.wire().discoverAndVerifySignedFrames(opts(f));
  assert.equal(page.candidatesExamined,6);assert.equal(page.ignoredCount,5);
  assert.deepEqual(page.receipts.map(r=>r.key),[valid.id]);
  assert.equal(page.listingExhausted,true);assert.equal(page.mustRescanOnNextOriginalHostWake,true);
  assert.equal(f.stats.signatures,1);assert.equal(f.stats.replayWrites,1);
  const resumed=await f.wire().discoverAndVerifySignedFrames(opts(f));
  assert.equal(resumed.receipts[0].exactPreviouslyVerifiedReplay,true);
  assert.equal(f.replay.size,1);
});
test('changing immutable address list restarts advisory scan; cannot skip new lower hash',async()=>{
  const f=await fixture();await f.add();await f.add();
  const w=f.wire(),first=await w.discoverAndVerifySignedFrames(opts(f,{maxCandidates:1}));
  assert.equal(first.listingExhausted,false);assert.ok(first.continuation);
  await f.add();
  const readCount=f.reads.length,changed=await w.discoverAndVerifySignedFrames(opts(f,{continuation:first.continuation,maxCandidates:1}));
  assert.equal(changed.state,'RESTART_SCAN');assert.equal(changed.continuation,null);
  assert.equal(f.reads.length,readCount);
  const fresh=await w.discoverAndVerifySignedFrames(opts(f));
  assert.equal(fresh.receipts.length,3);
  assert.equal(f.replay.size,3);
});
test('continuation is bound to the exact selector and cannot skip to a fabricated key',async()=>{
  const f=await fixture();await f.add();await f.add();
  const w=f.wire(),first=await w.discoverAndVerifySignedFrames(opts(f,{maxCandidates:1}));
  await assert.rejects(w.discoverAndVerifySignedFrames(opts(f,{selector:{...f.selector,ownerEpoch:3},
    continuation:first.continuation})),code('WIRE_DISCOVERY_CONTINUATION_INVALID'));
  await assert.rejects(w.discoverAndVerifySignedFrames(opts(f,{continuation:{...first.continuation,afterKey:key('0')}})),
    code('WIRE_DISCOVERY_CONTINUATION_INVALID'));
});
test('discovery denial or local mode cannot enumerate collection; original network denial cannot write replay',async()=>{
  const f=await fixture();await f.add();f.deny();
  await assert.rejects(f.wire().discoverAndVerifySignedFrames(opts(f)),code('WIRE_HOST_NETWORK_AUTHORIZATION_DENIED'));
  assert.equal(f.stats.lists,0);
  const g=await fixture();await g.add();g.off();
  await assert.rejects(g.wire().discoverAndVerifySignedFrames(opts(g)),code('WIRE_HOST_NETWORK_MODE_OFF'));
  assert.equal(g.stats.lists,0);
  const h=await fixture();await h.add();h.denyAccess();
  await assert.rejects(h.wire().discoverAndVerifySignedFrames(opts(h)),code('WIRE_ORIGINAL_ACCESS_DENIED'));
  assert.equal(h.stats.replayWrites,0);
});
test('discovery detects changed bytes before decoding or original replay CAS',async()=>{
  const f=await fixture(),v=await f.add();f.entries.set(v.id,Buffer.from('other bytes'));
  await assert.rejects(f.wire().discoverAndVerifySignedFrames(opts(f)),code('WIRE_DISCOVERY_CANDIDATE_DIGEST_MISMATCH'));
  assert.equal(f.stats.signatures,0);assert.equal(f.stats.replayWrites,0);
});
test('Host invalidation while receiving address list prevents reads and replay',async()=>{
  const f=await fixture();await f.add();
  const list=f.ports.wireTransport.listNativeFrameAddresses;
  f.ports.wireTransport.listNativeFrameAddresses=async()=>{const value=await list();f.stop();return value;};
  await assert.rejects(f.wire().discoverAndVerifySignedFrames(opts(f)),code('ORIGINAL_HOST_LIFETIME_ENDED'));
  assert.equal(f.reads.length,0);assert.equal(f.stats.replayWrites,0);
});
