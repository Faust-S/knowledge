// Original IWXA T3 local cryptographic strict JSON boundary adopted as ONE executable implementation in knowledge.
// No independent Kernel/Store/Access issuer, no committed real keys.
// JSON.parse silently collapses duplicate keys. Signed/package/vault boundaries
// reject those ambiguous encodings before parsing the value.
export function strictJson(text){
  if(typeof text!=='string'||text.length>32*1024*1024)throw new Error('JSON_SIZE_INVALID');
  let p=0,nodes=0;const invalid=()=>{throw new Error('JSON_ENCODING_INVALID');};
  const ws=()=>{while(/[ \t\r\n]/.test(text[p]??'!'))p++;};
  function string(){const re=/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;re.lastIndex=p;const m=re.exec(text);if(!m)invalid();p=re.lastIndex;return JSON.parse(m[0]);}
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
