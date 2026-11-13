// Trusted Kernel/Host HTTP ROUTE for the existing T3 Control loopback protocol.
// Attach to the same installed original Host server; this is not a new server,
// IAM, signer, Store, license authority, or alternate Kernel transport.
// The Host supplies the existing signed owner, monotonic context epoch and
// genuine invalidation subscription. The UI sees only scoped decisions.
import {timingSafeEqual} from "node:crypto";
import {strictJson} from "./access/strict-json.mjs";
import {canonical} from "./access/core.mjs";

const LOCAL=/^https?:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const TOKEN=/^[A-Za-z0-9_-]{40,128}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
const MAX_BODY=512*1024;
const SCOPES=new Set(["kernel","activity"]);
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
async function bodyFrom(req){
  const parts=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    requireThat(total<=MAX_BODY,"T3_D1_CONTROL_BODY_TOO_LARGE");
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
  origin,token,ownerFor,currentEpoch,subscribeInvalidation,
}={}){
  requireThat(typeof origin==="string"&&LOCAL.test(origin)&&
    new URL(origin).origin===origin,"T3_D1_CONTROL_ORIGIN_REQUIRED");
  requireThat(typeof token==="string"&&TOKEN.test(token)&&
    typeof ownerFor==="function"&&typeof currentEpoch==="function"&&
    typeof subscribeInvalidation==="function",
    "T3_D1_CONTROL_TRUSTED_HOST_REQUIRED");
  const credential=Buffer.from("Bearer "+token);
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
    return submitted.length===credential.length&&
      timingSafeEqual(submitted,credential);
  };
  return async function handleOriginalControl(req,res){
    let route;
    try{route=new URL(req.url,origin).pathname;}
    catch{route="/api/t3/invalid";}
    if(!route.startsWith("/api/t3/"))return false;
    try{
      requireThat(req.headers.host===expectedHost,
        "T3_D1_CONTROL_ORIGIN_DENIED");
      if(!authenticated(req)){
        reply(res,401,{error:"T3_D1_CONTROL_SESSION_UNAVAILABLE"});
        return true;
      }
      if(route==="/api/t3/context-epoch"){
        requireThat(req.method==="GET","T3_D1_CONTROL_METHOD_DENIED");
        reply(res,200,{contextEpoch:await epochNow()});
        return true;
      }
      if(route==="/api/t3/owner-events"){
        requireThat(req.method==="GET"&&
          req.headers.accept?.includes("text/event-stream"),
          "T3_D1_CONTROL_STREAM_REQUIRED");
        const epoch=await epochNow();
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
        if(await epochNow()!==epoch)
          res.write("event: invalidated\ndata: {}\n\n");
        else res.write("event: ready\ndata: {}\n\n");
        return true;
      }
      requireThat(route==="/api/t3/owner",
        "T3_D1_CONTROL_ROUTE_DENIED");
      requireThat(req.method==="POST"&&req.headers.origin===origin&&
        /^application\/json\b/i.test(req.headers["content-type"]??""),
        "T3_D1_CONTROL_POST_ORIGIN_DENIED");
      const requestEpoch=req.headers["x-iwxa-context-epoch"];
      const before=await epochNow();
      requireThat(typeof requestEpoch==="string"&&
        requestEpoch===String(before),"STALE_CONTEXT_OPERATION");
      const input=await bodyFrom(req);
      requireThat(SCOPES.has(input.scope)&&
        typeof input.operation==="string"&&REF.test(input.operation)&&
        ["select","context","action","digest","authorize"].includes(input.verb),
        "T3_D1_CONTROL_REQUEST_INVALID");
      const owner=await ownerFor({scope:input.scope,operation:input.operation});
      if(input.verb==="select"){
        if(owner!==null&&owner!==undefined)
          requireThat(OWNER_FIELDS.every(f=>typeof owner[f]==="function"),
            "T3_D1_CONTROL_OWNER_INVALID");
        requireThat(before===await epochNow(),"STALE_CONTEXT_OPERATION");
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
      requireThat(before===await epochNow()&&
        identity(await owner.currentContext())===selectedIdentity,
        "STALE_CONTEXT_OPERATION");
      reply(res,200,result);
      return true;
    }catch(error){
      if(!res.headersSent)reply(res,error?.code==="T3_D1_CONTROL_BODY_TOO_LARGE"?413:403,
        {error:errorCode(error)});
      return true;
    }
  };
}
