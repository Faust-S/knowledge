// Native owner startup for the EXISTING T4 peer-history TLS carrier.
// No new wire protocol, discovery, certificate store, authority or retry loop.
import {connect,createServer,checkServerIdentity} from 'node:tls';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';

const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const error=code=>Object.assign(Error(code),{code});
const require=(v,c)=>{if(!v)throw error(c);};
const digest=cert=>Buffer.isBuffer(cert?.raw)?createHash('sha256').update(cert.raw).digest('hex'):null;
const material=x=>(typeof x==='string'||Buffer.isBuffer(x))&&Buffer.byteLength(x)>0&&Buffer.byteLength(x)<=256*1024;
const fields=['workspaceId','originalWriteOwnerRef','scopeRef','ownerEpoch','localNodeRef','peerNodeRef','contextEpoch','localCertificateSha256','peerCertificateSha256'];

// Only a socket handed to this exact carrier can be released. No wire-level
// readiness message: the original owner installs its receiver first.
const pendingReceivers=new WeakMap();
export function releaseT4OriginalNativePeerStartup(connection){
  const release=pendingReceivers.get(connection);
  require(typeof release==='function','ORIGINAL_PEER_STARTUP_RECEIVER_NOT_PENDING');
  release();
}

// The endpoint and credential reader are selected by the native owner, not
// the WebView or an incoming peer. The reader uses existing local custody.
// CONNECT or LISTEN is explicit and independent of the subject's role.
export async function openT4OriginalNativePeerStartup({endpoint,readOriginalCredentials,identity,
  getMode,isOriginalHostActive,authorizeOriginalPeerConnection,createOriginalConnection,
  alpn,timeoutMs=20000,signal,deferIncomingUntilReceiver=false}={}){
  require(endpoint&&typeof endpoint==='object'&&['CONNECT','LISTEN'].includes(endpoint.mode)&&
    typeof endpoint.address==='string'&&isIP(endpoint.address)!==0&&endpoint.address!=='0.0.0.0'&&!/^[0:]+$/.test(endpoint.address)&&
    Object.keys(endpoint).every(k=>['mode','address','port','serverName'].includes(k))&&
    Number.isSafeInteger(endpoint.port)&&endpoint.port>=1&&endpoint.port<=65535&&
    (endpoint.mode==='CONNECT'?typeof endpoint.serverName==='string'&&endpoint.serverName.length<=253&&
      /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(endpoint.serverName)&&!isIP(endpoint.serverName):endpoint.serverName===undefined),
    'ORIGINAL_PEER_STARTUP_ENDPOINT_INVALID');
  require(identity&&fields.every(k=>Object.hasOwn(identity,k))&&
    ['workspaceId','originalWriteOwnerRef','scopeRef','localNodeRef','peerNodeRef'].every(k=>ID(identity[k]))&&
    identity.localNodeRef!==identity.peerNodeRef&&Number.isSafeInteger(identity.ownerEpoch)&&identity.ownerEpoch>=1&&
    Number.isSafeInteger(identity.contextEpoch)&&identity.contextEpoch>=0&&
    SHA(identity.localCertificateSha256)&&SHA(identity.peerCertificateSha256)&&identity.localCertificateSha256!==identity.peerCertificateSha256,
    'ORIGINAL_PEER_STARTUP_IDENTITY_INVALID');
  require([readOriginalCredentials,getMode,isOriginalHostActive,authorizeOriginalPeerConnection,createOriginalConnection].every(f=>typeof f==='function')&&
    alpn==='iwxa-t4-owner-history/1'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=60000&&
    typeof deferIncomingUntilReceiver==='boolean'&&(signal===undefined||signal instanceof AbortSignal),'ORIGINAL_PEER_STARTUP_PORTS_REQUIRED');
  const route=Object.freeze(Object.fromEntries(fields.map(k=>[k,identity[k]])));
  const {mode,address,port,serverName}=endpoint;
  const active=()=>{try{return getMode()==='T4_NETWORK'&&isOriginalHostActive()===true&&signal?.aborted!==true;}catch{return false;}};
  require(active(),'ORIGINAL_PEER_STARTUP_HOST_DISPOSED');
  let server=null,client=null,selected=null,connection=null,settled=false;
  const sockets=new Set();
  let timer,abort;
  const stopListening=()=>{if(server){server.close();server=null;}};
  const clear=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const destroy=()=>{
    stopListening();client?.destroy();selected?.destroy();
    for(const socket of sockets)socket.destroy();sockets.clear();
  };
  const result=await new Promise((resolve,reject)=>{
    function deny(code){if(settled)return;settled=true;clear();try{connection?.close();}catch{}
      try{destroy();}finally{reject(error(code));}}
    abort=()=>deny('ORIGINAL_PEER_STARTUP_HOST_DISPOSED');
    timer=setTimeout(()=>deny('ORIGINAL_PEER_STARTUP_TIMEOUT'),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    function admit(socket){
      if(settled){socket.destroy();return;}
      if(!active()){socket.destroy();deny('ORIGINAL_PEER_STARTUP_HOST_DISPOSED');return;}
      if(socket.authorized!==true||socket.getProtocol()!=='TLSv1.3'||socket.alpnProtocol!==alpn||
        digest(socket.getCertificate())!==route.localCertificateSha256||digest(socket.getPeerCertificate())!==route.peerCertificateSha256){
        socket.destroy();if(mode==='CONNECT')deny('ORIGINAL_PEER_STARTUP_CERTIFICATE_MISMATCH');return;
      }
      selected=socket;
      try{
        if(deferIncomingUntilReceiver)socket.pause();
        // The original carrier performs the second, authoritative admission,
        // including the TLS exporter and the owner's live per-call guard.
        connection=createOriginalConnection({...route,socket,getMode,isOriginalHostActive:()=>active(),
          authorizeOriginalPeerConnection,timeoutMs});
        require(connection&&typeof connection.close==='function','ORIGINAL_PEER_STARTUP_CONNECTION_INVALID');
        // Cancellation can occur synchronously during the owner's factory.
        if(settled){try{connection.close();}finally{socket.destroy();}return;}
        require(active(),'ORIGINAL_PEER_STARTUP_HOST_DISPOSED');
        let receiverTimer=null;
        const stopAdmitted=()=>{try{connection.close();}catch{}finally{socket.destroy();}};
        const cleanupAdmitted=()=>{
          clearTimeout(receiverTimer);pendingReceivers.delete(connection);
          signal?.removeEventListener('abort',stopAdmitted);
        };
        socket.once('close',cleanupAdmitted);
        if(deferIncomingUntilReceiver){
          pendingReceivers.set(connection,()=>{
            if(!active()||socket.destroyed){stopAdmitted();throw error('ORIGINAL_PEER_STARTUP_HOST_DISPOSED');}
            pendingReceivers.delete(connection);clearTimeout(receiverTimer);socket.resume();
          });
          receiverTimer=setTimeout(stopAdmitted,timeoutMs);receiverTimer.unref?.();
        }
        // The same lifetime controls the established socket, not just TLS.
        signal?.addEventListener('abort',stopAdmitted,{once:true});
        if(!active()){stopAdmitted();deny('ORIGINAL_PEER_STARTUP_HOST_DISPOSED');return;}
        stopListening();settled=true;clear();resolve(connection);
      }catch(e){deny(e?.code==='ORIGINAL_PEER_STARTUP_HOST_DISPOSED'?e.code:'ORIGINAL_PEER_STARTUP_ADMISSION_DENIED');}
    }
    Promise.resolve().then(async()=>{
      const credentials=await readOriginalCredentials(Object.freeze({localNodeRef:route.localNodeRef,localCertificateSha256:route.localCertificateSha256}));
      if(settled)return;
      require(active(),'ORIGINAL_PEER_STARTUP_HOST_DISPOSED');
      require(credentials&&['cert','key','ca'].every(k=>material(credentials[k]))&&
        Object.keys(credentials).every(k=>['cert','key','ca','passphrase'].includes(k))&&
        (credentials.passphrase===undefined||material(credentials.passphrase)), 'ORIGINAL_PEER_STARTUP_CREDENTIALS_INVALID');
      const tls={cert:credentials.cert,key:credentials.key,ca:credentials.ca,passphrase:credentials.passphrase,
        minVersion:'TLSv1.3',maxVersion:'TLSv1.3',ALPNProtocols:[alpn],rejectUnauthorized:true};
      if(mode==='CONNECT'){
        client=connect({...tls,host:address,port,servername:serverName,checkServerIdentity});
        client.on('error',()=>deny('ORIGINAL_PEER_STARTUP_CONNECT_FAILED'));
        client.once('close',()=>deny('ORIGINAL_PEER_STARTUP_CONNECT_FAILED'));
        client.once('secureConnect',()=>admit(client));
      }else{
        server=createServer({...tls,requestCert:true,handshakeTimeout:timeoutMs},admit);
        server.maxConnections=1;
        server.on('connection',socket=>{
          if(settled){socket.destroy();return;}
          sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
        });
        server.on('tlsClientError',()=>{}); // Refuse bad peers; wait only to the same deadline.
        server.on('error',()=>deny('ORIGINAL_PEER_STARTUP_LISTEN_FAILED'));
        server.listen({host:address,port,exclusive:true});
      }
    }).catch(e=>deny(typeof e?.code==='string'&&e.code.startsWith('ORIGINAL_PEER_STARTUP_')?e.code:'ORIGINAL_PEER_STARTUP_CREDENTIALS_INVALID'));
  });
  return result;
}
