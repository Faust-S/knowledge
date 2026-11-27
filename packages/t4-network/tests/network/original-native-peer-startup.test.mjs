import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {openT4OriginalNativePeerStartup as open} from '../../src/network/original-native-peer-startup.mjs';

let dir,A,B;
const alpn='iwxa-t4-owner-history/1';
const sha=cert=>createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
function openssl(...args){execFileSync('openssl',args,{cwd:dir,stdio:'ignore'});}
before(()=>{
  dir=mkdtempSync(join(tmpdir(),'iwxa-t4-peer-startup-'));
  openssl('req','-x509','-newkey','ed25519','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=T4 startup test CA');
  writeFileSync(join(dir,'leaf.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:localhost\n');
  for(const name of ['a','b']){
    openssl('req','-newkey','ed25519','-nodes','-keyout',name+'.key','-out',name+'.csr','-subj','/CN=localhost');
    openssl('x509','-req','-in',name+'.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out',name+'.pem','-days','1','-extfile','leaf.ext');
  }
  const read=name=>({cert:readFileSync(join(dir,name+'.pem')),key:readFileSync(join(dir,name+'.key')),ca:readFileSync(join(dir,'ca.pem'))});
  A=read('a');B=read('b');
});
after(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
async function freePort(){const s=createServer();await new Promise((res,rej)=>{s.once('error',rej);s.listen(0,'127.0.0.1',res);});const port=s.address().port;await new Promise(res=>s.close(res));return port;}
function options(mode,port,extra={}){
  const source=mode==='CONNECT',local=source?A:B,peer=source?B:A;
  return {endpoint:{mode,address:'127.0.0.1',port,...(source?{serverName:'localhost'}:{})},
    identity:{workspaceId:'ws:original',originalWriteOwnerRef:'owner:original',scopeRef:'scope:original',ownerEpoch:1,
      localNodeRef:source?'node:source':'node:recipient',peerNodeRef:source?'node:recipient':'node:source',contextEpoch:2,
      localCertificateSha256:sha(local.cert),peerCertificateSha256:sha(peer.cert)},
    getMode:()=> 'T4_NETWORK',isOriginalHostActive:()=>true,authorizeOriginalPeerConnection:()=>true,
    readOriginalCredentials:()=>local,alpn,timeoutMs:1200,
    // The canonical carrier is injected in the product. These isolated
    // transport tests deliberately check the real socket, not T4 frames.
    createOriginalConnection:({socket,...binding})=>({socket,binding,close:()=>socket.destroy()}),...extra};
}
async function pair(port,listener={},client={}){
  const waiting=open(options('LISTEN',port,listener));waiting.catch(()=>{});
  await delay(50);const connecting=open(options('CONNECT',port,client));connecting.catch(()=>{});
  return Promise.all([waiting,connecting]);
}
test('explicit native endpoints open a real mutual TLS 1.3 channel with equal exporter',async()=>{
  const port=await freePort();const [a,b]=await pair(port);
  try{
    for(const item of [a,b]){
      assert.equal(item.socket.authorized,true);assert.equal(item.socket.getProtocol(),'TLSv1.3');assert.equal(item.socket.alpnProtocol,alpn);
      assert.equal(item.binding.isOriginalHostActive(),true);
    }
    assert.deepEqual(a.socket.exportKeyingMaterial(32,'EXPORTER-IWXA-test',Buffer.from('scope')),b.socket.exportKeyingMaterial(32,'EXPORTER-IWXA-test',Buffer.from('scope')));
    const got=new Promise(res=>a.socket.once('data',res));b.socket.write('exact peer bytes');assert.equal((await got).toString(),'exact peer bytes');
    // The listener is not a persistent second server after admission.
    await assert.rejects(open(options('CONNECT',port)),{code:'ORIGINAL_PEER_STARTUP_CONNECT_FAILED'});
  }finally{a.close();b.close();}
});
test('wrong pinned peer certificate cannot reach the client carrier factory',async()=>{
  const port=await freePort();let bound=0;const a=options('LISTEN',port);const b=options('CONNECT',port);
  const ac=new AbortController(),waiting=open({...a,signal:ac.signal});waiting.catch(()=>{});await delay(50);
  await assert.rejects(open({...b,identity:{...b.identity,peerCertificateSha256:'f'.repeat(64)},createOriginalConnection:()=>{bound++;}}),{code:'ORIGINAL_PEER_STARTUP_CERTIFICATE_MISMATCH'});
  ac.abort();await waiting.then(admitted=>admitted.close(),e=>assert.equal(e.code,'ORIGINAL_PEER_STARTUP_HOST_DISPOSED'));assert.equal(bound,0);
});
test('listener rejects authenticated but wrong pinned peer without admitting it',async()=>{
  const port=await freePort();let bound=0;
  const a=options('LISTEN',port);const waiting=open({...a,identity:{...a.identity,peerCertificateSha256:'f'.repeat(64)},createOriginalConnection:()=>{bound++;}});waiting.catch(()=>{});
  await delay(50);const b=await open(options('CONNECT',port));b.close();
  await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_TIMEOUT'});assert.equal(bound,0);
});
test('hostname mismatch denies client connection before the original factory',async()=>{
  const port=await freePort();let bound=0;const a=options('LISTEN',port);const ac=new AbortController();
  const waiting=open({...a,signal:ac.signal});waiting.catch(()=>{});await delay(50);
  const b=options('CONNECT',port);
  await assert.rejects(open({...b,endpoint:{...b.endpoint,serverName:'wrong.invalid'},createOriginalConnection:()=>{bound++;}}),{code:'ORIGINAL_PEER_STARTUP_CONNECT_FAILED'});
  ac.abort();await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_HOST_DISPOSED'});assert.equal(bound,0);
});
test('cancel during credential read never opens a late listener',async()=>{
  const port=await freePort();const ac=new AbortController();let give;
  const waiting=open(options('LISTEN',port,{signal:ac.signal,readOriginalCredentials:()=>new Promise(res=>give=res)}));waiting.catch(()=>{});
  await delay(10);ac.abort();await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_HOST_DISPOSED'});give(B);await delay(50);
  await assert.rejects(open(options('CONNECT',port)),{code:'ORIGINAL_PEER_STARTUP_CONNECT_FAILED'});
});
test('cancel waiting listener releases port and leaves no running transport',async()=>{
  const port=await freePort(),ac=new AbortController();const waiting=open(options('LISTEN',port,{signal:ac.signal}));waiting.catch(()=>{});
  await delay(50);ac.abort();await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_HOST_DISPOSED'});
  const [a,b]=await pair(port);a.close();b.close();
});
test('original owner refusal releases connection and listener',async()=>{
  const port=await freePort();const waiting=open(options('LISTEN',port,{createOriginalConnection:()=>{throw Error('OWNER_DENIED');}}));waiting.catch(()=>{});
  await delay(50);const b=await open(options('CONNECT',port));try{await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_ADMISSION_DENIED'});}finally{b.close();}
  const [a,c]=await pair(port);a.close();c.close();
});
test('wildcard listener, same identity and invalid credentials are refused',async()=>{
  const port=await freePort();const a=options('LISTEN',port);
  await assert.rejects(open({...a,endpoint:{...a.endpoint,address:'0.0.0.0'}}),{code:'ORIGINAL_PEER_STARTUP_ENDPOINT_INVALID'});
  await assert.rejects(open({...a,identity:{...a.identity,peerNodeRef:a.identity.localNodeRef}}),{code:'ORIGINAL_PEER_STARTUP_IDENTITY_INVALID'});
  await assert.rejects(open({...a,readOriginalCredentials:()=>({...B,rejectUnauthorized:false})}),{code:'ORIGINAL_PEER_STARTUP_CREDENTIALS_INVALID'});
});

test('expired host lifetime prevents handoff even when certificates are correct',async()=>{
  const port=await freePort();let live=true,bound=0;
  const waiting=open(options('LISTEN',port,{isOriginalHostActive:()=>live,createOriginalConnection:()=>{bound++;}}));waiting.catch(()=>{});
  await delay(50);live=false;const b=await open(options('CONNECT',port));
  try{await assert.rejects(waiting,{code:'ORIGINAL_PEER_STARTUP_HOST_DISPOSED'});}finally{b.close();}
  assert.equal(bound,0);
});
test('occupied endpoint is not silently replaced',async()=>{
  const blocker=createServer();await new Promise(res=>blocker.listen(0,'127.0.0.1',res));
  try{await assert.rejects(open(options('LISTEN',blocker.address().port)),{code:'ORIGINAL_PEER_STARTUP_LISTEN_FAILED'});}
  finally{await new Promise(res=>blocker.close(res));}
});
