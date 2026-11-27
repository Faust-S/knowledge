import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,connect} from 'node:tls';
import {once} from 'node:events';
import {createServer as reservePort} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {openT4OriginalNativePeerStartup,releaseT4OriginalNativePeerStartup} from '../../src/network/original-native-peer-startup.mjs';
import {createHash,X509Certificate} from 'node:crypto';
import {createT4OriginalPeerHistoryTlsBinding,createT4OriginalPeerHistoryTlsConnection,T4_ORIGINAL_PEER_HISTORY_TLS_ALPN}
  from '../../src/network/original-peer-history-tls-connection.mjs';
import {createT4OriginalReplacementHistoryClient,createT4OriginalReplacementHistoryServer,
  encodeT4OriginalReplacementHistoryRequest} from '../../src/network/original-replacement-owner-history-carrier.mjs';
import {createT4OriginalReplacementOwnerEligibilityRequest} from '../../src/network/original-network-replacement-owner-eligibility.mjs';
import {createT4OriginalSourceEventWindowRequest,readT4OriginalSourceEventWindow,T4_SOURCE_EVENT_WINDOW_OWNER_ACTION,T4_SOURCE_EVENT_WINDOW_PEER_ACTION}
  from '../../src/network/original-source-event-window.mjs';
import {readT4OriginalEventWindow} from '../../src/network/original-event-window.mjs';
import {deriveT4OriginalNativeCaptureSession} from '../../src/network/original-network-publication.mjs';
import {createT4OriginalSignedReplacementHistoryAccess} from '../../src/network/original-signed-replacement-history-access.mjs';
import {createTemporaryOriginalPersonalAuthority} from '../../../t3-core/tests/support/t3-original-personal-authority.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),allow=async()=>true;
const workspaceId='ws:k99:business',originalWriteOwnerRef='owner:k99',scopeRef='scope:k99',ownerEpoch=2,
  A='node:k99:a',B='node:k99:b',technicalWorkspaceId='ws:k99:technical';
const common={workspaceId,originalWriteOwnerRef,scopeRef,ownerEpoch,getMode:()=> 'T4_NETWORK'};
const route=(localNodeRef,peerNodeRef)=>({...common,localNodeRef,peerNodeRef});
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

async function credentials(root){
  const openssl=(...args)=>execFileSync('openssl',args,{cwd:root,stdio:'pipe'});
  openssl('req','-x509','-newkey','ed25519','-nodes','-days','1','-keyout','ca.key','-out','ca.pem',
    '-subj','/CN=IWXA K99 ephemeral qualification CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign');
  await writeFile(join(root,'leaf.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:localhost\n');
  for(const [name,serial] of [['a','1'],['b','2']]){
    openssl('req','-newkey','ed25519','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=IWXA K99 test peer '+name);
    openssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-set_serial',serial,'-days','1','-extfile','leaf.ext','-out',name+'.pem');
  }
  const read=path=>readFile(join(root,path)),ca=await read('ca.pem');
  const load=async n=>{const cert=await read(n+'.pem');return {cert,key:await read(n+'.key'),ca,pin:sha(new X509Certificate(cert).raw)};};
  return {a:await load('a'),b:await load('b')};
}
async function pair(keys){
  const tls={minVersion:'TLSv1.3',maxVersion:'TLSv1.3',ALPNProtocols:[T4_ORIGINAL_PEER_HISTORY_TLS_ALPN],rejectUnauthorized:true};
  const listener=createServer({...keys.a,...tls,requestCert:true});
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const accepting=once(listener,'secureConnection');
  const b=connect({...keys.b,...tls,host:'127.0.0.1',port:listener.address().port,servername:'localhost'});
  try{
    const [[a]]=await Promise.all([accepting,once(b,'secureConnect')]);
    return {a,b,async close(){a.destroy();b.destroy();await new Promise(resolve=>listener.close(resolve));}};
  }catch(error){b.destroy();listener.close();throw error;}
}
async function captureFixture(){
  const event=(id,revision)=>({event_id:id,workspace_id:workspaceId,object_id:'object:k99',revision,
    event_type:'business.object.changed',service_id:'service:k99',occurred_at:'2026-11-25T10:00:00Z',payload:{private:'K99 never transmit Event payload'}});
  const events=[event('event:k99:baseline',1),event('event:k99:change',2)];
  const read=cursor=>readT4OriginalEventWindow({workspaceId,originalWriteOwnerRef,maxEvents:1,cursor,
    authorizeOriginalRead:allow,readOriginalEvents:async()=>events});
  const before=(await read(null)).nextCursor,{window,nextCursor}=await read(before),content=Buffer.from('captured canonical fixture');
  const capture={kind:'OBJECT_PUT',captureRef:'capture:k99',workspaceId,originalWriteOwnerRef,sourceEventId:window.lastEventId,sourceRevision:2,
    originalIntentEventAndCanonicalBytesVerified:true,capturedWindowDigestVerified:true,sourceWindow:window,
    prepared:{bytes:new Uint8Array(content),sha256:sha(content),delta:{sourceEventId:window.lastEventId,sourceRevision:2,
      sourceEventDigest:window.eventRefs[0].eventDigest,windowDigest:window.windowDigest}}};
  const session=deriveT4OriginalNativeCaptureSession({schema:'IWXA_T4_ORIGINAL_HOST_NATIVE_OUTBOX_TASK_V1',state:'ORIGINAL_NATIVE_CAPTURE_READY',
    workspaceId,originalWriteOwnerRef,sourceNodeRef:A,recipientNodeRef:B,scopeRef,ownerEpoch,networkTargetRef:B,
    networkPublished:false,sourceCursorAdvanced:false,originalRecipientApplied:false,sourceCursorBefore:before,sourceCursorAfter:nextCursor,capture});
  const selected={schema:'IWXA_T4_ORIGINAL_NATIVE_CAPTURE_SELECTION_V1',state:'ORIGINAL_NATIVE_SESSION_SELECTED',session,
    sourceCursorBefore:before,sourceCursorAfter:nextCursor,sourceWindow:window,originalCaptureEvidenceVerified:true,
    originalSourceOwnerReadVerified:true,originalSourceCursorAdvanced:false,originalNetworkPublished:false,
    originalSubjectMutationInvoked:false,capturedPlaintextReturned:false};
  return {session,before,selected,request:createT4OriginalSourceEventWindowRequest({session,sourceCursorBefore:before,requesterNodeRef:B,ownerNodeRef:A})};
}

test('K99 mutual TLS carries the existing bounded owner history call, not Kernel authority or Event payload',{timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'iwxa-t4-k99-'));let sockets=null;
  try{
    const keys=await credentials(root),f=await captureFixture();sockets=await pair(keys);
    let admittedA=true,admittedB=true,ownerReads=0,hold=null;
    const oldPeer='t4.network.original.replacement.peer.read-history',oldOwner='t4.network.original.replacement.owner.read-history';
    const authorityA=createTemporaryOriginalPersonalAuthority({workspaceId,clock:Date.now,purpose:'network.synchronization',
      operations:[T4_SOURCE_EVENT_WINDOW_OWNER_ACTION,oldPeer]}),
      authorityB=createTemporaryOriginalPersonalAuthority({workspaceId,clock:Date.now,purpose:'network.synchronization',
      operations:[T4_SOURCE_EVENT_WINDOW_PEER_ACTION,oldOwner]});
    const signed=(f,localNodeRef)=>createT4OriginalSignedReplacementHistoryAccess({...common,technicalWorkspaceId,
      sourceNodeRef:A,recipientNodeRef:B,localNodeRef,access:f.access,expectedContext:f.access.currentContext(),
      enableOriginalEligibilityRead:true,enableOriginalSourceWindowRead:true});
    const accessA=signed(authorityA,A),accessB=signed(authorityB,B);
    const setup=(socket,local,peer,localPin,peerPin,admitted)=>({...route(local,peer),socket,contextEpoch:7,
      localCertificateSha256:localPin,peerCertificateSha256:peerPin,isOriginalHostActive:()=>true,
      authorizeOriginalPeerConnection:p=>admitted()&&p.originalTransportGrantsNoSubjectAuthority===true&&
        p.localNodeRef===local&&p.peerNodeRef===peer&&p.peerCertificateSha256===peerPin});
    const configA=setup(sockets.a,A,B,keys.a.pin,keys.b.pin,()=>admittedA),configB=setup(sockets.b,B,A,keys.b.pin,keys.a.pin,()=>admittedB);
    assert.throws(()=>createT4OriginalPeerHistoryTlsConnection({...configA,peerCertificateSha256:'0'.repeat(64)}),{code:'ORIGINAL_PEER_TLS_CERTIFICATE_MISMATCH'});
    const a=createT4OriginalPeerHistoryTlsConnection(configA),b=createT4OriginalPeerHistoryTlsConnection(configB);
    assert.equal(a.readOriginalPeerContext().nodeRef,B);assert.equal(b.readOriginalPeerContext().nodeRef,A);
    assert.equal(a.readOriginalPeerContext().originalPeerSessionRef,b.readOriginalPeerContext().originalPeerSessionRef);
    const serverA=createT4OriginalReplacementHistoryServer({...route(A,B),readOriginalPeerContext:a.readOriginalPeerContext,
      readOriginalReplacementOwnerHistory:async({request,peerContext})=>{
        ownerReads++;assert.equal(peerContext.nodeRef,B);assert.equal(peerContext.originalPeerSessionRef,a.readOriginalPeerContext().originalPeerSessionRef);
        if(hold){hold.entered.resolve();await hold.release.promise;}
        if(request.schema!==f.request.schema)return null;
        return readT4OriginalSourceEventWindow({request,technicalWorkspaceId,getMode:common.getMode,
          readOriginalHostContext:async()=>({workspaceId:technicalWorkspaceId,originalWriteOwnerRef,nodeRef:A,scopeRef,hostSessionRef:'host:k99:a'}),
          authorizeOriginalOwnerHistoryRead:accessA.authorizeOwner,readOriginalCaptureSelection:async()=>f.selected});
      }});
    const serverB=createT4OriginalReplacementHistoryServer({...route(B,A),readOriginalPeerContext:b.readOriginalPeerContext,
      readOriginalReplacementOwnerHistory:async({peerContext})=>{assert.equal(peerContext.nodeRef,A);return null;}});
    const fake=createT4OriginalReplacementHistoryServer({...route(A,B),readOriginalPeerContext:()=>a.readOriginalPeerContext(),
      readOriginalReplacementOwnerHistory:async()=>null});
    assert.throws(()=>a.bindReceiver(fake),{code:'ORIGINAL_PEER_TLS_RECEIVER_INVALID'});
    a.bindReceiver(serverA);b.bindReceiver(serverB);
    const clientA=createT4OriginalReplacementHistoryClient({...route(A,B),readOriginalPeerContext:a.readOriginalPeerContext,
      invokeOriginalPeerHistory:a.invokeOriginalPeerHistory}),clientB=createT4OriginalReplacementHistoryClient({...route(B,A),
      readOriginalPeerContext:b.readOriginalPeerContext,invokeOriginalPeerHistory:b.invokeOriginalPeerHistory});
    const eligible=createT4OriginalReplacementOwnerEligibilityRequest({session:f.session,sourceCursorBefore:f.before,requesterNodeRef:A,ownerNodeRef:B});
    const read=async(client,access,operation,request)=>{
      const proof={operation,request,originalIndependentOwnerReadRequired:true,originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
      await access.authorizePeer({...proof,stage:'before'});
      const result=await client(request);
      await access.authorizePeer({...proof,stage:'after'});return result;
    };
    const project=()=>read(clientB,accessB,T4_SOURCE_EVENT_WINDOW_PEER_ACTION,f.request);
    const [snapshot,busy]=await Promise.all([project(),read(clientA,accessA,oldPeer,eligible)]);
    assert.equal(busy,null);assert.equal(snapshot.originalCaptureEvidenceVerified,true);assert.equal(snapshot.originalEventPayloadReturned,false);
    assert.deepEqual(snapshot.nextCursor,f.selected.sourceCursorAfter);assert.equal(snapshot.window.eventRefs[0].eventDigest,f.session.sourceEventDigest);
    assert.equal(JSON.stringify(snapshot).includes('never transmit'),false);assert.equal(ownerReads,1);
    assert.ok(authorityA.proofCount>=4&&authorityA.registryReads===authorityA.proofCount);
    assert.ok(authorityB.proofCount>=2&&authorityB.registryReads===authorityB.proofCount);
    const prior=b.readOriginalPeerContext();
    await assert.rejects(b.invokeOriginalPeerHistory({requestBytes:encodeT4OriginalReplacementHistoryRequest(f.request),
      originalPeerContext:{...prior,originalPeerSessionRef:'forged:peer'}}),{code:'ORIGINAL_PEER_TLS_REQUEST_INVALID'});
    assert.equal(ownerReads,1);
    // The owner can be busy. Never queue an unbounded second outgoing call;
    // revocation while reading must also suppress its response.
    hold={entered:defer(),release:defer()};const pending=project();await hold.entered.promise;
    await assert.rejects(clientB(f.request),{code:'ORIGINAL_PEER_TLS_REQUEST_SLOT_UNAVAILABLE'});
    const refused=assert.rejects(pending,{code:'ORIGINAL_PEER_TLS_TRANSPORT_LOST'});
    authorityA.revoke();hold.release.resolve();await refused;
    assert.equal(ownerReads,2);assert.throws(()=>b.readOriginalPeerContext(),{code:'ORIGINAL_PEER_TLS_ADMISSION_DENIED'});
    a.close();b.close();await sockets.close();sockets=null;
    // Another authenticated TLS session cannot inherit the old connection
    // identity, and a malicious peer cannot allocate an oversized body.
    sockets=await pair(keys);admittedA=true;const second=createT4OriginalPeerHistoryTlsConnection(setup(sockets.a,A,B,keys.a.pin,keys.b.pin,()=>admittedA));
    assert.notEqual(second.readOriginalPeerContext().originalPeerSessionRef,prior.originalPeerSessionRef);
    second.bindReceiver(createT4OriginalReplacementHistoryServer({...route(A,B),readOriginalPeerContext:second.readOriginalPeerContext,
      readOriginalReplacementOwnerHistory:async()=>{ownerReads++;return null;}}));
    const end=once(sockets.b,'close'),oversize=Buffer.alloc(5);oversize[0]=1;oversize.writeUInt32BE(32769,1);sockets.b.write(oversize);
    await end;assert.equal(ownerReads,2);second.close();await sockets.close();sockets=null;
    // An original owner may revoke the connection independently of its
    // signed action grant. A still-valid TLS certificate is not admission.
    sockets=await pair(keys);admittedA=true;const third=createT4OriginalPeerHistoryTlsConnection(setup(sockets.a,A,B,keys.a.pin,keys.b.pin,()=>admittedA));
    admittedA=false;assert.throws(()=>third.readOriginalPeerContext(),{code:'ORIGINAL_PEER_TLS_ADMISSION_DENIED'});third.close();
    console.log('T4_K99_MUTUAL_TLS_ORIGINAL_OWNER_CARRIER_PASS',JSON.stringify({actualTls13:true,mutualCertificateVerification:true,
      exactPinnedCertificates:true,duplexOriginalCalls:true,signedOriginalOwnerAndPeerActions:true,rawEventPayloadReturned:false,revocationDuringReadDenied:true,transportAdmissionRevoked:true,
      oversizedFrameDenied:true,independentInstalledHosts:false}));
  }finally{await sockets?.close();await rm(root,{recursive:true,force:true});}
});

// Reconnect only at explicit owner command; no pending read, old peer
// context, or receive callback may be transplanted to the new TLS session.
test('K100 explicitly replace the admitted TLS connection without replacing the original owner carrier',{timeout:30000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'iwxa-t4-k100-')),pairs=[];
  let a=null,b=null,hold=null,reads=0,mode='T4_NETWORK';
  try{
    const keys=await credentials(root),f=await captureFixture(),getMode=()=>mode;
    const open=async()=>{const p=await pair(keys);pairs.push(p);return p;};
    const port=(socket,localNodeRef,peerNodeRef,overrides={})=>createT4OriginalPeerHistoryTlsConnection({
      ...route(localNodeRef,peerNodeRef),socket,getMode,contextEpoch:7,isOriginalHostActive:()=>true,
      localCertificateSha256:(localNodeRef===A?keys.a:keys.b).pin,
      peerCertificateSha256:(localNodeRef===A?keys.b:keys.a).pin,
      authorizeOriginalPeerConnection:()=>true,...overrides});
    const first=await open(),a1=port(first.a,A,B),b1=port(first.b,B,A);
    a=createT4OriginalPeerHistoryTlsBinding({connection:a1,getMode});
    b=createT4OriginalPeerHistoryTlsBinding({connection:b1,getMode});
    assert.throws(()=>a.replaceConnection(a1),{code:'ORIGINAL_PEER_TLS_REPLACEMENT_INVALID'});
    const authorityA=createTemporaryOriginalPersonalAuthority({workspaceId,clock:Date.now,purpose:'network.synchronization',
      operations:[T4_SOURCE_EVENT_WINDOW_OWNER_ACTION]}),authorityB=createTemporaryOriginalPersonalAuthority({workspaceId,clock:Date.now,
      purpose:'network.synchronization',operations:[T4_SOURCE_EVENT_WINDOW_PEER_ACTION]});
    const signed=(f,localNodeRef)=>createT4OriginalSignedReplacementHistoryAccess({...common,getMode,technicalWorkspaceId,
      sourceNodeRef:A,recipientNodeRef:B,localNodeRef,access:f.access,expectedContext:f.access.currentContext(),enableOriginalSourceWindowRead:true});
    const accessA=signed(authorityA,A),accessB=signed(authorityB,B);
    const originalRead=async({request,peerContext})=>{
      reads++;assert.equal(peerContext.nodeRef,B);
      const suspended=hold;
      try{
        if(suspended){suspended.entered.resolve();await suspended.release.promise;}
        return await readT4OriginalSourceEventWindow({request,technicalWorkspaceId,getMode,
          readOriginalHostContext:async()=>({workspaceId:technicalWorkspaceId,originalWriteOwnerRef,nodeRef:A,scopeRef,hostSessionRef:'host:k100:same-owner'}),
          authorizeOriginalOwnerHistoryRead:accessA.authorizeOwner,readOriginalCaptureSelection:async()=>f.selected});
      }finally{suspended?.done.resolve();}
    };
    a.bindReceiver(originalRead);b.bindReceiver(async()=>null);
    assert.throws(()=>a.bindReceiver(originalRead),{code:'ORIGINAL_PEER_TLS_BINDING_RECEIVER_INVALID'});
    const client=createT4OriginalReplacementHistoryClient({...route(B,A),getMode,
      readOriginalPeerContext:b.readOriginalPeerContext,invokeOriginalPeerHistory:b.invokeOriginalPeerHistory});
    const read=async()=>{
      const proof={operation:T4_SOURCE_EVENT_WINDOW_PEER_ACTION,request:f.request,originalIndependentOwnerReadRequired:true,
        originalSubjectMutationAllowed:false,originalFrameRetryAllowed:false};
      await accessB.authorizePeer({...proof,stage:'before'});const result=await client(f.request);
      await accessB.authorizePeer({...proof,stage:'after'});return result;
    };
    const original=await read();assert.equal(reads,1);assert.equal(authorityA.proofCount,2);
    const old=b.readOriginalPeerContext(),next=await open(),a2=port(next.a,A,B),b2=port(next.b,B,A);
    const wrongPair=await open(),wrong=port(wrongPair.a,A,B,{workspaceId:'ws:k100:foreign'});
    assert.throws(()=>a.replaceConnection(wrong),{code:'ORIGINAL_PEER_TLS_REPLACEMENT_INVALID'});
    assert.equal(a.readOriginalPeerContext().originalPeerSessionRef,old.originalPeerSessionRef);wrong.close();
    hold={entered:defer(),release:defer(),done:defer()};const pending=read();await hold.entered.promise;
    // Close the outgoing channel while its original read is still pending.
    const refused=assert.rejects(pending,{code:'ORIGINAL_PEER_TLS_CLOSED'});
    b.replaceConnection(b2);await refused;a.replaceConnection(a2);
    assert.equal(reads,2);assert.notEqual(b.readOriginalPeerContext().originalPeerSessionRef,old.originalPeerSessionRef);
    assert.equal(b.readOriginalPeerContext().originalPeerSessionRef,a.readOriginalPeerContext().originalPeerSessionRef);
    hold.release.resolve();await hold.done.promise;hold=null;
    await assert.rejects(b.invokeOriginalPeerHistory({requestBytes:encodeT4OriginalReplacementHistoryRequest(f.request),originalPeerContext:old}),
      {code:'ORIGINAL_PEER_TLS_REQUEST_INVALID'});
    assert.equal(reads,2);assert.deepEqual(await read(),original);assert.equal(reads,3);
    assert.throws(()=>b.replaceConnection(b1),{code:'ORIGINAL_PEER_TLS_ADMISSION_DENIED'});
    // Spontaneous transport loss also leaves the original binding replaceable.
    const lostA=once(next.a,'close'),lostB=once(next.b,'close');next.b.destroy();await Promise.all([lostA,lostB]);
    await assert.rejects(client(f.request),{code:'ORIGINAL_PEER_TLS_ADMISSION_DENIED'});
    const third=await open(),a3=port(third.a,A,B),b3=port(third.b,B,A);
    a.replaceConnection(a3);b.replaceConnection(b3);
    assert.equal(reads,3);assert.deepEqual(await read(),original);assert.equal(reads,4);
    b.close();assert.throws(()=>b.readOriginalPeerContext(),{code:'ORIGINAL_PEER_TLS_BINDING_CLOSED'});
    assert.throws(()=>b.replaceConnection(b3),{code:'ORIGINAL_PEER_TLS_BINDING_CLOSED'});
    assert.ok(authorityA.proofCount>=8&&authorityA.registryReads===authorityA.proofCount);
    console.log('T4_K100_ORIGINAL_PEER_TLS_REBIND_PASS',JSON.stringify({sameReadOnlyOwnerCallback:true,oldPendingReadRejected:true,
      explicitNewConnection:true,spontaneousTransportLossRecovered:true,oldContextRejected:true,foreignRouteRejected:true,automaticRetry:false,originalSubjectMutationInvoked:false}));
  }finally{hold?.release.resolve();a?.close();b?.close();for(const p of pairs)await p.close();await rm(root,{recursive:true,force:true});}
});

test('native startup hands two real TLS endpoints to the unchanged original history carrier',{timeout:15000},async()=>{
  const root=await mkdtemp(join(tmpdir(),'iwxa-t4-native-startup-'));
  const stop=new AbortController();let a,b;
  try{
    const keys=await credentials(root),f=await captureFixture(),reservation=reservePort();
    await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const start=(mode,local,peer,localKeys,peerKeys)=>openT4OriginalNativePeerStartup({
      endpoint:{mode,address:'127.0.0.1',port,...(mode==='CONNECT'?{serverName:'localhost'}:{})},
      identity:{workspaceId,originalWriteOwnerRef,scopeRef,ownerEpoch,localNodeRef:local,peerNodeRef:peer,contextEpoch:7,
        localCertificateSha256:localKeys.pin,peerCertificateSha256:peerKeys.pin},
      readOriginalCredentials:()=>({cert:localKeys.cert,key:localKeys.key,ca:localKeys.ca}),
      getMode:common.getMode,isOriginalHostActive:()=>!stop.signal.aborted,
      authorizeOriginalPeerConnection:x=>x.originalTransportGrantsNoSubjectAuthority===true,
      signal:stop.signal,timeoutMs:5000,alpn:T4_ORIGINAL_PEER_HISTORY_TLS_ALPN,deferIncomingUntilReceiver:true,
      createOriginalConnection:createT4OriginalPeerHistoryTlsConnection});
    const wait=start('LISTEN',A,B,keys.a,keys.b).then(x=>a=x);wait.catch(()=>{});
    await delay(50);
    const dial=start('CONNECT',B,A,keys.b,keys.a).then(x=>b=x);dial.catch(()=>{});
    await Promise.all([wait,dial]);
    assert.equal(a.readOriginalPeerContext().originalPeerSessionRef,b.readOriginalPeerContext().originalPeerSessionRef);
    let reads=0;
    b.bindReceiver(createT4OriginalReplacementHistoryServer({...route(B,A),
      readOriginalPeerContext:b.readOriginalPeerContext,readOriginalReplacementOwnerHistory:async()=>null}));
    releaseT4OriginalNativePeerStartup(b);
    const client=createT4OriginalReplacementHistoryClient({...route(B,A),readOriginalPeerContext:b.readOriginalPeerContext,
      invokeOriginalPeerHistory:b.invokeOriginalPeerHistory});
    const early=client(f.request);early.catch(()=>{});await delay(50);assert.equal(reads,0);
    a.bindReceiver(createT4OriginalReplacementHistoryServer({...route(A,B),
      readOriginalPeerContext:a.readOriginalPeerContext,readOriginalReplacementOwnerHistory:async({request})=>{
        reads++;assert.deepEqual(request,f.request);return null;}}));
    releaseT4OriginalNativePeerStartup(a);
    assert.equal(await early,null);assert.equal(reads,1);
    stop.abort();
    await assert.rejects(client(f.request),{code:'ORIGINAL_PEER_TLS_ADMISSION_DENIED'});
    assert.equal(reads,1);
  }finally{stop.abort();a?.close();b?.close();await rm(root,{recursive:true,force:true});}
});
