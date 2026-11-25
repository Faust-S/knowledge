// Optional direct carrier of the existing, strictly typed original owner
// read-only request/response bytes. The installed Host owns the connection,
// certificate custody, peer admission and lifetime. No listener, CA, key
// store, grant, retry, Kernel method, or durable state is created here.
import {TLSSocket} from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
import {decodeT4OriginalReplacementHistoryRequest,decodeT4OriginalReplacementHistoryResponse,
  isT4OriginalReplacementHistoryServerForPeerContext} from './original-replacement-owner-history-carrier.mjs';

export const T4_ORIGINAL_PEER_HISTORY_TLS_ALPN='iwxa-t4-owner-history/1';
const REQUEST=1,RESPONSE=2,REQUEST_LIMIT=32768,RESPONSE_LIMIT=4*1024*1024;
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=code=>Object.assign(Error(code),{code});
const fail=code=>{throw error(code);};
const ports=new WeakSet();
export const isT4OriginalPeerHistoryTlsConnection=value=>!!value&&typeof value==='object'&&ports.has(value);
const secure=socket=>socket instanceof TLSSocket&&socket.encrypted===true&&socket.authorized===true&&
  !socket.destroyed&&!socket.readableEnded&&!socket.writableEnded&&socket.getProtocol()==='TLSv1.3'&&
  socket.alpnProtocol===T4_ORIGINAL_PEER_HISTORY_TLS_ALPN;
const certificateDigest=cert=>Buffer.isBuffer(cert?.raw)&&cert.raw.length>0?hash(cert.raw):null;

export function createT4OriginalPeerHistoryTlsConnection({socket,localNodeRef,peerNodeRef,scopeRef,ownerEpoch,
  workspaceId,originalWriteOwnerRef,contextEpoch,localCertificateSha256,peerCertificateSha256,
  getMode,isOriginalHostActive,authorizeOriginalPeerConnection,timeoutMs=20000}={}){
  if(![localNodeRef,peerNodeRef,scopeRef,workspaceId,originalWriteOwnerRef].every(ID)||localNodeRef===peerNodeRef||
    !Number.isSafeInteger(ownerEpoch)||ownerEpoch<1||!Number.isSafeInteger(contextEpoch)||contextEpoch<0||
    ![localCertificateSha256,peerCertificateSha256].every(SHA)||localCertificateSha256===peerCertificateSha256||
    ![getMode,isOriginalHostActive,authorizeOriginalPeerConnection].every(f=>typeof f==='function')||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000||!secure(socket)||
    socket.listenerCount('data')!==0||socket.listenerCount('readable')!==0)
    fail('ORIGINAL_PEER_TLS_CONNECTION_REQUIRED');
  const localCert=socket.getCertificate(),peerCert=socket.getPeerCertificate();
  if(certificateDigest(localCert)!==localCertificateSha256||certificateDigest(peerCert)!==peerCertificateSha256)
    fail('ORIGINAL_PEER_TLS_CERTIFICATE_MISMATCH');
  const certs=[localCert,peerCert].map(cert=>new X509Certificate(cert.raw));
  const validFrom=Math.max(...certs.map(c=>Date.parse(c.validFrom))),validTo=Math.min(...certs.map(c=>Date.parse(c.validTo)));
  const certsCurrent=()=>Number.isFinite(validFrom)&&Number.isFinite(validTo)&&validFrom<=Date.now()&&Date.now()<validTo;
  const identity=Object.freeze({localNodeRef,peerNodeRef,scopeRef,ownerEpoch,workspaceId,originalWriteOwnerRef});
  // Both directions derive the same connection identifier, unique to this
  // TLS session and route. The exporter is never a grant or sent as a key.
  const exported=socket.exportKeyingMaterial(32,'EXPORTER-IWXA-T4-OWNER-HISTORY-V1',Buffer.from(JSON.stringify([
    [localNodeRef,peerNodeRef].sort(),scopeRef,ownerEpoch,workspaceId,originalWriteOwnerRef])));
  const originalPeerSessionRef='tls-peer:'+hash(exported);exported.fill(0);
  const context=Object.freeze({nodeRef:peerNodeRef,originalPeerSessionRef,contextEpoch,scopeRef,ownerEpoch,
    originalPeerAuthenticated:true,originalConfidentialChannelVerified:true});
  const admission=Object.freeze({...identity,localCertificateSha256,peerCertificateSha256,originalPeerSessionRef,contextEpoch,
    originalTransportGrantsNoSubjectAuthority:true});
  let ended=false,receiver=null,pending=null,incoming=null,headerUsed=0,body=null,offset=0,kind=0,frameTimer=null;
  const header=Buffer.alloc(5);
  const clearFrameTimer=()=>{if(frameTimer!==null){clearTimeout(frameTimer);frameTimer=null;}};
  const deadline=fn=>{const t=setTimeout(fn,timeoutMs);t.unref?.();return t;};
  function close(code='ORIGINAL_PEER_TLS_CLOSED'){
    if(ended)return;
    ended=true;clearFrameTimer();body=null;receiver=null;
    if(incoming){clearTimeout(incoming.timer);incoming=null;}
    if(pending){const p=pending;pending=null;clearTimeout(p.timer);p.reject(error(code));}
    socket.destroy();
  }
  function guard(){
    try{
      if(ended||!secure(socket)||!certsCurrent()||getMode()!=='T4_NETWORK'||isOriginalHostActive()!==true||
        authorizeOriginalPeerConnection(admission)!==true||ended||!secure(socket)||!certsCurrent()||
        getMode()!=='T4_NETWORK'||isOriginalHostActive()!==true)fail('ORIGINAL_PEER_TLS_ADMISSION_DENIED');
    }catch(e){close('ORIGINAL_PEER_TLS_ADMISSION_DENIED');throw e;}
  }
  function route(bytes,inbound){
    const r=decodeT4OriginalReplacementHistoryRequest(bytes),c=r.session;
    if(r.requesterNodeRef!==(inbound?peerNodeRef:localNodeRef)||r.ownerNodeRef!==(inbound?localNodeRef:peerNodeRef)||
      c.scopeRef!==scopeRef||c.ownerEpoch!==ownerEpoch||c.workspaceId!==workspaceId||c.originalWriteOwnerRef!==originalWriteOwnerRef)
      fail('ORIGINAL_PEER_TLS_ROUTE_MISMATCH');
    return r;
  }
  function writeFrame(type,bytes){
    guard();const h=Buffer.alloc(5);h[0]=type;h.writeUInt32BE(bytes.length,1);
    socket.write(Buffer.concat([h,Buffer.from(bytes)]),e=>{if(e)close('ORIGINAL_PEER_TLS_TRANSPORT_LOST');});
  }
  function handleRequest(bytes){
    if(receiver===null||incoming!==null)fail('ORIGINAL_PEER_TLS_REQUEST_SLOT_UNAVAILABLE');
    const request=route(bytes,true),handler=receiver,slot={timer:deadline(()=>close('ORIGINAL_PEER_TLS_TIMEOUT'))};
    incoming=slot;
    Promise.resolve().then(async()=>{
      guard();const result=await handler(new Uint8Array(bytes));guard();
      if(incoming!==slot||!(result instanceof Uint8Array)||!result.length||result.length>RESPONSE_LIMIT)
        fail('ORIGINAL_PEER_TLS_RESPONSE_INVALID');
      // Original carrier validates schema, exact request and evidence.
      decodeT4OriginalReplacementHistoryResponse(result,request);
      writeFrame(RESPONSE,result);clearTimeout(slot.timer);incoming=null;
    }).catch(()=>close('ORIGINAL_PEER_TLS_OWNER_READ_FAILED'));
  }
  function handleResponse(bytes){
    const p=pending;if(p===null)fail('ORIGINAL_PEER_TLS_UNSOLICITED_RESPONSE');
    guard();decodeT4OriginalReplacementHistoryResponse(bytes,p.request);
    pending=null;clearTimeout(p.timer);p.resolve(new Uint8Array(bytes));
  }
  function onData(chunk){
    try{
      guard();
      for(let i=0;i<chunk.length;){
        if(body===null){
          if(headerUsed===0)frameTimer=deadline(()=>close('ORIGINAL_PEER_TLS_TIMEOUT'));
          const count=Math.min(5-headerUsed,chunk.length-i);
          chunk.copy(header,headerUsed,i,i+count);headerUsed+=count;i+=count;
          if(headerUsed<5)continue;
          kind=header[0];const n=header.readUInt32BE(1);
          if(![REQUEST,RESPONSE].includes(kind)||n<1||n>(kind===REQUEST?REQUEST_LIMIT:RESPONSE_LIMIT)||
            (kind===REQUEST&&(incoming!==null||receiver===null))||(kind===RESPONSE&&pending===null))
            fail('ORIGINAL_PEER_TLS_FRAME_INVALID');
          body=Buffer.alloc(n);offset=0;
        }
        const count=Math.min(body.length-offset,chunk.length-i);
        chunk.copy(body,offset,i,i+count);offset+=count;i+=count;
        if(offset!==body.length)continue;
        const type=kind,bytes=body;body=null;headerUsed=0;offset=0;clearFrameTimer();
        if(type===REQUEST)handleRequest(bytes);else handleResponse(bytes);
      }
    }catch(e){close(typeof e?.code==='string'?e.code:'ORIGINAL_PEER_TLS_FRAME_INVALID');}
  }
  const readOriginalPeerContext=()=>{guard();return context;};
  const port=Object.freeze({identity,readOriginalPeerContext,
    bindReceiver(server){
      guard();if(receiver!==null||!isT4OriginalReplacementHistoryServerForPeerContext(server,readOriginalPeerContext)||
        Object.keys(identity).some(k=>server.identity?.[k]!==identity[k]))fail('ORIGINAL_PEER_TLS_RECEIVER_INVALID');
      receiver=server;
    },
    async invokeOriginalPeerHistory({requestBytes,originalPeerContext}={}){
      guard();if(pending!==null)fail('ORIGINAL_PEER_TLS_REQUEST_SLOT_UNAVAILABLE');
      if(!originalPeerContext||Object.keys(originalPeerContext).length!==Object.keys(context).length||
        Object.keys(context).some(k=>originalPeerContext[k]!==context[k])||
        !(requestBytes instanceof Uint8Array)||!requestBytes.length||requestBytes.length>REQUEST_LIMIT)
        fail('ORIGINAL_PEER_TLS_REQUEST_INVALID');
      const bytes=Buffer.from(requestBytes),request=route(bytes,false);
      const result=await new Promise((resolve,reject)=>{
        pending={request,resolve,reject,timer:deadline(()=>close('ORIGINAL_PEER_TLS_TIMEOUT'))};
        try{writeFrame(REQUEST,bytes);}catch(e){close(typeof e?.code==='string'?e.code:'ORIGINAL_PEER_TLS_TRANSPORT_LOST');}
      });
      guard();return result;
    },close:()=>close()});
  guard();ports.add(port);
  socket.on('error',()=>close('ORIGINAL_PEER_TLS_TRANSPORT_LOST'));
  socket.on('end',()=>close('ORIGINAL_PEER_TLS_TRANSPORT_LOST'));
  socket.on('close',()=>close('ORIGINAL_PEER_TLS_TRANSPORT_LOST'));
  socket.on('data',onData);
  return port;
}
