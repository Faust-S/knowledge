// The installed IWXA T3 Host serves ONE already assembled original Kernel +
// signed AppShell dist on two isolated loopback origins. This is the product
// composition of the existing original Control HTTP and isolated UI server,
// not a replacement Kernel, IAM, Store, Service Worker or test-only Host.
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from "node:fs";
import {dirname,extname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {createOriginalControlHttpHandler} from "./original-control-http-handler.mjs";
import {createT3IsolatedUiServer} from "./isolated-ui-server.mjs";
import {digest} from "./access/core.mjs";
import {createOriginalKernelRegistryStatePort}
  from "./access/original-kernel-registry-state.mjs";
import {createOrganizationalOperationGate}
  from "./access/organizational-operation.mjs";
import {createOriginalPersonalAccessCheck}
  from "./access/original-personal-evaluator.mjs";
import {createOriginalVaultProofSigner}
  from "./access/original-vault-proof.mjs";
import {createWindowsOriginalVaultCustody}
  from "./access/windows-original-vault-custody.mjs";
import {createSignedAccessHostPort} from "./signed-access-host-port.mjs";

const LOCAL=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const SERVICE=/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const SAFE=/^\/(?:_iwxa|workspace)\/[A-Za-z0-9_./-]+$/;
const TYPES=Object.freeze({
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".wasm":"application/wasm",
  ".html":"text/html; charset=utf-8",
  ".png":"image/png",
  ".webp":"image/webp",
  ".ico":"image/x-icon",
  ".svg":"image/svg+xml",
  ".woff2":"font/woff2",
});
const MAX_FILE=128*1024*1024;
function deny(code){
  const e=new Error("T3_D1_INSTALLED_HOST_"+code);
  e.code="T3_D1_INSTALLED_HOST_"+code;
  throw e;
}
function required(ok,code){if(!ok)deny(code);}
function configOrigin(value){
  return value?.domain?.origin??value?.runtime?.origin??value?.origin;
}
function inside(root,target){
  const diff=relative(root,target);
  return diff!==""&&diff!==".."&&!diff.startsWith(".."+sep)&&
    !isAbsolute(diff);
}
/**
 * Trusted installed Host takes an already qualified one-dist. Neither the
 * browser nor user-imported .iwxa may supply its asset resolver, policy,
 * token, signer or Kernel. Native Windows Control supplies the signed
 * AccessRegistry owner callbacks from the SAME original Kernel.
 *
 * No TEST issuer or generated permissions are supplied by this function.
 * Without an existing authentic owner it refuses to start.
 */
export function createT3InstalledOriginalControlHost({
  distRoot,kernelOrigin,uiPort=null,token,subjectSession=null,
  ownerFor,currentEpoch,subscribeInvalidation,
}={}){
  required(typeof distRoot==="string"&&isAbsolute(distRoot)&&
    typeof kernelOrigin==="string"&&LOCAL.test(kernelOrigin)&&
    new URL(kernelOrigin).origin===kernelOrigin&&
    typeof token==="string"&&TOKEN.test(token),
    "TRUSTED_CONFIGURATION_REQUIRED");
  const port=Number(new URL(kernelOrigin).port);
  const chosenUiPort=uiPort??(port===65535?65534:port+1);
  required(Number.isSafeInteger(chosenUiPort)&&chosenUiPort>=1&&
    chosenUiPort<=65535&&chosenUiPort!==port,
    "ISOLATED_PORT_REQUIRED");
  required(subjectSession===null||isT3InstalledSubjectSession(subjectSession),
    "SUBJECT_SESSION_TRUSTED_HOST_REQUIRED");
  const uiOrigin="http://127.0.0.1:"+chosenUiPort;
  let root;
  try{
    root=realpathSync(resolve(distRoot));
    required(statSync(root).isDirectory(),"DIST_REQUIRED");
  }catch{deny("DIST_REQUIRED");}
  const assetForPath=path=>{
    // Resolve only installed, origin-pinned files. Never serve a symlink,
    // arbitrary URL-decoded path, directory listing or private credential.
    if(typeof path!=="string"||!SAFE.test(path)||
       path.includes("..")||path.includes("/.")||path.includes("//")||
       path.endsWith(".map")||path.endsWith(".iwxa"))return null;
    const type=TYPES[extname(path).toLowerCase()];
    if(!type)return null;
    const target=resolve(root,"."+path);
    if(!inside(root,target)||!existsSync(target))return null;
    try{
      if(!lstatSync(target).isFile())return null;
      const actual=realpathSync(target),stat=statSync(actual);
      if(!inside(root,actual)||!stat.isFile()||
         stat.size>MAX_FILE)return null;
      return {path:actual,type};
    }catch{return null;}
  };
  const requiredAsset=(path)=>{
    const asset=assetForPath(path);
    required(asset!==null,"DIST_MISSING_ASSET");
    return asset;
  };
  const config=JSON.parse(readFileSync(requiredAsset("/_iwxa/domain.json").path));
  const workspace=JSON.parse(readFileSync(
    requiredAsset("/workspace/workspace.config.json").path));
  const serviceId=workspace.workspace_service_id;
  required(configOrigin(config)===kernelOrigin&&
    typeof serviceId==="string"&&SERVICE.test(serviceId)&&
    config?.runtime?.runtime_version==="0.3.6"&&
    workspace?.host?.required_runtime_version==="0.3.6"&&
    workspace?.host?.required_contract_version==="1.3.0",
    "ORIGINAL_T2_RUNTIME_CONFIGURATION_REQUIRED");
  for(const path of [
    "/_iwxa/loader.js","/_iwxa/runtime/0.3.6/runtime.js",
    "/workspace/trusted-kernel-realm.html",
    "/workspace/isolated-signed-workspace.html",
  ])requiredAsset(path);
  const handler=createOriginalControlHttpHandler({
    origin:kernelOrigin,token,ownerFor,currentEpoch,subscribeInvalidation,
  });
  const kernel=createServer((req,res)=>{
    const send=(status,data,type="application/json; charset=utf-8",
      frame=false)=>{
      const headers={
        "Content-Type":type,"Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer",
        ...(frame?{}:{"X-Frame-Options":"DENY"}),
        "Content-Security-Policy":frame
          ? "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "+
            "style-src 'self'; connect-src 'self'; img-src 'self' data:; "+
            "frame-ancestors "+uiOrigin+"; base-uri 'none'; form-action 'none'"
          : "default-src 'none'; frame-ancestors 'none'",
      };
      res.writeHead(status,headers);
      res.end(Buffer.isBuffer(data)?data:typeof data==="string"?data:
        JSON.stringify(data));
    };
    if(req.headers.host!==new URL(kernelOrigin).host){
      send(403,{error:"T3_D1_INSTALLED_HOST_ORIGIN_DENIED"});return;
    }
    let pathname;
    try{pathname=new URL(req.url,kernelOrigin).pathname;}
    catch{pathname="/invalid";}
    if(pathname.startsWith("/api/t3/")){
      void Promise.resolve(handler(req,res)).catch(()=>{
        if(!res.headersSent)send(503,{error:"T3_D1_INSTALLED_HOST_CONTROL_UNAVAILABLE"});
      });
      return;
    }
    if(req.method!=="GET"){
      send(405,{error:"T3_D1_INSTALLED_HOST_METHOD_DENIED"});return;
    }
    if(pathname==="/workspace/t3-kernel-realm.json"){
      send(200,{schema:"IWXA_T3_TRUSTED_KERNEL_REALM/1",
        ui_origin:uiOrigin,service_id:serviceId});
      return;
    }
    const trustedFrame=pathname==="/workspace/trusted-kernel-realm.html";
    const allowed=pathname.startsWith("/_iwxa/")||
      trustedFrame||pathname.startsWith("/workspace/assets/");
    if(!allowed){
      send(404,{error:"T3_D1_INSTALLED_HOST_NOT_FOUND"});return;
    }
    const asset=assetForPath(pathname);
    if(!asset){
      send(404,{error:"T3_D1_INSTALLED_HOST_NOT_FOUND"});return;
    }
    try{send(200,readFileSync(asset.path),asset.type,trustedFrame);}
    catch{if(!res.headersSent)send(500,{error:"T3_D1_INSTALLED_HOST_ASSET_UNAVAILABLE"});}
  });
  kernel.requestTimeout=15000;
  kernel.headersTimeout=15000;
  const ui=createT3IsolatedUiServer({
    kernelOrigin,serviceId,assetForPath,uiPort:chosenUiPort,
  });
  let started=false,closing=false;
  const nativeChildren=new Set();
  const stopKernel=async()=>{
    if(!kernel.listening)return;
    kernel.closeAllConnections();
    await new Promise((resolve,reject)=>
      kernel.close(error=>error?reject(error):resolve()));
  };
  const launchUrl=()=>uiOrigin+"/workspace/#"+token;

  async function openNative({executablePath}={}){
    required(started&&!closing,"NOT_STARTED");
    required(process.platform==="win32","WINDOWS_NATIVE_REQUIRED");
    required(typeof executablePath==="string"&&isAbsolute(executablePath),
      "NATIVE_EXECUTABLE_REQUIRED");
    let binary;
    try{
      binary=realpathSync(executablePath);
      required(statSync(binary).isFile()&&binary.toLowerCase().endsWith(".exe"),
        "NATIVE_EXECUTABLE_REQUIRED");
    }catch{deny("NATIVE_EXECUTABLE_REQUIRED");}
    // Native OS menu gets only the existing issuer's public subject labels
    // and selection IDs. No corporate proof, private key, grant contents or
    // signed STATUS are serialized into this launch envelope.
    const contexts=subjectSession===null?[]:
      await subjectSession.availableContexts();
    const descriptor=subjectSession===null?launchUrl():JSON.stringify({
      schema:"IWXA_T3_NATIVE_CONTEXT_LAUNCH/1",
      url:subjectSession.currentContext()===null?null:launchUrl(),
      choices:contexts.map(x=>({selectionId:x.selectionId,label:x.label})),
    });
    required(Buffer.byteLength(descriptor,"utf8")<=64*1024,
      "NATIVE_SUBJECT_CHOICES_OVERSIZED");
    return await new Promise((resolve,reject)=>{
      const child=spawn(binary,[],{
        cwd:dirname(binary),windowsHide:false,
        // The one private stdout pipe is exclusively for native OS menu
        // activation, not a WebView/website IPC endpoint.
        stdio:["pipe",subjectSession===null?"ignore":"pipe","ignore"],
      });
      nativeChildren.add(child);
      let settled=false,buffer="",invalid=false;
      const denied=()=>{
        if(settled)return;
        settled=true;
        reject(Object.assign(new Error(
          "T3_D1_INSTALLED_HOST_NATIVE_LAUNCH_FAILED"),{
          code:"T3_D1_INSTALLED_HOST_NATIVE_LAUNCH_FAILED",
        }));
      };
      if(subjectSession!==null){
        child.stdout.on("data",part=>{
          if(invalid)return;
          buffer+=part.toString("utf8");
          if(Buffer.byteLength(buffer,"utf8")>4096){
            invalid=true;buffer="";
          }
        });
      }
      child.once("close",exitCode=>{
        nativeChildren.delete(child);
        if(subjectSession===null||closing||!started||exitCode!==0||invalid)
          return;
        // No arbitrary WebView event is a user confirmation. Only the
        // immutable installed EXE's native MENU handler can send this exact
        // single framed request on its private child-process stdout.
        const lines=buffer.split(/\r?\n/).filter(Boolean);
        if(lines.length!==1)return;
        let command;
        try{command=JSON.parse(lines[0]);}catch{return;}
        if(command?.schema!=="IWXA_T3_NATIVE_CONTEXT_EVENT/1"||
           command.kind!=="select"||
           typeof command.selectionId!=="string"||
           !contexts.some(x=>x.selectionId===command.selectionId))return;
        void (async()=>{
          try{
            // This is NOT a grant: the signed original issuer/AccessRegistry
            // must validate eligibility on every selection and JIT operation.
            await subjectSession.selectContext({
              selectionId:command.selectionId,userConfirmed:true,
            });
          }catch{
            // Fail closed, then return to the disconnected native chooser.
            subjectSession.invalidateSignedState();
          }
          if(started&&!closing)await openNative({executablePath:binary});
        })().catch(()=>{
          try{subjectSession.invalidateSignedState();}catch{}
        });
      });
      child.once("error",denied);
      child.once("spawn",()=>{
        if(settled)return;
        child.stdin.once("error",denied);
        // Control bearer is never placed in argv/env, on disk or in logs.
        child.stdin.end(descriptor+"\n",()=>{
          if(settled)return;
          settled=true;
          resolve(Object.freeze({pid:child.pid,launchMode:"WINDOWS_NATIVE",
            nativeContextMenu:subjectSession!==null}));
        });
      });
    });
  }

  return Object.freeze({
    async listen(){
      required(!started&&!closing,"ALREADY_STARTED");
      await new Promise((resolve,reject)=>{
        const onError=error=>{
          kernel.off("listening",onListening);reject(error);
        };
        const onListening=()=>{
          kernel.off("error",onError);resolve();
        };
        kernel.once("error",onError);
        kernel.once("listening",onListening);
        kernel.listen(port,"127.0.0.1");
      });
      try{
        const listenedUi=await ui.listen();
        required(listenedUi===uiOrigin,"ISOLATED_ORIGIN_CHANGED");
        started=true;
        return Object.freeze({kernelOrigin,uiOrigin,serviceId});
      }catch(error){await stopKernel();throw error;}
    },
    signedWorkspaceLaunchUrl(){
      required(started&&!closing,"NOT_STARTED");
      if(subjectSession!==null)
        required(subjectSession.currentContext()!==null,
          "SUBJECT_SESSION_NOT_SELECTED");
      return launchUrl();
    },
    launchNativeWindow:openNative,
    async close(){
      closing=true;
      // Closing the original Host cannot leave a WebView displaying an
      // apparently trusted corporate Workspace with a dead Control stream.
      for(const child of [...nativeChildren])child.kill();
      await ui.close();
      await stopKernel();
      started=false;
    },
  });
}



/**
 * Subject choice is a short-lived Host session pointer, NOT an IAM grant.
 * The installed native Control must explicitly present the existing trusted
 * PERSONAL/organization choices to the person. The issuer-supplied context
 * is checked again for every Kernel operation by the unchanged signed gate.
 *
 * Context switching increments the existing original Control HTTP epoch and
 * notifies its SSE subscribers BEFORE a new Workspace is opened. A stale
 * signed AppShell cannot continue under the next organization's selection.
 * No user-selected grant, new Store, new issuer or encrypted status cache.
 */
const originalSubjectSessions=new WeakSet();
export function isT3InstalledSubjectSession(value){
  return !!value&&typeof value==="object"&&originalSubjectSessions.has(value);
}
export function createT3InstalledSubjectSession({
  readCandidates,validateSelection,initialEpoch=1,
}={}){
  required(typeof readCandidates==="function"&&
    typeof validateSelection==="function"&&
    Number.isSafeInteger(initialEpoch)&&initialEpoch>=1,
    "SUBJECT_SESSION_TRUSTED_HOST_REQUIRED");
  const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
  let selected=null,epoch=initialEpoch,generation=0,closed=false;
  const subscribers=new Set();
  const active=()=>required(!closed,"SUBJECT_SESSION_CLOSED");
  const advance=()=>{
    required(epoch<Number.MAX_SAFE_INTEGER-1,
      "SUBJECT_SESSION_EPOCH_EXHAUSTED");
    epoch++;
    for(const listener of [...subscribers]){
      try{listener();}catch{/* A subscriber may not veto revocation. */}
    }
  };
  const verifiedCandidates=async()=>{
    const records=await readCandidates();
    active();
    required(Array.isArray(records)&&records.length<=128,
      "SUBJECT_SESSION_CANDIDATES_INVALID");
    const ids=new Set();
    const result=[];
    for(const row of records){
      const context=row?.context;
      required(typeof row?.selectionId==="string"&&
        ID.test(row.selectionId)&&!ids.has(row.selectionId)&&
        typeof row.label==="string"&&row.label.trim().length>0&&
        row.label.length<=120&&
        context&&typeof context==="object"&&!Array.isArray(context)&&
        ID.test(context.context_id??"")&&
        ID.test(context.actor_id??"")&&
        ID.test(context.workspace_id??"")&&
        context.resource===context.workspace_id&&
        ["PERSONAL","CORP"].includes(context.kind),
        "SUBJECT_SESSION_CANDIDATE_INVALID");
      if(context.kind==="PERSONAL"){
        required(context.organization_id===null&&
          context.principal_id===context.actor_id,
          "SUBJECT_SESSION_PERSONAL_SCOPE_INVALID");
      }else{
        required(ID.test(context.organization_id??"")&&
          context.organization_id===context.principal_id&&
          ID.test(context.grant_id??""),
          "SUBJECT_SESSION_CORPORATE_SCOPE_INVALID");
      }
      ids.add(row.selectionId);
      result.push({selectionId:row.selectionId,
        label:row.label,context:structuredClone(context)});
    }
    return result;
  };
  const api=Object.freeze({
    currentContext(){
      active();
      return selected?structuredClone(selected):null;
    },
    currentEpoch(){active();return epoch;},
    subscribeInvalidation(listener){
      active();
      required(typeof listener==="function",
        "SUBJECT_SESSION_LISTENER_REQUIRED");
      subscribers.add(listener);
      return ()=>subscribers.delete(listener);
    },
    async availableContexts(){
      const entries=await verifiedCandidates();
      return entries.map(row=>Object.freeze({
        selectionId:row.selectionId,label:row.label,
        kind:row.context.kind,
        organizationId:row.context.organization_id,
        workspaceId:row.context.workspace_id,
      }));
    },
    async selectContext({selectionId,userConfirmed}={}){
      active();
      required(userConfirmed===true,"SUBJECT_SESSION_USER_CONFIRMATION_REQUIRED");
      required(typeof selectionId==="string"&&ID.test(selectionId),
        "SUBJECT_SESSION_SELECTION_INVALID");
      const ticket=++generation;
      const candidates=await verifiedCandidates();
      const found=candidates.find(row=>row.selectionId===selectionId);
      required(found!==undefined,"SUBJECT_SESSION_CHOICE_UNAVAILABLE");
      // This trusted existing-authority callback inspects the issuer's
      // signed enrollment/state. Returning true is NOT a Kernel permission.
      const approved=await validateSelection(
        structuredClone(found.context),selectionId);
      active();
      required(ticket===generation,"SUBJECT_SESSION_SELECTION_SUPERSEDED");
      required(approved===true,"SUBJECT_SESSION_SELECTION_NOT_VERIFIED");
      selected=structuredClone(found.context);
      advance();
      return Object.freeze({
        schema:"IWXA_T3_SELECTED_SUBJECT_SESSION/1",
        kind:selected.kind,organizationId:selected.organization_id,
        workspaceId:selected.workspace_id,contextEpoch:epoch,
      });
    },
    invalidateSignedState(){
      active();
      generation++;
      selected=null;
      advance();
    },
    close(){
      if(closed)return;
      generation++;
      selected=null;
      advance();
      closed=true;
      subscribers.clear();
    },
  });
  originalSubjectSessions.add(api);
  return api;
}

/**
 * Bind the existing installed Control HTTP owner to the SAME original signed
 * AccessRegistry in Kernel/Store and the SAME Windows DPAPI Ed25519 vault.
 * No test issuer, new IAM, second Store, local authority cache or separate
 * private-key format is constructed here.
 *
 * The installed trusted Host supplies an ORIGINAL KernelFacade, its pinned
 * signed policy, a synchronous selected context, and exact user-approved
 * signed enrollment inputs from the original issuer. Mere possession of a
 * public credential never authorizes a corporate operation. Selection epoch
 * and invalidation remain owned by createOriginalControlHttpHandler's Host.
 */
export function createT3InstalledWindowsSignedControlOwner({
  registryKernel,registryWorkspaceId,trustedPolicy,vaultPath,
  currentContext,actionFor,operationDigest,subjectSession=null,
  personalCredentialKeyId=null,
  organizationInputFor=null,
  clock=Date.now,randomUUID=()=>globalThis.crypto?.randomUUID(),
}={}){
  required(process.platform==="win32","WINDOWS_NATIVE_REQUIRED");
  required((subjectSession===null?typeof currentContext==="function":
      isT3InstalledSubjectSession(subjectSession)&&
      currentContext===undefined)&&
    typeof actionFor==="function"&&
    typeof operationDigest==="function"&&
    typeof clock==="function"&&
    typeof randomUUID==="function"&&
    (personalCredentialKeyId!==null||
      typeof organizationInputFor==="function"),
    "ORIGINAL_SIGNED_OWNER_REQUIRED");
  required(organizationInputFor===null||
    typeof organizationInputFor==="function",
    "ORIGINAL_CORPORATE_ENROLLMENT_REQUIRED");
  required(personalCredentialKeyId===null||
    (typeof personalCredentialKeyId==="string"&&
      /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(personalCredentialKeyId)),
    "ORIGINAL_PERSONAL_CREDENTIAL_REQUIRED");
  // The original Kernel-persisted registry remains the only signed STATUS
  // authority. Its root policy is pinned by this trusted Host, never by UI.
  const registry=createOriginalKernelRegistryStatePort({
    kernel:registryKernel,workspaceId:registryWorkspaceId,
    trustedPolicy,clock,
  });
  const custody=createWindowsOriginalVaultCustody({vaultPath});
  const personal=personalCredentialKeyId===null?undefined:{
    check:createOriginalPersonalAccessCheck({
      readState:()=>registry.readState(),
      signProof:createOriginalVaultProofSigner({
        keyId:personalCredentialKeyId,
        readEncryptedVault:custody.readEncryptedVault,
        unlockPassphrase:custody.unlockPassphrase,
      }),
      clock,randomUUID,
    }),
  };
  const corporate=organizationInputFor===null?undefined:{
    productId:"IWXA_CONTROL_CENTER",
    gate:createOrganizationalOperationGate({registry}),
    inputFor:organizationInputFor,
    // The organization and issued key are bound by the ORIGINAL signed
    // enrollment gate immediately before signing; never use a stored
    // browser-selected key, arbitrary issuer or cached grant.
    prove:async ({request,challenge,credentialKeyId,context,asOf})=>{
      required(context?.kind==="CORP"&&
        typeof context.organization_id==="string"&&
        typeof credentialKeyId==="string",
        "ORIGINAL_CORPORATE_SELECTION_REQUIRED");
      return createOriginalVaultProofSigner({
        keyId:credentialKeyId,
        organizationId:context.organization_id,
        readEncryptedVault:custody.readEncryptedVault,
        unlockPassphrase:custody.unlockPassphrase,
      })({request,challenge,credentialKeyId,context,asOf});
    },
  };
  const selectedContext=subjectSession===null?currentContext:
    subjectSession.currentContext;
  const createPort=(resolver)=>createSignedAccessHostPort({
    currentContext:resolver,actionFor,operationDigest,
    canonicalDigest:digest,personal,corporate,clock,randomUUID,
  });
  // A pre-switch port must never silently acquire the NEXT organization's
  // identity after a native context switch. In the browser the original
  // Control HTTP additionally enforces epoch on each request and SSE.
  const originalSignedPort=subjectSession===null
    ?createPort(selectedContext):null;
  return Object.freeze({
    ownerFor:async ({scope})=>{
      if(scope!=="kernel"||selectedContext()===null)return null;
      if(subjectSession===null)return originalSignedPort;
      const expectedEpoch=subjectSession.currentEpoch();
      return createPort(()=>{
        required(subjectSession.currentEpoch()===expectedEpoch,
          "SUBJECT_SESSION_STALE_OWNER");
        const context=subjectSession.currentContext();
        required(context!==null,"SUBJECT_SESSION_NOT_SELECTED");
        return context;
      });
    },
    ...(subjectSession===null?{}:{
      currentEpoch:subjectSession.currentEpoch,
      subscribeInvalidation:subjectSession.subscribeInvalidation,
      availableContexts:subjectSession.availableContexts,
      selectContext:subjectSession.selectContext,
      invalidateSignedState:subjectSession.invalidateSignedState,
    }),
    credentialInventory:()=>custody.inventory(),
    // Trusted Host-only signed issuer import. Returns only public fields.
    enrollCredential:issued=>custody.enrollCredential(issued),
    // The native Host uses the original Kernel to commit signed STATUS.
    // This port does not expose a browser control endpoint by itself.
    registry,
  });
}
