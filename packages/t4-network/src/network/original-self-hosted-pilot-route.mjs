// Actual HTTPS transport configuration for the existing installed RC.1
// profile. A selected native route is local consent, not a network grant.
// All frame/Index, signed JIT, CAS and readback remain in the existing ports.
import {request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {validateT4NetworkTopology,planT4NetworkRoute} from './network-topology.mjs';
const HEX=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const fail=code=>Object.assign(Error(code),{code});
const check=(ok,code)=>{if(!ok)throw fail(code);};
const CAPS=Object.freeze(['network.frame.read','network.frame.publish','network.frame.index.read','network.frame.index.publish']);
const certDigest=cert=>Buffer.isBuffer(cert?.raw)?createHash('sha256').update(cert.raw).digest('hex'):null;

// Do not change global process trust or follow redirects. Node's existing
// HTTPS client validates CA, validity and host before any HTTP credentials
// are sent. A separately confirmed leaf fingerprint confines this pilot.
// Existing WebDAV code owns deadlines, byte limits, HTTP status and retry.
function pinnedFetch({base,ca,certificateSha256,assertCurrent}){
  return async (input,options={})=>{
    assertCurrent();
    const url=new URL(input);
    check(url.origin===base.origin&&!url.username&&!url.password&&!url.search&&!url.hash&&
      url.pathname.startsWith(base.pathname)&&/^[a-f0-9]{64}\.t4[ni]$/.test(url.pathname.slice(base.pathname.length))&&
      ['GET','PUT'].includes(options.method)&&options.redirect==='manual'&&
      options.signal instanceof AbortSignal,'T4_PILOT_HTTPS_REQUEST_SCOPE_DENIED');
    const headers=new Headers(options.headers);
    check([...headers.keys()].every(k=>['authorization','if-match','if-none-match','content-type'].includes(k))&&
      /^Basic [A-Za-z0-9+/]+={0,2}$/.test(headers.get('authorization')??''),
      'T4_PILOT_HTTPS_REQUEST_SCOPE_DENIED');
    const body=options.body;
    check(options.method==='PUT'?body instanceof Uint8Array&&body.length>0&&
      headers.get('if-none-match')==='*':body===undefined,'T4_PILOT_HTTPS_REQUEST_SCOPE_DENIED');
    if(body!==undefined)headers.set('content-length',String(body.length));
    headers.set('accept-encoding','identity');
    const hostname=url.hostname.replace(/^\[|\]$/g,'');
    return new Promise((resolve,reject)=>{
      if(options.signal.aborted){reject(fail('T4_PILOT_HTTPS_ABORTED'));return;}
      const req=httpsRequest(url,{method:options.method,headers:Object.fromEntries(headers),agent:false,
        ca,rejectUnauthorized:true,minVersion:'TLSv1.2',signal:options.signal,
        checkServerIdentity(_host,cert){
          return checkServerIdentity(hostname,cert)??(certDigest(cert)!==certificateSha256?
            fail('T4_PILOT_HTTPS_CERTIFICATE_MISMATCH'):undefined);
        }},res=>{
        try{
          assertCurrent();
          check(res.headers['content-encoding']===undefined||res.headers['content-encoding']==='identity',
            'T4_PILOT_HTTPS_CONTENT_ENCODING_UNSUPPORTED');
          const responseHeaders=new Headers();
          for(const [key,value] of Object.entries(res.headers)){
            if(typeof value==='string')responseHeaders.set(key,value);
            else if(Array.isArray(value))for(const v of value)responseHeaders.append(key,v);
          }
          // Existing transport uses the streaming body, not a buffered copy.
          // Destroy the response when its existing controller is cancelled.
          const cancel=()=>res.destroy();
          options.signal.addEventListener('abort',cancel,{once:true});
          res.once('close',()=>options.signal.removeEventListener('abort',cancel));
          const stream=Readable.toWeb(res);
          if(options.signal.aborted)cancel();
          resolve({status:res.statusCode,headers:responseHeaders,body:stream});
        }catch(error){res.destroy();reject(error);}
      });
      req.on('error',reject);
      req.end(body);
    });
  };
}

export function createT4OriginalSelfHostedPilotRoute({
  workspaceId,objectFamily,serverNodeRef,localNodeRef,originalWriteOwnerRef,authorityRoot,
  getMode,isOriginalHostActive,readOriginalSelection,readOriginalAuthorization,
}={}){
  check([workspaceId,objectFamily,serverNodeRef,localNodeRef,originalWriteOwnerRef,authorityRoot].every(ID)&&
    localNodeRef!==serverNodeRef&&[getMode,isOriginalHostActive,readOriginalSelection,readOriginalAuthorization].every(f=>typeof f==='function'),
    'T4_PILOT_NATIVE_ROUTE_REQUIRED');
  const active=()=>{if(getMode()!=='T4_NETWORK'||isOriginalHostActive()!==true)throw fail('T4_PILOT_NATIVE_ROUTE_INACTIVE');};
  function selection(){
    active();
    const s=readOriginalSelection();
    check(s&&s.confirmed===true&&HEX(s.certificateSha256)&&typeof s.ca==='string'&&s.ca.length>0&&s.ca.length<=256*1024,
      'T4_PILOT_NATIVE_ROUTE_SELECTION_REQUIRED');
    const topology=validateT4NetworkTopology(s.topology);
    const route=CAPS.map(capability=>planT4NetworkRoute({topology,workspaceId,objectFamily,targetNodeRef:serverNodeRef,capability}));
    const place=topology.placements.find(x=>x.policy.workspaceId===workspaceId&&x.policy.objectFamily===objectFamily);
    check(topology.localNodeRef===localNodeRef&&place?.policy.authorityRoot===authorityRoot&&
      route.every(r=>r.executableByCurrentT4&&r.mode==='SELF_HOSTED'&&r.originalWriteOwnerRef===originalWriteOwnerRef&&r.endpointUrl===route[0].endpointUrl),
      'T4_PILOT_NATIVE_ROUTE_SCOPE_DENIED');
    active();
    return {topology,route:route[0],certificateSha256:s.certificateSha256,ca:s.ca};
  }
  const selected=selection(),base=new URL(selected.route.endpointUrl);
  const caDigest=s=>createHash('sha256').update(s).digest('hex');
  const selectedCA=caDigest(selected.ca);
  function assertCurrent(){
    const current=selection();
    check(current.topology.topologyDigest===selected.topology.topologyDigest&&
      current.certificateSha256===selected.certificateSha256&&caDigest(current.ca)===selectedCA,
      'T4_PILOT_NATIVE_ROUTE_CHANGED');
    return current.topology;
  }
  function matches(p){
    const r=selected.route;
    return p?.workspaceId===workspaceId&&p.objectFamily===objectFamily&&
      p.originalWriteOwnerRef===originalWriteOwnerRef&&p.targetNodeRef===serverNodeRef&&p.serverNodeRef===serverNodeRef&&
      p.topologyDigest===selected.topology.topologyDigest&&p.nativeWireProfile==='INDEXED'&&
      p.profileRef===r.profileRef&&p.locationRef===r.locationRef&&p.operatorRef===r.operatorRef&&
      p.endpointUrl===base.href&&CAPS.includes(p.operation);
  }
  return Object.freeze({topology:selected.topology,objectFamily,serverNodeRef,
    readOriginalTopology:()=>assertCurrent(),
    verifyOriginalEndpoint:p=>{assertCurrent();return matches(p);},
    authorizeOriginalOperation:p=>{
      assertCurrent();
      // The existing topology transport independently evaluates the exact
      // signed operation after this native consent check.
      return matches(p)&&p.storageLocationIsNotProtocolPeer===true&&
        p.originalSignedSubject?.principal_id===authorityRoot&&
        p.originalSignedSubject.workspace_id===workspaceId;
    },
    async getAuthorizationHeader(p){
      assertCurrent();
      check(p?.binding?.topologyDigest===selected.topology.topologyDigest&&p.workspaceId===workspaceId&&
        p.writeOwnerRef===originalWriteOwnerRef&&p.objectFamily===objectFamily&&p.profileRef===selected.route.profileRef&&
        p.operatorRef===selected.route.operatorRef&&p.locationRef===selected.route.locationRef&&
        CAPS.includes(p.operation?.slice(3)),'T4_PILOT_NATIVE_CREDENTIAL_SCOPE_DENIED');
      const value=await readOriginalAuthorization(Object.freeze({workspaceId,serverNodeRef,
        profileRef:selected.route.profileRef,topologyDigest:selected.topology.topologyDigest}));
      assertCurrent();
      check(typeof value==='string'&&value.length<=4096&&/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value),
        'T4_PILOT_NATIVE_CREDENTIAL_REQUIRED');
      return value;
    },
    fetchImpl:pinnedFetch({base,ca:selected.ca,certificateSha256:selected.certificateSha256,assertCurrent}),
  });
}
