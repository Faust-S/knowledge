// Canonical JSON digest for externally owned ERP snapshots. The raw
// document stays in the authenticated Agent owner, never in T3 Object/Event.
const MAX_BYTES=2*1024*1024;
function denied(code){throw Object.assign(new Error(code),{code});}
function stable(value,stack=new Set(),depth=0){
  if(depth>32)denied('T3_ERP_SNAPSHOT_TOO_DEEP');
  if(value===null)return 'null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value!=='object'||stack.has(value))
    denied('T3_ERP_SNAPSHOT_NON_JSON');
  const proto=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&proto!==null&&proto!==Object.prototype)
    denied('T3_ERP_SNAPSHOT_NON_JSON');
  stack.add(value);
  let result;
  if(Array.isArray(value)){
    if(value.length>10000)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
    result='['+value.map(x=>stable(x,stack,depth+1)).join(',')+']';
  }else{
    const keys=Object.keys(value).sort();
    if(keys.length>10000)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
    result='{'+keys.map(key=>{
      if(['__proto__','prototype','constructor'].includes(key))
        denied('T3_ERP_SNAPSHOT_UNSAFE_KEY');
      return JSON.stringify(key)+':'+stable(value[key],stack,depth+1);
    }).join(',')+'}';
  }
  stack.delete(value);
  return result;
}
export async function digestExternalOwnerSnapshot(data){
  const canonical=stable(data);
  const encoded=new TextEncoder().encode(canonical);
  if(encoded.byteLength>MAX_BYTES)denied('T3_ERP_SNAPSHOT_TOO_LARGE');
  if(typeof globalThis.crypto?.subtle?.digest!=='function')
    denied('T3_ERP_SHA256_UNAVAILABLE');
  const hash=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',encoded));
  return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
