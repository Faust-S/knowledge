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
const MAX_D3_BODY=24*1024*1024;
const MAX_D3_ARCHIVE=16*1024*1024;
const D3_VERBS=new Set(["available","receive","preview","receipt","accept","reject",
  "inspectAcceptedApplication","applyAccepted","recoverApplied"]);
const D3_METHODS=["receive","preview","receipt","accept","reject","inspectAcceptedApplication"];
// The SAME local Control/SSE/epoch serves optional original D7 product owners.
// No private age identity, Publisher signer, licence state or credentials cross
// this route. These historical native owners support 32 MiB / 4 MiB respectively.
const D7_ARCHIVE=32*1024*1024,D7_CIPHER=33*1024*1024,D7_LICENSE=4*1024*1024;
const MAX_D7_BODY=Math.ceil(D7_CIPHER*4/3)+16*1024;
const D7_VERBS=new Set(["available","age.currentRecipient","age.prepareSeal",
  "age.seal","age.open","publisher.currentSubject","publisher.inspect",
  "publisher.apply","publisher.receipt","publisher.statusReadback"]);
const D7_AGE=["currentRecipient","open"];
const D7_PUBLISHER=["currentSubject","inspect","apply","receipt","statusReadback"];
const D7_INSPECT_FIELDS=["kind","packageSha256","previewDigest","holderId",
  "recipientId","publisherId","issuerAuthorityId","operationId","licenseId",
  "sequence","statusSchema","statusPayloadDigest","scope","entries",
  "publisherSignatureVerified","pinnedPublisherTrusted","stage"];
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
  try{result=strictJson(Buffer.concat(parts).toString("utf8"));}
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
  reconciliationPortFor=null,nativeD7PortFor=null,
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
  requireThat(assetForPath===null||typeof assetForPath==="function",
    "T3_D1_CONTROL_TRUSTED_ASSET_RESOLVER_REQUIRED");
  // The installed native Host supplies an ORIGINAL recipient-owned D3 port.
  // Nothing in this HTTP handler constructs a Reconciler or a second Ledger.
  requireThat(reconciliationPortFor===null||typeof reconciliationPortFor==="function",
    "T3_D3_ORIGINAL_RECIPIENT_PROVIDER_INVALID");
  // The installed product injects its already-existing original native
  // owners. No public key custody, issuer, decision engine or OS API is built
  // here. A native age seal must independently obtain original signed D1
  // read + native Human confirmation via authorizeAgeSeal.
  requireThat(nativeD7PortFor===null||typeof nativeD7PortFor==="function",
    "T3_D7_ORIGINAL_NATIVE_OWNER_PROVIDER_INVALID");
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
              "connect-src 'self'; base-uri 'none'; frame-ancestors "+uiOrigin,
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
        route==="/api/t3/native-d7","T3_D1_CONTROL_ROUTE_DENIED");
      requireThat(req.method==="POST"&&req.headers.origin===origin&&
        /^application\/json\b/i.test(req.headers["content-type"]??""),
        "T3_D1_CONTROL_POST_ORIGIN_DENIED");
      const requestEpoch=req.headers["x-iwxa-context-epoch"];
      const before=await epochNow();
      requireThat(authenticated(req),"T3_D1_CONTROL_SESSION_ROTATED");
      requireThat(typeof requestEpoch==="string"&&
        requestEpoch===String(before),"STALE_CONTEXT_OPERATION");
      const input=await bodyFrom(req,route==="/api/t3/reconciliation"
        ?MAX_D3_BODY:route==="/api/t3/native-d7"?MAX_D7_BODY:MAX_BODY);
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
        const ageOpen=D7_AGE.every(m=>typeof age?.[m]==="function");
        const ageSeal=ageOpen&&typeof age?.prepareSeal==="function"&&
          typeof age?.seal==="function"&&
          typeof owner?.authorizeAgeSeal==="function";
        const publisherReady=D7_PUBLISHER.every(m=>typeof publisher?.[m]==="function")&&
          typeof owner?.confirmPublisherApply==="function";
        const maxArchiveBytes=ageOpen&&Number.isSafeInteger(age?.maxArchiveBytes)
          ?Math.min(age.maxArchiveBytes,D7_ARCHIVE):D7_ARCHIVE;
        if(input.verb==="available"){
          reply(res,200,{result:{ageOpen,ageSeal,publisher:publisherReady,
            maxArchiveBytes:ageOpen?maxArchiveBytes:null}});
          return true;
        }
        const payload=input.payload;
        let result;
        if(input.verb.startsWith("age.")){
          requireThat(ageOpen,"T3_D7_NATIVE_AGE_UNAVAILABLE");
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
              Array.isArray(payload.recipientIds)&&payload.recipientIds.length===2&&
              payload.recipientIds.every(x=>typeof x==="string"&&REF.test(x))&&
              payload.recipientIds[0]!==payload.recipientIds[1],
              "T3_D7_NATIVE_EXPORT_REQUEST_INVALID");
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
          }else if(verb==="open"){
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
              requireThat(await owner.confirmPublisherApply({
                contextEpoch:before,kind:payload.kind,
                operationId:payload.operationId,
                packageSha256:payload.packageSha256,
                previewDigest:payload.previewDigest,
                holderId:nativeSubject.holderId,
              })===true,"T3_D7_NATIVE_HUMAN_CONFIRMATION_REQUIRED");
              requireThat(before===await epochNow()&&authenticated(req),
                "T3_D7_NATIVE_OUTCOME_UNKNOWN");
              await publisher.apply({
                kind:payload.kind,archiveBytes:bytes,
                operationId:payload.operationId,
                packageSha256:payload.packageSha256,
                previewDigest:payload.previewDigest,
                subject:nativeSubject,context:null,
              });
              // Result is NEVER proof of persistence: original receipt
              // and durable statusReadback are mandatory on the next call.
              result={acknowledged:true};
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
          input.verb==="publisher.apply"?"T3_D7_NATIVE_OUTCOME_UNKNOWN":
            "STALE_CONTEXT_OPERATION");
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
        let result;
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
      if(!res.headersSent)reply(res,[
        "T3_D1_CONTROL_BODY_TOO_LARGE","T3_D3_CARRIER_TOO_LARGE",
        "T3_D7_NATIVE_CARRIER_TOO_LARGE",
      ].includes(error?.code)?413:403,
        {error:errorCode(error)});
      return true;
    }
  };
}
