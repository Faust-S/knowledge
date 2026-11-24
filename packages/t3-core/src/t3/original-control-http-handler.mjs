// Trusted Kernel/Host HTTP ROUTE for the existing T3 Control loopback protocol.
// Attach to the same installed original Host server; this is not a new server,
// IAM, signer, Store, license authority, or alternate Kernel transport.
// The Host supplies the existing signed owner, monotonic context epoch and
// genuine invalidation subscription. The UI sees only scoped decisions.
import {timingSafeEqual,createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {strictJson} from "./access/strict-json.mjs";
import {canonical} from "./access/core.mjs";

const LOCAL=/^https?:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const MAX_BODY=512*1024;
// The original private D3 recipient and Center native picker both admit 32 MiB.
// Base64url JSON overhead must fit the SAME signed Control route.
const MAX_D3_ARCHIVE=32*1024*1024;
const MAX_D3_BODY=Math.ceil(MAX_D3_ARCHIVE/3)*4+16*1024;
const D3_VERBS=new Set(["available","receive","preview","receipt","accept","reject",
  "inspectAcceptedApplication","applyAccepted","recoverApplied"]);
const D3_METHODS=["receive","preview","receipt","accept","reject","inspectAcceptedApplication"];
// The SAME local Control/SSE/epoch serves optional original D7 product owners.
// No private age identity, Publisher signer, licence state or credentials cross
// this route. These historical native owners support 32 MiB / 4 MiB respectively.
const D7_ARCHIVE=32*1024*1024,D7_CIPHER=33*1024*1024,D7_LICENSE=4*1024*1024;
const MAX_D7_BODY=Math.ceil(D7_CIPHER*4/3)+16*1024;
// An installed D6 owner supplies the existing signed native Result port.
// Only references and original receipts cross Control; source Objects do not.
const D6_VERBS=new Set(["available","preview","continueSelected","recover"]);
const D6_STATUSES=new Set(["AVAILABLE","RECOVER_ONLY","OPERATION_IN_PROGRESS",
  "USER_CANCELLED","OUTCOME_UNKNOWN","OWNER_READBACK_CONFIRMED"]);
const D6_FIELDS=["status","operationId","recipientId","resultRef","reference","reason"];
function d6Reference(input){
  const ref=input?.reference;
  requireThat(ref&&typeof ref==="object"&&!Array.isArray(ref)&&
    REF.test(ref.workspace_id??"")&&REF.test(ref.object_id??"")&&
    REF.test(ref.schema_id??"")&&Number.isSafeInteger(ref.revision)&&
    ref.revision>0,"T3_D6_SELECTED_REFERENCE_INVALID");
  return Object.freeze({workspace_id:ref.workspace_id,object_id:ref.object_id,
    schema_id:ref.schema_id,revision:ref.revision});
}
const D7_VERBS=new Set(["available","age.currentRecipient","age.prepareSeal",
  "age.seal","age.open","age.previewImport","age.commitImport","age.cancelImport",
  "age.readbackImport",
  "publisher.currentSubject","publisher.inspect",
  "publisher.apply","publisher.receipt","publisher.statusReadback"]);
const D7_AGE=["currentRecipient"];
const D7_PUBLISHER=["currentSubject","inspect","apply","receipt","statusReadback"];
const D7_INSPECT_FIELDS=["kind","packageSha256","previewDigest","holderId",
  "recipientId","publisherId","issuerAuthorityId","operationId","licenseId",
  "sequence","statusSchema","statusPayloadDigest","scope","entries",
  "publisherSignatureVerified","pinnedPublisherTrusted","stage"];
const D7_IMPORT_RECEIPT_FIELDS=["import_id","format","format_version",
  "package_digest","semantic_digest","mode","conflict_policy",
  "committed_at","applied","skipped_conflicts","workspace_id_map",
  "excluded_by_permission","cancelled"];
const D7_RECEIPT_FIELDS=["kind","operationId","packageSha256","holderId",
  "recipientId","issuerAuthorityId","state","licenseId","sequence",
  "statusPayloadDigest","persisted","statusSequenceFloor"];
const d7Public=(raw,fields)=>Object.fromEntries(fields.filter(k=>
  Object.hasOwn(raw??{},k)).map(k=>[k,raw[k]]));
function d7Bytes(encoded,limit){
  requireThat(typeof encoded==="string"&&encoded.length>0&&
    encoded.length<=Math.ceil(limit/3)*4+4&&
    /^[A-Za-z0-9_-]+$/.test(encoded),"T3_D7_NATIVE_BYTES_INVALID");
  const result=Buffer.from(encoded,"base64url");
  requireThat(result.length>0&&result.length<=limit&&
    result.toString("base64url")===encoded,"T3_D7_NATIVE_BYTES_INVALID");
  return result;
}
const d7Digest=bytes=>createHash("sha256").update(bytes).digest("hex");
async function d7Recipient(age){
  const current=d7Public(await age.currentRecipient(),["recipientId","bindingEpoch"]);
  requireThat(REF.test(current.recipientId??"")&&REF.test(current.bindingEpoch??""),
    "T3_D7_ORIGINAL_NATIVE_RECIPIENT_REQUIRED");
  return current;
}
async function d7Subject(publisher){
  const current=d7Public(await publisher.currentSubject(),
    ["holderId","recipientId","subjectType","bindingEpoch"]);
  requireThat(REF.test(current.holderId??"")&&REF.test(current.recipientId??"")&&
    REF.test(current.bindingEpoch??"")&&
    ["PERSON","ORGANIZATION"].includes(current.subjectType),
    "T3_D7_ORIGINAL_NATIVE_HOLDER_UNBOUND");
  return current;
}
const d7Same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const SCOPES=new Set(["kernel","activity"]);
// On the trusted signed Kernel origin, ALL compiled unsigned HTML entries
// must be blocked, not just the root Workspace page. The normal T2 site
// does not attach this split-origin Control route and remains unchanged.
const UNSIGNED_HTML_ENTRIES=new Set([
  "/","/index.html",
  "/workspace/","/workspace/index.html",
  "/workspace/exchange","/workspace/exchange/","/workspace/exchange/index.html",
  "/workspace/exchange.html",
  "/workspace/lifecycle","/workspace/lifecycle/","/workspace/lifecycle/index.html",
  "/workspace/lifecycle.html",
  "/workspace/studio","/workspace/studio/","/workspace/studio/index.html",
  "/workspace/studio.html",
  // This entry belongs ONLY to the independently isolated UI origin.
  "/workspace/isolated-signed-workspace.html",
]);
const OWNER_FIELDS=["currentContext","actionFor","operationDigest",
  "authorize","verifyDecisionBinding"];
function refused(code){
  const e=new Error(code);e.name="T3OriginalControlRouteError";
  e.code=code;e.outcome="DENIED";throw e;
}
function requireThat(ok,code){if(!ok)refused(code);}
function reply(res,status,value){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer"});
  res.end(JSON.stringify(value));
}
async function bodyFrom(req,limit=MAX_BODY){
  const parts=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    requireThat(total<=limit,limit===MAX_BODY
      ?"T3_D1_CONTROL_BODY_TOO_LARGE":limit===MAX_D7_BODY
        ?"T3_D7_NATIVE_CARRIER_TOO_LARGE":"T3_D3_CARRIER_TOO_LARGE");
    parts.push(chunk);
  }
  let result;
  try{result=strictJson(Buffer.concat(parts).toString("utf8"),
    {maxLength:limit});}
  catch{refused("T3_D1_CONTROL_JSON_INVALID");}
  requireThat(result&&typeof result==="object"&&!Array.isArray(result),
    "T3_D1_CONTROL_REQUEST_INVALID");
  return result;
}
function errorCode(error){
  const code=error?.code;
  return typeof code==="string"&&/^[A-Z][A-Z0-9_]{4,99}$/.test(code)
    ?code:"T3_D1_CONTROL_OPERATION_DENIED";
}
export function createOriginalControlHttpHandler({
  origin,token,readToken=null,ownerFor,currentEpoch,subscribeInvalidation,
  uiOrigin=null,serviceId=null,assetForPath=null,
  // The original installed native Agent may embed the isolated UI as a
  // grandparent of this Kernel frame. Only its pinned exact loopback origin
  // is eligible; ordinary domain routes always remain parent-less.
  installedParentOrigin=null,
  reconciliationPortFor=null,nativeD7PortFor=null,nativeD6PortFor=null,
  originalKernelRelayFor=null,
}={}){
  requireThat(typeof origin==="string"&&LOCAL.test(origin)&&
    new URL(origin).origin===origin,"T3_D1_CONTROL_ORIGIN_REQUIRED");
  requireThat(typeof token==="string"&&TOKEN.test(token)&&
    (readToken===null||typeof readToken==="function")&&
    typeof ownerFor==="function"&&typeof currentEpoch==="function"&&
    typeof subscribeInvalidation==="function",
    "T3_D1_CONTROL_TRUSTED_HOST_REQUIRED");
  // The existing Host owns both loopback origins. Do not serve a signed
  // Workspace launch without a pinned, separately isolated UI origin.
  const splitOrigin=uiOrigin!==null||serviceId!==null;
  if(splitOrigin)requireThat(
    typeof uiOrigin==="string"&&/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(uiOrigin)&&
    new URL(uiOrigin).origin===uiOrigin&&uiOrigin!==origin&&
    typeof serviceId==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{1,159}$/.test(serviceId),
    "T3_D1_CONTROL_ISOLATED_UI_REQUIRED");
  requireThat(installedParentOrigin===null||(
    splitOrigin&&typeof installedParentOrigin==="string"&&
    /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(installedParentOrigin)&&
    new URL(installedParentOrigin).origin===installedParentOrigin&&
    installedParentOrigin!==origin&&installedParentOrigin!==uiOrigin
  ),"T3_D6_INSTALLED_PARENT_ORIGIN_INVALID");
  requireThat(assetForPath===null||typeof assetForPath==="function",
    "T3_D1_CONTROL_TRUSTED_ASSET_RESOLVER_REQUIRED");
  // The installed native Host supplies an ORIGINAL recipient-owned D3 port.
  // Nothing in this HTTP handler constructs a Reconciler or a second Ledger.
  requireThat(reconciliationPortFor===null||typeof reconciliationPortFor==="function",
    "T3_D3_ORIGINAL_RECIPIENT_PROVIDER_INVALID");
  // Optional ORIGINAL Kernel realm relay for the SAME signed native D3
  // owner. It transports already-authorized commands, not a browser grant,
  // second Kernel, Store, Reconciler or independent HTTP listener.
  requireThat(originalKernelRelayFor===null||
    typeof originalKernelRelayFor==="function",
    "T3_D3_ORIGINAL_KERNEL_RELAY_PROVIDER_INVALID");
  // The installed product injects its already-existing original native
  // owners. No public key custody, issuer, decision engine or OS API is built
  // here. A native age seal must independently obtain original signed D1
  // read + native Human confirmation via authorizeAgeSeal.
  requireThat(nativeD7PortFor===null||typeof nativeD7PortFor==="function",
    "T3_D7_ORIGINAL_NATIVE_OWNER_PROVIDER_INVALID");
  // The installed product must bind its existing signed D6 continuation
  // to the ORIGINAL Kernel/owner before supplying this port. We never accept
  // an untrusted browser-selected owner or raw Object for native delivery.
  requireThat(nativeD6PortFor===null||typeof nativeD6PortFor==="function",
    "T3_D6_ORIGINAL_NATIVE_OWNER_PROVIDER_INVALID");
  // Only an in-process duplicate guard. The ORIGINAL installed Publisher
  // remains the durable idempotency and STATUS-floor authority.
  const nativePublisherInFlight=new Set();
  const nativePublisherDispatched=new Set();
  // Import preview tokens belong to the ORIGINAL installed Kernel. A lost
  // reply cannot authorize a second native import. This is an in-process
  // duplicate claim only; durable recovery remains the original owner's job.
  const nativeAgeImportInFlight=new Set();
  const nativeAgeImportDispatched=new Set();
  // A native import/cancel must consume a preview issued by THIS Control
  // after the ORIGINAL installed age recipient verified the encrypted file.
  // This is only an ephemeral, bounded binding. Original Kernel/recipient
  // remains the only persistence and recovery authority.
  const nativeAgePreviewClaims=new Map();
  const agePreviewClaim=key=>{
    const claim=nativeAgePreviewClaims.get(key);
    if(claim&&claim.expiresAt<=Date.now()){
      nativeAgePreviewClaims.delete(key);
      return null;
    }
    return claim??null;
  };
  const rememberAgePreview=(key,handle)=>{
    for(const [oldKey,claim] of nativeAgePreviewClaims)
      if(claim.expiresAt<=Date.now())nativeAgePreviewClaims.delete(oldKey);
    requireThat(!nativeAgeImportDispatched.has(key)&&
      !nativeAgePreviewClaims.has(key)&&nativeAgePreviewClaims.size<256,
      "T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
    nativeAgePreviewClaims.set(key,Object.freeze({
      packageDigest:handle.package_digest,
      semanticDigest:handle.semantic_digest,
      allowedModes:Object.freeze([...handle.allowed_modes]),
      expiresAt:Date.parse(handle.expires_at),
    }));
  };
  // D6 ports may be reconstructed by installed products for each HTTP call.
  // This Host-lifetime claim prevents concurrent native writes and a second
  // dispatch after a lost reply, without replacing native durable receipts.
  const nativeD6InFlight=new Set();
  const nativeD6Attempted=new Set();
  // D3 may reconstruct the ORIGINAL recipient port for each HTTP request.
  // Protect the SAME Host lifetime against racing decisions and Apply writes
  // (including lost ACK). Durable receipts remain ONLY with the original
  // Reconciler/Kernel, accessible via receipt() and recoverApplied().
  const nativeD3InFlight=new Set();
  const nativeD3Attempted=new Set();
  const d3WriteKey=(verb,payload)=>{
    if(verb==="accept"||verb==="reject"){
      requireThat(REF.test(payload.operationId??"")&&
        HEX.test(payload.packageSha256??""),
        "T3_D3_RECIPIENT_REQUEST_INVALID");
      // Same signed package+decision may not be sent a second time after
      // the signed subject's contextEpoch rotates inside this Host.
      // Exact SHA separates two independent original recipients; the
      // original Reconciler still decides whether an ID is admissible.
      return JSON.stringify(["decision",payload.operationId,
        payload.packageSha256]);
    }
    if(verb!=="applyAccepted")return null;
    const revisions=payload.revisionIds;
    const target=payload.target;
    requireThat(HEX.test(payload.acceptanceId??"")&&
      Array.isArray(revisions)&&revisions.length>0&&revisions.length<=32&&
      revisions.every(x=>HEX.test(x))&&
      new Set(revisions).size===revisions.length&&
      target&&typeof target==="object"&&!Array.isArray(target)&&
      ["consumerId","processId","processVersion","purpose","subjectId",
        "workspaceId","dataRootId"].every(x=>REF.test(target[x]??"")),
      "T3_D3_APPLICATION_SELECTION_REQUIRED");
    // The ORIGINAL owner binds these to its sealed effect key. Epoch is
    // deliberately excluded: a signed-role switch must not reopen the
    // same already-dispatched selected Apply within this Host lifetime.
    // This volatile claim never substitutes for original durable readback.
    return JSON.stringify(["apply",payload.acceptanceId,
      [...revisions].sort(),["consumerId","processId","processVersion",
        "purpose","subjectId","workspaceId","dataRootId"].map(x=>target[x])]);
  };
  const d3DefinitelyNotDispatched=(verb,code)=>
    (verb==="accept"||verb==="reject")
      ?["T3_D3_HUMAN_REVIEW_REQUIRED","T3_D3_PREVIEW_STALE",
        "T3_D3_ORIGINAL_ACCEPTANCE_NOT_ELIGIBLE",
        "T3_D3_DECISION_ACTOR_MISMATCH","T3_D3_EXPLICIT_DECISION_REQUIRED"]
          .includes(code)
      :verb==="applyAccepted"&&
        ["T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED",
         "T3_D3_ORIGINAL_SEALED_APPLICATION_REQUIRED",
         "T3_D3_ORIGINAL_GRAPH_PROVENANCE_REQUIRED",
         "T3_D3_ORIGINAL_APPLICATION_TARGET_INCOMPLETE",
         // The original D3 owner now checks the signed T2 Workspace before
         // Human APPLY and commitObjectGraph. Only these exact pre-dispatch
         // refusals are safe to release from the Control's no-replay claim,
         // so the manager can repair the SAME Workspace and approve anew.
         // WORKSPACE_NOT_FOUND after a possible write is never safe.
         "T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED",
         "T3_D3_ORIGINAL_WORKSPACE_DELETED",
         "T3_D3_ORIGINAL_WORKSPACE_READ_ONLY"].includes(code);
  // The original installed Host may rotate its ephemeral bearer whenever
  // its existing signed subject session changes. This is a transient
  // transport credential only, NEVER a grant, issuer or AccessRegistry.
  const credential=()=>{
    const active=readToken===null?token:readToken();
    requireThat(typeof active==="string"&&TOKEN.test(active),
      "T3_D1_CONTROL_SESSION_UNAVAILABLE");
    return Buffer.from("Bearer "+active);
  };
  const expectedHost=new URL(origin).host;
  const epochNow=async()=>{
    const value=await currentEpoch();
    requireThat(Number.isSafeInteger(value)&&value>=0,
      "T3_D1_CONTROL_EPOCH_UNAVAILABLE");
    return value;
  };
  const identity=value=>canonical(value);
  const authenticated=req=>{
    const submitted=Buffer.from(req.headers.authorization??"");
    const expected=credential();
    return submitted.length===expected.length&&
      timingSafeEqual(submitted,expected);
  };
  return async function handleOriginalControl(req,res){
    let route;
    try{route=new URL(req.url,origin).pathname;}
    catch{route="/api/t3/invalid";}
    const signedUi=route==="/workspace/t3-signed-ui.json";
    const trustedRealm=route==="/workspace/t3-kernel-realm.json";
    const trustedEntry=route==="/workspace/trusted-kernel-realm.html";
    const signedEntry=route==="/workspace/signed-workspace.html";
    const rawEntry=UNSIGNED_HTML_ENTRIES.has(route);
    if(!route.startsWith("/api/t3/")&&!signedUi&&!trustedRealm&&
       !trustedEntry&&!(splitOrigin&&(signedEntry||rawEntry)))
      return false;
    try{
      requireThat(req.headers.host===expectedHost,
        "T3_D1_CONTROL_ORIGIN_DENIED");
      if(signedUi||trustedRealm||trustedEntry||signedEntry||rawEntry){
        requireThat(splitOrigin,"T3_D1_CONTROL_ISOLATED_UI_REQUIRED");
        requireThat(req.method==="GET","T3_D1_CONTROL_METHOD_DENIED");
        if(rawEntry)
          refused("T3_D1_RAW_T2_WORKSPACE_DISABLED");
        if(signedEntry){
          // A T3-updated product must not expose the inherited unsigned
          // T2 AppShell on this origin. Serve only the forwarding entry.
          requireThat(assetForPath!==null,"T3_D1_CONTROL_SIGNED_ENTRY_NOT_INSTALLED");
          const asset=assetForPath(route);
          requireThat(asset&&typeof asset.path==="string"&&
            asset.type?.startsWith("text/html"),
            "T3_D1_CONTROL_SIGNED_ENTRY_NOT_INSTALLED");
          const html=readFileSync(asset.path);
          requireThat(html.toString("utf8").includes('<base href="/workspace/"')&&
            /\b(?:src|href)="\/workspace\/assets\/[A-Za-z0-9_.\/-]+"/.test(html.toString("utf8")),
            "T3_D1_CONTROL_SIGNED_ENTRY_INVALID");
          res.writeHead(200,{
            "Content-Type":"text/html; charset=utf-8",
            "Cache-Control":"no-store",
            "X-Content-Type-Options":"nosniff",
            "Referrer-Policy":"no-referrer",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self'; connect-src 'self'; "+
              "base-uri 'self'; frame-ancestors 'none'",
          });
          res.end(html);
          return true;
        }
        if(trustedEntry){
          // The original Host serves its OWN compiled trusted realm. Without
          // this route, an inherited static host could apply a generic CSP
          // that blocks the cross-origin frame or accidentally serve T2 UI.
          requireThat(assetForPath!==null,"T3_D1_CONTROL_TRUSTED_REALM_NOT_INSTALLED");
          const asset=assetForPath(route);
          requireThat(asset&&typeof asset.path==="string"&&
            asset.type?.startsWith("text/html"),
            "T3_D1_CONTROL_TRUSTED_REALM_NOT_INSTALLED");
          const html=readFileSync(asset.path);
          const source=html.toString("utf8");
          requireThat(source.includes('<base href="/workspace/"')&&
            /\b(?:src|href)="\/workspace\/assets\/[A-Za-z0-9_.\/-]+"/.test(source),
            "T3_D1_CONTROL_TRUSTED_REALM_INVALID");
          res.writeHead(200,{
            "Content-Type":"text/html; charset=utf-8",
            "Cache-Control":"no-store",
            "X-Content-Type-Options":"nosniff",
            "Referrer-Policy":"no-referrer",
            "Content-Security-Policy":
              "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "+
              "connect-src 'self'; base-uri 'none'; frame-ancestors "+uiOrigin+
                (installedParentOrigin===null?"":" "+installedParentOrigin),
          });
          res.end(html);
          return true;
        }
        reply(res,200,signedUi?{
          schema:"IWXA_T3_SIGNED_WORKSPACE_LAUNCH/1",
          kernel_origin:origin,ui_origin:uiOrigin,service_id:serviceId,
        }:{
          schema:"IWXA_T3_TRUSTED_KERNEL_REALM/1",
          ui_origin:uiOrigin,service_id:serviceId,
        });
        return true;
      }
      if(!authenticated(req)){
        reply(res,401,{error:"T3_D1_CONTROL_SESSION_UNAVAILABLE"});
        return true;
      }
      if(route==="/api/t3/context-epoch"){
        requireThat(req.method==="GET","T3_D1_CONTROL_METHOD_DENIED");
        const contextEpoch=await epochNow();
        // Even a GET that started with the previous bearer cannot return
        // the new subject's epoch if the Host rotated during its await.
        requireThat(authenticated(req),"T3_D1_CONTROL_SESSION_ROTATED");
        reply(res,200,{contextEpoch});
        return true;
      }
      if(route==="/api/t3/owner-events"){
        requireThat(req.method==="GET"&&
          req.headers.accept?.includes("text/event-stream"),
          "T3_D1_CONTROL_STREAM_REQUIRED");
        const epoch=await epochNow();
        requireThat(authenticated(req),"T3_D1_CONTROL_SESSION_ROTATED");
        const subscription=subscribeInvalidation(()=>{
          if(!res.destroyed)res.write("event: invalidated\ndata: {}\n\n");
        });
        requireThat(typeof subscription==="function",
          "T3_D1_CONTROL_INVALIDATION_REQUIRED");
        res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8",
          "Cache-Control":"no-store","Connection":"keep-alive",
          "X-Content-Type-Options":"nosniff"});
        let done=false;
        const close=()=>{if(done)return;done=true;subscription();};
        res.once("close",close);
        // If the original Host changed context between attachment and
        // readiness, revoke immediately. POSTs also check current epoch.
        if(await epochNow()!==epoch||!authenticated(req))
          res.write("event: invalidated\ndata: {}\n\n");
        else res.write("event: ready\ndata: {}\n\n");
        return true;
      }
      requireThat(route==="/api/t3/owner"||route==="/api/t3/reconciliation"||
        route==="/api/t3/native-d7"||route==="/api/t3/native-d6"||
        route==="/api/t3/original-kernel",
        "T3_D1_CONTROL_ROUTE_DENIED");
      requireThat(req.method==="POST"&&req.headers.origin===origin&&
        /^application\/json\b/i.test(req.headers["content-type"]??""),
        "T3_D1_CONTROL_POST_ORIGIN_DENIED");
      const requestEpoch=req.headers["x-iwxa-context-epoch"];
      const before=await epochNow();
      requireThat(authenticated(req),"T3_D1_CONTROL_SESSION_ROTATED");
      requireThat(typeof requestEpoch==="string"&&
        requestEpoch===String(before),"STALE_CONTEXT_OPERATION");
      const input=await bodyFrom(req,
        route==="/api/t3/reconciliation"||
          route==="/api/t3/original-kernel"
        ?MAX_D3_BODY:route==="/api/t3/native-d7"?MAX_D7_BODY:MAX_BODY);
      if(route==="/api/t3/original-kernel"){
        // The compiled trusted Kernel realm is the ONLY client of this
        // endpoint. Original Control epoch, signed bearer and exact Origin
        // are checked before AND after dispatch; native owns the queue.
        requireThat(originalKernelRelayFor!==null&&
          ["attach","next","result","detach","sourceMutation"].includes(input.verb)&&
          input.payload&&typeof input.payload==="object"&&
          !Array.isArray(input.payload),
          "T3_D3_ORIGINAL_KERNEL_RELAY_NOT_AVAILABLE");
        const relay=await originalKernelRelayFor({contextEpoch:before});
        requireThat(relay&&typeof relay.exchange==="function",
          "T3_D3_ORIGINAL_KERNEL_RELAY_NOT_AVAILABLE");
        requireThat(before===await epochNow()&&authenticated(req),
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        const result=await relay.exchange(input,before);
        requireThat(before===await epochNow()&&authenticated(req),
          "T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED");
        reply(res,200,{result});
        return true;
      }
      if(route==="/api/t3/native-d6"){
        requireThat(D6_VERBS.has(input.verb)&&input.payload&&
          typeof input.payload==="object"&&!Array.isArray(input.payload),
          "T3_D6_NATIVE_REQUEST_INVALID");
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        const port=nativeD6PortFor===null?null:await nativeD6PortFor({
          contextEpoch:before,
        });
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        const ready=port&&typeof port.preview==="function"&&
          typeof port.continueSelected==="function"&&
          typeof port.recover==="function";
        if(input.verb==="available"){
          reply(res,200,{result:{available:!!ready}});
          return true;
        }
        requireThat(ready,"T3_D6_ORIGINAL_NATIVE_OWNER_UNAVAILABLE");
        const reference=d6Reference(input.payload);
        const nativeWrite=input.verb==="continueSelected";
        const key=JSON.stringify([before,reference.workspace_id,
          reference.object_id,reference.schema_id,reference.revision]);
        if(nativeWrite){
          if(nativeD6InFlight.has(key)){
            reply(res,200,{result:{status:"OPERATION_IN_PROGRESS"}});
            return true;
          }
          if(nativeD6Attempted.has(key)){
            reply(res,200,{result:{status:"OUTCOME_UNKNOWN"}});
            return true;
          }
          // Claim before any await inside the original Human/Kernel owner.
          nativeD6InFlight.add(key);
          nativeD6Attempted.add(key);
        }
        let observed;
        try{
          observed=await port[input.verb](reference);
          // A declined Human review is not a native write, so retrying
          // with fresh consent remains possible. All uncertain outcomes
          // require the independent original recover() path.
          if(nativeWrite&&observed?.status==="USER_CANCELLED")
            nativeD6Attempted.delete(key);
        }catch(error){
          // An original installed owner may explicitly DENY a native action,
          // including a JIT Atlas permission check or signed readback.
          // Preserve that verified refusal; a transport error or unclassified
          // native exception after dispatch remains outcome-unknown.
          // The attempt guard is NEVER cleared by a refusal: DENIED does not
          // prove that an earlier native write could not have committed.
          if(nativeWrite&&error?.outcome!=="DENIED")
            refused("T3_D6_NATIVE_OUTCOME_UNKNOWN");
          throw error;
        }finally{
          if(nativeWrite)nativeD6InFlight.delete(key);
        }
        // The original recipient port can be reconstructed on each HTTP
        // request and may still advertise AVAILABLE after its ACK was lost.
        // Retain the one signed Control session's attempted/in-flight state
        // in preview, so the UI cannot offer a second native dispatch.
        // Call original preview first: a new D1/recipient DENIED still wins.
        if(input.verb==="preview"&&observed?.status==="AVAILABLE"){
          if(nativeD6InFlight.has(key))
            observed={...observed,status:"OPERATION_IN_PROGRESS"};
          else if(nativeD6Attempted.has(key))
            observed={...observed,status:"RECOVER_ONLY"};
        }
        requireThat(before===await epochNow()&&authenticated(req),
          input.verb==="continueSelected"?"T3_D6_NATIVE_OUTCOME_UNKNOWN":
            "STALE_CONTEXT_OPERATION");
        requireThat(observed&&D6_STATUSES.has(observed.status)&&
          (observed.operationId===undefined||REF.test(observed.operationId))&&
          (observed.recipientId===undefined||REF.test(observed.recipientId))&&
          (observed.resultRef===undefined||REF.test(observed.resultRef))&&
          (observed.reason===undefined||typeof observed.reason==="string")&&
          (!observed.reference||(
            observed.reference.workspace_id===reference.workspace_id&&
            observed.reference.object_id===reference.object_id&&
            observed.reference.schema_id===reference.schema_id&&
            observed.reference.revision===reference.revision)),
          "T3_D6_ORIGINAL_NATIVE_RECEIPT_INVALID");
        // No Object bytes, owner secrets, Kernel session, or signed Access
        // proof can be returned by this transport.
        const result=Object.fromEntries(D6_FIELDS.filter(k=>
          Object.hasOwn(observed,k)).map(k=>[k,observed[k]]));
        reply(res,200,{result});
        return true;
      }
      if(route==="/api/t3/native-d7"){
        requireThat(D7_VERBS.has(input.verb)&&input.payload&&
          typeof input.payload==="object"&&!Array.isArray(input.payload),
          "T3_D7_NATIVE_REQUEST_INVALID");
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        const owner=nativeD7PortFor===null?null:await nativeD7PortFor({
          contextEpoch:before,
        });
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        const age=owner?.ageOwner,publisher=owner?.publisherHolder;
        const ageRecipientReady=D7_AGE.every(m=>typeof age?.[m]==="function");
        const agePlainOpen=ageRecipientReady&&typeof age?.open==="function";
        // An installed native owner may intentionally NEVER return decrypted
        // bytes. Its original Kernel preview/commit/cancel must work WITHOUT
        // requiring a raw age.open() backdoor into the WebView.
        const ageNativeImport=ageRecipientReady&&
          typeof age?.previewInOriginalKernel==="function"&&
          typeof age?.commitInOriginalKernel==="function"&&
          typeof age?.cancelInOriginalKernel==="function"&&
          typeof owner?.authorizeAgeImportCommit==="function";
        const ageNativeReadback=ageNativeImport&&
          typeof age?.readbackInOriginalKernel==="function";
        const ageOpen=agePlainOpen||ageNativeImport;
        const ageSeal=ageRecipientReady&&
          typeof age?.prepareSeal==="function"&&
          typeof age?.seal==="function"&&
          typeof owner?.authorizeAgeSeal==="function";
        const publisherReady=D7_PUBLISHER.every(m=>typeof publisher?.[m]==="function")&&
          typeof owner?.confirmPublisherApply==="function";
        const maxArchiveBytes=ageRecipientReady&&Number.isSafeInteger(age?.maxArchiveBytes)
          ?Math.min(age.maxArchiveBytes,D7_ARCHIVE):D7_ARCHIVE;
        if(input.verb==="available"){
          reply(res,200,{result:{ageOpen,ageSeal,
            ageNativeImport,ageNativeReadback,publisher:publisherReady,
            maxArchiveBytes:ageRecipientReady?maxArchiveBytes:null}});
          return true;
        }
        const payload=input.payload;
        let result;
        if(input.verb.startsWith("age.")){
          requireThat(ageRecipientReady,"T3_D7_NATIVE_AGE_UNAVAILABLE");
          const verb=input.verb.slice(4);
          if(verb==="currentRecipient"){
            result=await d7Recipient(age);
          }else if(verb==="prepareSeal"){
            requireThat(ageSeal,"T3_D7_NATIVE_SIGNED_EXPORT_REQUIRED");
            requireThat(REF.test(payload.workspaceId??"")&&
              HEX.test(payload.archiveSha256??"")&&
              Number.isSafeInteger(payload.archiveSize)&&
              payload.archiveSize>0&&payload.archiveSize<=maxArchiveBytes,
              "T3_D7_NATIVE_EXPORT_REQUEST_INVALID");
            result=d7Public(await age.prepareSeal({
              workspaceId:payload.workspaceId,archiveSha256:payload.archiveSha256,
              archiveSize:payload.archiveSize,
            }),["format","status","recipientIds"]);
          }else if(verb==="seal"){
            requireThat(ageSeal,"T3_D7_NATIVE_SIGNED_EXPORT_REQUIRED");
            const bytes=d7Bytes(payload.archiveBytesBase64url,maxArchiveBytes);
            requireThat(REF.test(payload.workspaceId??"")&&
              HEX.test(payload.archiveSha256??"")&&
              payload.archiveSha256===d7Digest(bytes)&&
              Array.isArray(payload.recipientIds)&&
              payload.recipientIds.length>=2&&payload.recipientIds.length<=16&&
              payload.recipientIds.every(x=>typeof x==="string"&&REF.test(x))&&
              new Set(payload.recipientIds).size===payload.recipientIds.length,
              "T3_D7_NATIVE_EXPORT_REQUEST_INVALID");
            // The ORIGINAL installed age owner, not the web request, is
            // authoritative for the chosen recipients at encryption time.
            // Re-plan before Human confirmation to reject a substituted or
            // stale recipient list, while preserving age's native 2-16 range.
            const currentPlan=await age.prepareSeal({
              workspaceId:payload.workspaceId,
              archiveSha256:payload.archiveSha256,
              archiveSize:bytes.length,
            });
            requireThat(currentPlan?.format==="age-encryption.org/v1"&&
              currentPlan.status==="READY"&&
              Array.isArray(currentPlan.recipientIds)&&
              currentPlan.recipientIds.length===payload.recipientIds.length&&
              currentPlan.recipientIds.every((recipient,index)=>
                recipient===payload.recipientIds[index]),
              "T3_D7_NATIVE_RECIPIENT_PLAN_CHANGED");
            requireThat(before===await epochNow()&&authenticated(req),
              "STALE_CONTEXT_OPERATION");
            // This is the ORIGINAL native Host's signed D1 JIT and Human
            // confirmation, not a web-provided allow flag.
            requireThat(await owner.authorizeAgeSeal({
              contextEpoch:before,workspaceId:payload.workspaceId,
              archiveSha256:payload.archiveSha256,archiveSize:bytes.length,
              recipientIds:[...payload.recipientIds],
            })===true,"T3_D7_NATIVE_SIGNED_EXPORT_DENIED");
            requireThat(before===await epochNow()&&authenticated(req),
              "STALE_CONTEXT_OPERATION");
            const sealed=await age.seal({
              archiveBytes:bytes,archiveSha256:payload.archiveSha256,
              recipientIds:[...payload.recipientIds],
              workspaceId:payload.workspaceId,
            });
            requireThat(Buffer.isBuffer(sealed?.ciphertext)||
              sealed?.ciphertext instanceof Uint8Array,
              "T3_D7_NATIVE_AGE_CIPHERTEXT_INVALID");
            requireThat(sealed.ciphertext.length>0&&
              sealed.ciphertext.length<=D7_CIPHER,
              "T3_D7_NATIVE_AGE_CIPHERTEXT_INVALID");
            result={...d7Public(sealed,["format","archiveSha256","recipientIds"]),
              ciphertextBase64url:Buffer.from(sealed.ciphertext).toString("base64url")};
          }else if(verb==="previewImport"){
            // The installed native owner decrypts and calls the SAME original
            // Kernel.importPreview used later by Exchange.importCommit.
            // Only the original preview handle crosses Control, NEVER the
            // decrypted ZIP or the private age identity.
            requireThat(ageNativeImport,"T3_D7_NATIVE_KERNEL_PREVIEW_UNAVAILABLE");
            const ciphertext=d7Bytes(payload.ciphertextBase64url,D7_CIPHER);
            const recipient=await d7Recipient(age);
            const opened=await age.previewInOriginalKernel({
              ciphertext,recipientId:recipient.recipientId,
            });
            const handle=opened?.handle;
            if(!d7Same(recipient,await d7Recipient(age))){
              // If the OS subject changes while ORIGINAL Kernel preview is
              // pending, discard that same original Kernel token. Failure
              // is not permission to reuse or apply the stale preview.
              if(REF.test(handle?.preview_token??""))
                try{await age.cancelInOriginalKernel({
                  preview_token:handle.preview_token,
                  recipientId:recipient.recipientId,
                });}catch{}
              refused("T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
            }
            requireThat(opened?.status==="KERNEL_PREVIEW_READY"&&
              opened.recipientId===recipient.recipientId&&
              HEX.test(opened.archiveSha256??"")&&
              handle&&typeof handle==="object"&&!Array.isArray(handle)&&
              REF.test(handle.preview_token??"")&&
              typeof handle.package_digest==="string"&&
              handle.package_digest.length>0&&
              typeof handle.semantic_digest==="string"&&
              handle.semantic_digest.length>0&&
              typeof handle.expires_at==="string"&&
              Number.isFinite(Date.parse(handle.expires_at))&&
              Array.isArray(handle.allowed_modes)&&
              handle.allowed_modes.length>0&&
              handle.preview&&typeof handle.preview==="object"&&
              !Array.isArray(handle.preview)&&
              Date.parse(handle.expires_at)>Date.now(),
              "T3_D7_ORIGINAL_KERNEL_PREVIEW_INVALID");
            // Only the ORIGINAL Kernel token returned after native decrypt is
            // eligible for Human importCommit or importCancel. Bind digest,
            // allowed modes and local recipient epoch before returning it.
            requireThat(before===await epochNow()&&authenticated(req),
              "STALE_CONTEXT_OPERATION");
            const previewKey=JSON.stringify([recipient.recipientId,
              recipient.bindingEpoch,handle.preview_token]);
            rememberAgePreview(previewKey,handle);
            result={status:"KERNEL_PREVIEW_READY",
              recipientId:recipient.recipientId,
              archiveSha256:opened.archiveSha256,
              handle:d7Public(handle,["preview_token","package_digest",
                "semantic_digest","expires_at","allowed_modes","preview"])};
          }else if(verb==="commitImport"){
            requireThat(ageNativeImport,"T3_D7_NATIVE_KERNEL_COMMIT_UNAVAILABLE");
            requireThat(REF.test(payload.preview_token??"")&&
              typeof payload.package_digest==="string"&&
              payload.package_digest.length>0&&
              payload.plan&&typeof payload.plan==="object"&&
              !Array.isArray(payload.plan)&&
              typeof payload.plan.mode==="string"&&
              ["full","selective","merge","new-workspace","cancel"]
                .includes(payload.plan.mode),
              "T3_D7_NATIVE_KERNEL_COMMIT_REQUEST_INVALID");
            const recipient=await d7Recipient(age);
            const key=JSON.stringify([recipient.recipientId,recipient.bindingEpoch,
              payload.preview_token]);
            // A reconstructed native owner must not authorize arbitrary
            // original Kernel tokens, altered digests or unoffered modes.
            const claim=agePreviewClaim(key);
            requireThat(claim&&claim.packageDigest===payload.package_digest&&
              claim.allowedModes.includes(payload.plan.mode),
              "T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
            requireThat(!nativeAgeImportInFlight.has(key)&&
              !nativeAgeImportDispatched.has(key),
              "T3_D7_NATIVE_OUTCOME_UNKNOWN");
            nativeAgeImportInFlight.add(key);
            try{
              const inputCommit={preview_token:payload.preview_token,
                package_digest:payload.package_digest,plan:payload.plan};
              requireThat(await owner.authorizeAgeImportCommit({
                contextEpoch:before,recipientId:recipient.recipientId,
                previewToken:payload.preview_token,
                packageDigest:payload.package_digest,plan:payload.plan,
              })===true,"T3_D7_NATIVE_KERNEL_COMMIT_DENIED");
              requireThat(d7Same(recipient,await d7Recipient(age))&&
                before===await epochNow()&&authenticated(req),
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              // Record the possibility of a write BEFORE invoking original
              // Kernel. Never release this claim on lost ACK or bad readback.
              nativeAgePreviewClaims.delete(key);
              nativeAgeImportDispatched.add(key);
              let nativeReceipt;
              try{
                nativeReceipt=await age.commitInOriginalKernel({
                  ...inputCommit,recipientId:recipient.recipientId,
                });
              }catch{refused("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
              requireThat(d7Same(recipient,await d7Recipient(age))&&
                before===await epochNow()&&authenticated(req),
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              requireThat(nativeReceipt?.format==="iwxa.import.receipt"&&
                typeof nativeReceipt.import_id==="string"&&
                nativeReceipt.package_digest===payload.package_digest&&
                nativeReceipt.semantic_digest===claim.semanticDigest&&
                nativeReceipt.mode===payload.plan.mode&&
                nativeReceipt.applied&&typeof nativeReceipt.applied==="object",
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              result=d7Public(nativeReceipt,[
                "import_id","format","format_version","package_digest",
                "semantic_digest","mode","conflict_policy","committed_at",
                "applied","skipped_conflicts","workspace_id_map",
                "excluded_by_permission","cancelled"]);
            }finally{
              nativeAgeImportInFlight.delete(key);
            }
          }else if(verb==="cancelImport"){
            requireThat(ageNativeImport,"T3_D7_NATIVE_KERNEL_CANCEL_UNAVAILABLE");
            requireThat(REF.test(payload.preview_token??""),
              "T3_D7_NATIVE_KERNEL_CANCEL_REQUEST_INVALID");
            const recipient=await d7Recipient(age);
            const key=JSON.stringify([recipient.recipientId,recipient.bindingEpoch,
              payload.preview_token]);
            // A caller may cancel only its own native age preview, never an
            // arbitrary token issued by an unrelated original Kernel caller.
            requireThat(agePreviewClaim(key),
              "T3_D7_NATIVE_PREVIEW_BINDING_INVALID");
            // Cancel while the original Kernel could be writing is not a
            // verified rollback and must not be reported as successful.
            requireThat(!nativeAgeImportInFlight.has(key)&&
              !nativeAgeImportDispatched.has(key),
              "T3_D7_NATIVE_OUTCOME_UNKNOWN");
            nativeAgeImportInFlight.add(key);
            try{
              // A cancellation can consume the ORIGINAL preview before its
              // acknowledgement reaches Control. Claim its dispatch under
              // the SAME token lock as importCommit, so a racing commit can
              // never write after an uncertain cancellation.
              nativeAgePreviewClaims.delete(key);
              nativeAgeImportDispatched.add(key);
              let cancelled;
              try{
                cancelled=await age.cancelInOriginalKernel({
                  preview_token:payload.preview_token,
                  recipientId:recipient.recipientId,
                });
              }catch{refused("T3_D7_NATIVE_OUTCOME_UNKNOWN");}
              requireThat(d7Same(recipient,await d7Recipient(age))&&
                before===await epochNow()&&authenticated(req),
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              result={cancelled:cancelled===true};
            }finally{
              nativeAgeImportInFlight.delete(key);
            }
          }else if(verb==="readbackImport"){
            // Read-only recovery is independent of Control's volatile
            // preview claims: the ORIGINAL recipient must read its persisted
            // receipt AND actual Kernel Store, including after cold restart.
            requireThat(ageNativeReadback,"T3_D7_NATIVE_KERNEL_READBACK_UNAVAILABLE");
            requireThat(REF.test(payload.preview_token??"")&&
              REF.test(payload.package_digest??"")&&
              REF.test(payload.semantic_digest??"")&&
              ["full","selective","merge","new-workspace","cancel"]
                .includes(payload.mode),
              "T3_D7_NATIVE_READBACK_REQUEST_INVALID");
            const recipient=await d7Recipient(age);
            const observed=await age.readbackInOriginalKernel({
              recipientId:recipient.recipientId,
              preview_token:payload.preview_token,
              package_digest:payload.package_digest,
              semantic_digest:payload.semantic_digest,mode:payload.mode,
            });
            requireThat(d7Same(recipient,await d7Recipient(age))&&
              before===await epochNow()&&authenticated(req),
              "T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
            if(observed===null||observed===undefined||
              observed.status==="OUTCOME_UNKNOWN"){
              result={status:"OUTCOME_UNKNOWN"};
            }else{
              const receipt=observed.receipt;
              requireThat(observed.status==="OWNER_READBACK_CONFIRMED"&&
                observed.readbackVerified===true&&
                observed.preview_token===payload.preview_token&&
                observed.recipientId===recipient.recipientId&&
                receipt?.format==="iwxa.import.receipt"&&
                REF.test(receipt.import_id??"")&&
                receipt.package_digest===payload.package_digest&&
                receipt.semantic_digest===payload.semantic_digest&&
                receipt.mode===payload.mode&&receipt.cancelled!==true&&
                receipt.applied&&typeof receipt.applied==="object"&&
                !Array.isArray(receipt.applied),
                "T3_D7_NATIVE_KERNEL_READBACK_INVALID");
              result={status:"OWNER_READBACK_CONFIRMED",
                recipientId:recipient.recipientId,
                receipt:d7Public(receipt,D7_IMPORT_RECEIPT_FIELDS)};
            }
          }else if(verb==="open"){
            // No automatic fallback from opaque native Kernel import into
            // browser-readable plaintext when the installed owner omits open.
            requireThat(agePlainOpen,"T3_D7_NATIVE_PLAINTEXT_PRIVATE");
            const ciphertext=d7Bytes(payload.ciphertextBase64url,D7_CIPHER);
            const recipient=await d7Recipient(age);
            requireThat(recipient.recipientId===payload.recipientId,
              "T3_D7_NATIVE_RECIPIENT_INVALID");
            const opened=await age.open({ciphertext,recipientId:payload.recipientId});
            // A native OS user/key change need not rotate the browser Control
            // context epoch. Never return plaintext decrypted by a different
            // local holder, even to the same authenticated browser session.
            requireThat(d7Same(recipient,await d7Recipient(age)),
              "T3_D7_ORIGINAL_NATIVE_RECIPIENT_CHANGED");
            requireThat(Buffer.isBuffer(opened?.archiveBytes)||
              opened?.archiveBytes instanceof Uint8Array,
              "T3_D7_NATIVE_AGE_PLAINTEXT_INVALID");
            requireThat(opened.archiveBytes.length>0&&
              opened.archiveBytes.length<=maxArchiveBytes,
              "T3_D7_NATIVE_AGE_PLAINTEXT_INVALID");
            result={...d7Public(opened,["format","status","verified",
              "recipientId","archiveSha256"]),
              archiveBytesBase64url:Buffer.from(opened.archiveBytes).toString("base64url")};
          }
        }else{
          requireThat(publisherReady,"T3_D7_NATIVE_PUBLISHER_UNAVAILABLE");
          const verb=input.verb.slice(10);
          if(verb==="currentSubject"){
            result=await d7Subject(publisher);
          }else if(verb==="inspect"||verb==="apply"){
            const bytes=d7Bytes(payload.archiveBytesBase64url,D7_LICENSE);
            requireThat(["LICENSE","STATUS"].includes(payload.kind)&&
              HEX.test(payload.packageSha256??"")&&
              payload.packageSha256===d7Digest(bytes),
              "T3_D7_NATIVE_PUBLISHER_PACKAGE_INVALID");
            const nativeSubject=await d7Subject(publisher);
            requireThat(nativeSubject.holderId===payload.subject?.holderId&&
              nativeSubject.recipientId===payload.subject?.recipientId&&
              nativeSubject.bindingEpoch===payload.subject?.bindingEpoch,
              "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
            if(verb==="inspect"){
              result=d7Public(await publisher.inspect({
                kind:payload.kind,archiveBytes:bytes,
                packageSha256:payload.packageSha256,
                context:null,subject:nativeSubject,
              }),D7_INSPECT_FIELDS);
            }else{
              requireThat(REF.test(payload.operationId??"")&&
                HEX.test(payload.previewDigest??""),
                "T3_D7_NATIVE_PUBLISHER_REQUEST_INVALID");
              const key=JSON.stringify([payload.kind,payload.packageSha256,
                payload.operationId,nativeSubject.holderId,
                nativeSubject.recipientId]);
              // Two independent signed requests can bypass the React
              // inFlight guard. Claim on the EXISTING Control handler before
              // any native await or Human confirmation.
              requireThat(!nativePublisherInFlight.has(key),
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              nativePublisherInFlight.add(key);
              try{
                const fields=["kind","packageSha256","operationId",
                  "holderId","recipientId"];
                const query={kind:payload.kind,operationId:payload.operationId,
                  packageSha256:payload.packageSha256,
                  holderId:nativeSubject.holderId,
                  recipientId:nativeSubject.recipientId};
                const inspection=await publisher.inspect({
                  kind:payload.kind,archiveBytes:bytes,
                  packageSha256:payload.packageSha256,
                  context:null,subject:nativeSubject,
                });
                requireThat(inspection&&
                  fields.every(field=>inspection[field]===query[field])&&
                  inspection.previewDigest===payload.previewDigest&&
                  inspection.publisherSignatureVerified===true&&
                  inspection.pinnedPublisherTrusted===true&&
                  ["READY","RECOVER_ONLY"].includes(inspection.stage),
                  "T3_D7_NATIVE_PUBLISHER_PREVIEW_CHANGED");
                requireThat(d7Same(nativeSubject,await d7Subject(publisher))&&
                  before===await epochNow()&&authenticated(req),
                  "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
                // A persisted receipt is authoritative after a cold restart,
                // including when the original inspect still says READY.
                // Never use a transport ACK as proof of installed status.
                const previous=await publisher.receipt(query);
                if(previous!==null&&previous!==undefined){
                  const current=await publisher.statusReadback(query);
                  requireThat(fields.every(field=>
                    previous[field]===query[field]&&current?.[field]===query[field])&&
                    previous.state==="COMMITTED"&&current.persisted===true&&
                    current.issuerAuthorityId===inspection.issuerAuthorityId&&
                    (payload.kind!=="LICENSE"||
                      current.licenseId===inspection.licenseId)&&
                    (payload.kind!=="STATUS"||(
                      previous.sequence===inspection.sequence&&
                      current.sequence===inspection.sequence&&
                      previous.statusPayloadDigest===inspection.statusPayloadDigest&&
                      current.statusPayloadDigest===inspection.statusPayloadDigest&&
                      Number.isSafeInteger(current.statusSequenceFloor)&&
                      current.statusSequenceFloor>=inspection.sequence)),
                    "T3_D7_NATIVE_OUTCOME_UNKNOWN");
                  requireThat(d7Same(nativeSubject,await d7Subject(publisher)),
                    "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
                  result={acknowledged:true,recovered:true};
                }else{
                  // If any native Apply was attempted in THIS Host lifetime,
                  // absence of receipt is UNKNOWN, never permission to replay.
                  requireThat(!nativePublisherDispatched.has(key)&&
                    inspection.stage==="READY",
                    "T3_D7_NATIVE_OUTCOME_UNKNOWN");
                  requireThat(await owner.confirmPublisherApply({
                    contextEpoch:before,kind:payload.kind,
                    operationId:payload.operationId,
                    packageSha256:payload.packageSha256,
                    previewDigest:payload.previewDigest,
                    holderId:nativeSubject.holderId,
                  })===true,"T3_D7_NATIVE_HUMAN_CONFIRMATION_REQUIRED");
                  requireThat(d7Same(nativeSubject,await d7Subject(publisher))&&
                    before===await epochNow()&&authenticated(req),
                    "T3_D7_NATIVE_OUTCOME_UNKNOWN");
                  // The original recipient owns the durable receipt. This
                  // volatile guard is only to stop a same-session redispatch.
                  nativePublisherDispatched.add(key);
                  await publisher.apply({
                    kind:payload.kind,archiveBytes:bytes,
                    operationId:payload.operationId,
                    packageSha256:payload.packageSha256,
                    previewDigest:payload.previewDigest,
                    subject:nativeSubject,context:null,
                  });
                  result={acknowledged:true,recovered:false};
                }
              }finally{
                nativePublisherInFlight.delete(key);
              }
            }
            requireThat(d7Same(nativeSubject,await d7Subject(publisher)),
              verb==="apply"?"T3_D7_NATIVE_OUTCOME_UNKNOWN":
                "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
          }else{
            const query=d7Public(payload,["kind","operationId",
              "packageSha256","holderId","recipientId"]);
            requireThat(["LICENSE","STATUS"].includes(query.kind)&&
              REF.test(query.operationId??"")&&
              HEX.test(query.packageSha256??"")&&
              REF.test(query.holderId??"")&&REF.test(query.recipientId??""),
              "T3_D7_NATIVE_PUBLISHER_RECEIPT_REQUEST_INVALID");
            const nativeSubject=await d7Subject(publisher);
            requireThat(query.holderId===nativeSubject.holderId&&
              query.recipientId===nativeSubject.recipientId,
              "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
            const observed=await publisher[verb](query);
            requireThat(d7Same(nativeSubject,await d7Subject(publisher)),
              "T3_D7_ORIGINAL_NATIVE_HOLDER_CHANGED");
            result=observed===null||observed===undefined?null:
              d7Public(observed,D7_RECEIPT_FIELDS);
          }
        }
        requireThat(before===await epochNow()&&authenticated(req),
          ["publisher.apply","age.commitImport","age.cancelImport"].includes(input.verb)
            ?"T3_D7_NATIVE_OUTCOME_UNKNOWN":"STALE_CONTEXT_OPERATION");
        reply(res,200,{result});
        return true;
      }
      if(route==="/api/t3/reconciliation"){
        requireThat(D3_VERBS.has(input.verb)&&
          input.payload&&typeof input.payload==="object"&&
          !Array.isArray(input.payload),
          "T3_D3_RECIPIENT_REQUEST_INVALID");
        // A large incoming .iwxa can be streamed over several awaits.
        // Old bearer/epoch must be checked BEFORE resolving a new recipient.
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        // The genuine native/product owner decides which original Reconciler
        // belongs to the selected subject and owns all independent reviews.
        const port=reconciliationPortFor===null?null:await reconciliationPortFor({
          contextEpoch:before,
        });
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        const available=port!==null&&port!==undefined&&
          D3_METHODS.every(method=>typeof port[method]==="function");
        if(input.verb==="available"){
          requireThat(before===await epochNow()&&authenticated(req),
            "STALE_CONTEXT_OPERATION");
          reply(res,200,{result:{available,applyAvailable:available&&
            typeof port.applyAccepted==="function",
            recoverAvailable:available&&typeof port.recoverApplied==="function"}});
          return true;
        }
        requireThat(available,"T3_D3_ORIGINAL_RECIPIENT_UNAVAILABLE");
        const payload=input.payload;
        const d3Key=d3WriteKey(input.verb,payload);
        if(d3Key!==null){
          requireThat(!nativeD3InFlight.has(d3Key)&&
            !nativeD3Attempted.has(d3Key),
            "T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN");
          // Claim before the first asynchronous Human/owner/Kernel call.
          nativeD3InFlight.add(d3Key);
          nativeD3Attempted.add(d3Key);
        }
        let result;
        try{
        if(input.verb==="receive"){
          const encoded=payload.archiveBase64url;
          requireThat(typeof encoded==="string"&&
            encoded.length>0&&encoded.length<=Math.ceil(MAX_D3_ARCHIVE/3)*4&&
            /^[A-Za-z0-9_-]+$/.test(encoded),
            "T3_D3_ORIGINAL_IWXA_BYTES_REQUIRED");
          const bytes=Buffer.from(encoded,"base64url");
          requireThat(bytes.length>0&&bytes.length<=MAX_D3_ARCHIVE&&
            bytes.toString("base64url")===encoded,
            "T3_D3_ORIGINAL_IWXA_BYTES_REQUIRED");
          result=await port.receive(bytes);
        }else if(input.verb==="preview"){
          result=await port.preview(payload.packageSha256);
        }else if(input.verb==="receipt"){
          result=await port.receipt(payload.operationId,payload.packageSha256);
        }else if(input.verb==="accept"||input.verb==="reject"){
          result=await port[input.verb](payload);
        }else if(input.verb==="inspectAcceptedApplication"){
          result=await port.inspectAcceptedApplication(payload);
        }else if(input.verb==="recoverApplied"){
          requireThat(typeof port.recoverApplied==="function",
            "T3_D3_ORIGINAL_APPLY_RECOVERY_UNAVAILABLE");
          result=await port.recoverApplied(payload);
        }else{
          requireThat(typeof port.applyAccepted==="function",
            "T3_D3_ORIGINAL_APPLY_OWNER_REQUIRED");
          result=await port.applyAccepted(payload);
        }
        }catch(error){
          // Only documented failures BEFORE original ledger/Kernel dispatch
          // can release the same-session attempt. Any lost confirmation,
          // owner fault or signed-context change is recovery-only.
          if(d3Key!==null&&
            d3DefinitelyNotDispatched(input.verb,error?.code))
            nativeD3Attempted.delete(d3Key);
          throw error;
        }finally{
          if(d3Key!==null)nativeD3InFlight.delete(d3Key);
        }
        // A stale response after a native write is UNKNOWN, never proof of
        // non-application or an invitation to replay the original command.
        requireThat(before===await epochNow()&&authenticated(req),
          ["receive","accept","reject","applyAccepted"].includes(input.verb)
            ?"T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN"
            :"STALE_CONTEXT_OPERATION");
        reply(res,200,{result});
        return true;
      }
      requireThat(SCOPES.has(input.scope)&&
        typeof input.operation==="string"&&REF.test(input.operation)&&
        ["select","context","action","digest","authorize"].includes(input.verb),
        "T3_D1_CONTROL_REQUEST_INVALID");
      const owner=await ownerFor({scope:input.scope,operation:input.operation});
      if(input.verb==="select"){
        if(owner!==null&&owner!==undefined)
          requireThat(OWNER_FIELDS.every(f=>typeof owner[f]==="function"),
            "T3_D1_CONTROL_OWNER_INVALID");
        requireThat(before===await epochNow()&&authenticated(req),
          "STALE_CONTEXT_OPERATION");
        reply(res,200,{available:!!owner,contextEpoch:before});
        return true;
      }
      requireThat(owner&&OWNER_FIELDS.every(f=>typeof owner[f]==="function"),
        "T3_D1_ACCESS_OWNER_REQUIRED");
      const selected=await owner.currentContext();
      const selectedIdentity=identity(selected);
      let result;
      if(input.verb==="context") {
        result={context:selected};
      }else if(input.verb==="action"){
        requireThat(typeof input.kernelOperation==="string"&&
          REF.test(input.kernelOperation),
          "T3_D1_CONTROL_OPERATION_INVALID");
        const action=await owner.actionFor(input.kernelOperation);
        requireThat(typeof action==="string"&&REF.test(action),
          "T3_D1_CONTROL_ACTION_INVALID");
        result={action};
      }else if(input.verb==="digest"){
        requireThat(typeof input.kernelOperation==="string"&&
          REF.test(input.kernelOperation)&&
          identity(input.context)===selectedIdentity,
          "T3_D1_CONTROL_DIGEST_CONTEXT_INVALID");
        const digest=await owner.operationDigest({
          operation:input.kernelOperation,input:input.command,
          context:input.context,
        });
        requireThat(typeof digest==="string"&&HEX.test(digest),
          "T3_D1_CONTROL_DIGEST_INVALID");
        result={digest};
      }else{
        const decision=await owner.authorize(input.request);
        // The existing ORIGINAL signed owner verifies its WeakMap identity
        // before the decision crosses the HTTP serialization boundary.
        requireThat(await owner.verifyDecisionBinding(input.request,decision)===true,
          "T3_D1_CONTROL_ORIGINAL_BINDING_DENIED");
        result={decision};
      }
      requireThat(before===await epochNow()&&authenticated(req)&&
        identity(await owner.currentContext())===selectedIdentity&&
        authenticated(req),
        "STALE_CONTEXT_OPERATION");
      reply(res,200,result);
      return true;
    }catch(error){
      // Only the authenticated original native D6 endpoint may attest a
      // definite owner refusal. A guessed error code, timeout or post-write
      // lost ACK does not carry the DENIED outcome across HTTP.
      const code=errorCode(error);
      const originalD6Denial=route==="/api/t3/native-d6"&&
        error?.outcome==="DENIED"&&code!=="T3_D6_NATIVE_OUTCOME_UNKNOWN";
      if(!res.headersSent)reply(res,[
        "T3_D1_CONTROL_BODY_TOO_LARGE","T3_D3_CARRIER_TOO_LARGE",
        "T3_D7_NATIVE_CARRIER_TOO_LARGE",
      ].includes(error?.code)?413:403,
        originalD6Denial?{error:code,outcome:"DENIED"}:{error:code});
      return true;
    }
  };
}
