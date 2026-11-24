// Discarded test-only entry. Never include this in a product release.
// Actual original compiled engine, actual cache and a physically offline
// browser; no test substitution of inference or fixture answers.
function nativeShape(raw,fields){
 try{
   const parsed=JSON.parse(raw);
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
      Object.keys(parsed).length!==1||!Object.hasOwn(parsed,"fields")||
      !parsed.fields||typeof parsed.fields!=="object"||Array.isArray(parsed.fields))return false;
   const allowed=new Map(fields.map(f=>[f.key,f]));
   return Object.entries(parsed.fields).every(([key,value])=>{
     const f=allowed.get(key);
     return f&&typeof value==="string"&&(!f.choices||f.choices.includes(value));
   });
 }catch{return false;}
}
async function evaluateLocalForms({modelId,cases,modes}){
 const checkOffline=()=>{if(navigator.onLine!==false)throw Error("T3_QUALITY_NETWORK_NOT_DISABLED");};
 checkOffline();
 const {BrowserLocalRuntimeAdapter}=await import("../src/modules/t3-local-inference/engine.mjs");
 const runtime=new BrowserLocalRuntimeAdapter({modelId});
 const reports=modes.map(mode=>({schema:"iwxa.club.assistant-responses/1",modelId,mode,responses:[]}));
 let loadCount=0;
 try{
   const offline=await runtime.cachedForOffline();
   if(!offline.ready)throw Error("T3_QUALITY_CACHED_MODEL_REQUIRED");
   for(const c of cases){
     for(const report of reports){
       checkOffline();
       if(!runtime.ready){
         await runtime.load({networkConsent:false});loadCount++;
       }
       let first=null,raw=null,code=null;
       const start=performance.now();
       try{
         raw=await runtime.invoke(c.prompt,{
           maxTokens:768,
           ...(report.mode==="structured"?{formFields:c.formFields}:{}),
           onChunk:value=>{if(first===null&&value.length)first=performance.now()-start;}
         });
       }catch(e){code=typeof e?.code==="string"?e.code:"INFERENCE_FAILED";}
       const elapsed=performance.now()-start;
       checkOffline();
       report.responses.push({id:c.id,raw,code,
         nativeShape:typeof raw==="string"&&nativeShape(raw,c.formFields),
         firstTokenMs:first===null?null:Math.round(first),elapsedMs:Math.round(elapsed)});
     }
   }
   return {schema:"iwxa.club.assistant-comparison/1",modelId,loadCount,runs:reports};
 }finally{
   try{if(runtime.ready)await runtime.unload();}finally{runtime.dispose();}
 }
}
globalThis.__IWXA_T3_QUALITY_WITNESS__=evaluateLocalForms;
