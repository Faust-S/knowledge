// The existing authenticated original Kernel relay uses JSON. Only actual
// Asset bytes require a representation change, not a new network protocol.
export const ORIGINAL_NETWORK_RELAY_METHODS=Object.freeze({
  getWorkspace:"t1.getWorkspace",getObject:"t1.getObject",listObjects:"t1.listObjects",listObjectWindow:"t1.listObjectWindow",
  listEventsSince:"t1.listEventsSince",listEventCommitWindow:"t1.listEventCommitWindow",
  listEventObjectCommitWindow:"t1.listEventObjectCommitWindow",putObject:"t1.putObject",
  commitObjectGraph:"t1.commitObjectGraph",deleteObject:"t1.deleteObject",
  listAssets:"t1.listAssets",getAsset:"t1.getAsset",putAsset:"t1.putAsset",
  deleteAsset:"t1.deleteAsset",putRelation:"t1.putRelation",deleteRelation:"t1.deleteRelation",
});
// Internal use of the existing trusted T2 Exchange connection. These
// methods are not negotiated as T4 network methods or exposed to the UI.
export const ORIGINAL_REGISTRY_EXCHANGE_METHODS=Object.freeze({
  exportPackage:"t2.exportPackage",importPreview:"t2.importPreview",
  importCommit:"t2.importCommit",importCancel:"t2.importCancel",
});
export const originalRegistryExchangeOperations=role=>Object.freeze(role==="SOURCE"?
  [ORIGINAL_REGISTRY_EXCHANGE_METHODS.importPreview,ORIGINAL_REGISTRY_EXCHANGE_METHODS.importCommit,
    ORIGINAL_REGISTRY_EXCHANGE_METHODS.importCancel]:role==="RECIPIENT"?
  [ORIGINAL_REGISTRY_EXCHANGE_METHODS.exportPackage]:[]);
const MAX=16*1024*1024;
const fail=()=>{throw Object.assign(Error("T3_ORIGINAL_KERNEL_ASSET_BYTES_INVALID"),
  {code:"T3_ORIGINAL_KERNEL_ASSET_BYTES_INVALID"});};
const record=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function encode(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX)fail();
  const parts=[];
  for(let i=0;i<bytes.length;i+=8192)
    parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
  return btoa(parts.join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function decode(text){
  if(typeof text!=="string"||text.length>Math.ceil(MAX/3)*4||
    !/^[A-Za-z0-9_-]*$/.test(text))fail();
  let binary;
  try{binary=atob(text.replace(/-/g,"+").replace(/_/g,"/"));}catch{fail();}
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(bytes.byteLength>MAX||encode(bytes)!==text)fail();
  return bytes;
}
function encodeRecord(value){
  if(!record(value)||Object.hasOwn(value,"bytesBase64url"))fail();
  const {bytes,...rest}=value;
  return {...rest,bytesBase64url:encode(bytes)};
}
function decodeRecord(value){
  if(!record(value)||Object.hasOwn(value,"bytes")||!Object.hasOwn(value,"bytesBase64url"))fail();
  const {bytesBase64url,...rest}=value;
  return {...rest,bytes:decode(bytesBase64url)};
}
export function encodeOriginalNetworkRelayArgs(method,args){
  if(method==="importPreview"){
    if(!Array.isArray(args)||args.length!==1)fail();
    return [encode(args[0])];
  }
  if(method!=="putAsset")return args;
  if(!Array.isArray(args)||args.length!==1)fail();
  return [encodeRecord(args[0])];
}
export function decodeOriginalNetworkRelayArgs(method,args){
  if(method==="importPreview"){
    if(!Array.isArray(args)||args.length!==1)fail();
    return [decode(args[0])];
  }
  if(method!=="putAsset")return args;
  if(!Array.isArray(args)||args.length!==1)fail();
  return [decodeRecord(args[0])];
}
export function encodeOriginalNetworkRelayResult(method,value){
  return (method==="getAsset"&&value!==null)||method==="exportPackage"?encodeRecord(value):value;
}
export function decodeOriginalNetworkRelayResult(method,value){
  return (method==="getAsset"&&value!==null)||method==="exportPackage"?decodeRecord(value):value;
}

// Internal Host negotiation, not T4 wire data. The trusted realm may
// execute the inherited D3 methods while the original Registry is checked,
// but no network/source-capture method is admitted until the final reply.
export function readOriginalNativeRelayNegotiation({reply,grantedOperations,session=null}={}){
  const invalid=()=>{throw Object.assign(Error("T3_ORIGINAL_NETWORK_RELAY_NEGOTIATION_INVALID"),
    {code:"T3_ORIGINAL_NETWORK_RELAY_NEGOTIATION_INVALID"});};
  const body=session===null?reply:reply?.activation;
  if(!record(body)||!Array.isArray(grantedOperations)||
    typeof body.sessionId!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(body.sessionId)||
    !Number.isSafeInteger(body.contextEpoch)||body.contextEpoch<0)invalid();
  if(session!==null&&(reply?.kind!=="NETWORK_ACTIVATION"||body.networkActivationVersion!==1||
    body.sessionId!==session.sessionId||body.contextEpoch!==session.contextEpoch||
    !["READY","DENIED"].includes(body.state)||Object.hasOwn(body,"networkActivationPending")))invalid();
  if(session===null&&(Object.hasOwn(body,"networkActivationVersion")||Object.hasOwn(body,"state")))invalid();
  const sourceFields=["localSourceMutationVersion","localSourceGraphVersion","localSourceWorkspaceId","localSourceMutationMethods"];
  const hasSource=sourceFields.some(key=>Object.hasOwn(body,key));
  const hasNetwork=Object.hasOwn(body,"networkRelayVersion")||Object.hasOwn(body,"networkMethods");
  if(Object.hasOwn(body,"networkActivationPending")){
    if(body.networkActivationPending!==1||hasNetwork||hasSource)invalid();
    return Object.freeze({state:"PENDING",networkMethods:Object.freeze([])});
  }
  if(session!==null&&body.state==="DENIED"){
    if(hasNetwork||hasSource)invalid();
    return Object.freeze({state:"DENIED",networkMethods:Object.freeze([])});
  }
  if(!hasNetwork){
    if(hasSource||session!==null)invalid();
    return Object.freeze({state:"LEGACY",networkMethods:Object.freeze([])});
  }
  if(body.networkRelayVersion!==1||!Array.isArray(body.networkMethods)||!body.networkMethods.length||
    new Set(body.networkMethods).size!==body.networkMethods.length||
    !body.networkMethods.every(name=>typeof name==="string"&&Object.hasOwn(ORIGINAL_NETWORK_RELAY_METHODS,name)&&
      grantedOperations.includes(ORIGINAL_NETWORK_RELAY_METHODS[name])))invalid();
  return Object.freeze({state:"READY",networkMethods:Object.freeze([...body.networkMethods])});
}
