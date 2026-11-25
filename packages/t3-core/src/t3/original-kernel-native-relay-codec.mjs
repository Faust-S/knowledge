// The existing authenticated original Kernel relay uses JSON. Only actual
// Asset bytes require a representation change, not a new network protocol.
export const ORIGINAL_NETWORK_RELAY_METHODS=Object.freeze({
  getWorkspace:"t1.getWorkspace",getObject:"t1.getObject",listObjects:"t1.listObjects",
  listEventsSince:"t1.listEventsSince",listEventCommitWindow:"t1.listEventCommitWindow",putObject:"t1.putObject",
  commitObjectGraph:"t1.commitObjectGraph",deleteObject:"t1.deleteObject",
  listAssets:"t1.listAssets",getAsset:"t1.getAsset",putAsset:"t1.putAsset",
  deleteAsset:"t1.deleteAsset",putRelation:"t1.putRelation",deleteRelation:"t1.deleteRelation",
});
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
  if(method!=="putAsset")return args;
  if(!Array.isArray(args)||args.length!==1)fail();
  return [encodeRecord(args[0])];
}
export function decodeOriginalNetworkRelayArgs(method,args){
  if(method!=="putAsset")return args;
  if(!Array.isArray(args)||args.length!==1)fail();
  return [decodeRecord(args[0])];
}
export function encodeOriginalNetworkRelayResult(method,value){
  return method==="getAsset"&&value!==null?encodeRecord(value):value;
}
export function decodeOriginalNetworkRelayResult(method,value){
  return method==="getAsset"&&value!==null?decodeRecord(value):value;
}
