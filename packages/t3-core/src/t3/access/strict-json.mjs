// Original IWXA T3 local cryptographic strict JSON boundary adopted as ONE executable implementation in knowledge.
// No independent Kernel/Store/Access issuer, no committed real keys.
// JSON.parse silently collapses duplicate keys. Signed/package/vault boundaries
// reject those ambiguous encodings before parsing the value.
export function strictJson(text,{maxLength=32*1024*1024}={}){
  // Existing signed/credential JSON callers keep their original 32 MiB
  // ceiling. Only an explicitly bounded original Control carrier may pass
  // its larger base64url envelope limit; duplicate-key validation is unchanged.
  if(!Number.isSafeInteger(maxLength)||maxLength<1||
     maxLength>Math.ceil(32*1024*1024/3)*4+16*1024)
    throw new Error('JSON_SIZE_LIMIT_INVALID');
  if(typeof text!=='string'||text.length>maxLength)
    throw new Error('JSON_SIZE_INVALID');
  let p=0,nodes=0;const invalid=()=>{throw new Error('JSON_ENCODING_INVALID');};
  const ws=()=>{while(/[ \t\r\n]/.test(text[p]??'!'))p++;};
  function string(){
    // A 32 MiB .iwxa is ~44.8 MiB after base64url JSON encoding.
    // V8's repeated-regexp group can overflow its stack on one huge
    // string. Scan successive quote positions iteratively instead;
    // JSON.parse still validates ALL escapes, control characters and UTF-8
    // decoded JSON semantics before we accept the resulting value.
    if(text[p]!=='"')invalid();
    const start=p;
    let offset=p+1;
    while(true){
      const end=text.indexOf('"',offset);
      if(end<0)invalid();
      let escapes=0;
      for(let i=end-1;i>start&&text[i]==='\\';i--)escapes++;
      if(escapes%2===0){
        p=end+1;
        try{return JSON.parse(text.slice(start,p));}
        catch{invalid();}
      }
      offset=end+1;
    }
  }
  function value(depth){if(depth>64||++nodes>200000)invalid();ws();const c=text[p];
    if(c==='"'){string();return;}
    if(c==='{'){p++;ws();const keys=new Set();if(text[p]==='}'){p++;return;}while(true){ws();const key=string();if(keys.has(key))throw new Error('JSON_DUPLICATE_KEY');keys.add(key);ws();if(text[p++]!==':')invalid();value(depth+1);ws();if(text[p]==='}'){p++;return;}if(text[p++]!==',')invalid();}}
    if(c==='['){p++;ws();if(text[p]===']'){p++;return;}while(true){value(depth+1);ws();if(text[p]===']'){p++;return;}if(text[p++]!==',')invalid();}}
    const re=/(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;re.lastIndex=p;const m=re.exec(text);if(!m)invalid();
    // IEEE-754 overflow would become Infinity/-Infinity, which JSON.stringify
    // aliases to null and invalidates portable semantic identity (RFC 8785).
    if(!['true','false','null'].includes(m[0])&&!Number.isFinite(Number(m[0])))
      throw new Error('JSON_NUMBER_OUT_OF_RANGE');
    p=re.lastIndex;
  }
  value(0);ws();if(p!==text.length)invalid();return JSON.parse(text);
}
