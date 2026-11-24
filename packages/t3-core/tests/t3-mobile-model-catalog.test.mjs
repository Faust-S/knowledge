import test from "node:test";
import assert from "node:assert/strict";
import {MODEL,MODELS,MODEL_PROFILES,LEGACY_MODELS,modelInstallSources,requireCatalogModel} from "../integration-sources/bli1/catalog.mjs";

test("three stable user profiles contain one family each and hardware variants",()=>{
  assert.deepEqual(MODEL_PROFILES.map(p=>p.id),["light","balanced","extended"]);
  assert.equal(new Set(MODEL_PROFILES.map(p=>p.family)).size,3);
  for(const profile of MODEL_PROFILES){
    assert.ok(Object.isFrozen(profile)&&Object.isFrozen(profile.variants));
    assert.ok(profile.variants.length>=1);
    assert.equal(new Set(profile.variants.map(m=>m.quantization)).size,profile.variants.length);
    for(const m of profile.variants){
      assert.equal(m.profileId,profile.id);
      assert.equal(m.license,"Apache-2.0");
      assert.ok(m.expectedVramMB>0);
      assert.ok(Number.isSafeInteger(m.estimatedDownloadBytes)&&m.estimatedDownloadBytes>0);
      assert.match(m.modelRevision,/^[a-f0-9]{40}$/);
      assert.match(m.modelLibRevision,/^[a-f0-9]{40}$/);
      assert.equal(m.modelSource,m.upstreamModelSource+"/resolve/"+m.modelRevision+"/");
      assert.equal(m.id,requireCatalogModel(m.id).id);
      assert.ok(Object.isFrozen(m));
    }
  }
  assert.equal(MODEL.id,"SmolLM2-360M-Instruct-q4f32_1-MLC");
  assert.ok(LEGACY_MODELS.length>=2);
  assert.ok(LEGACY_MODELS.every(m=>m.profileId===null));
  assert.equal(new Set(MODELS.map(m=>m.id)).size,MODELS.length);
  assert.throws(()=>requireCatalogModel("unapproved"),/MODEL_NOT_IN_POC_CATALOG/);
});
test("one exact install source per actual model including legacy, no aliasing",()=>{
  const pairs=modelInstallSources();
  assert.deepEqual(pairs,MODELS.filter(m=>!m.retiredForProfile).map(m=>({model:m.modelSource,wasm:m.modelLib})));
  assert.equal(new Set(pairs.map(p=>p.model)).size,pairs.length);
  assert.ok(pairs.every(p=>new URL(p.model).origin==="https://huggingface.co"&&new URL(p.wasm).origin==="https://raw.githubusercontent.com"));
});

import {formResponseFormat,classifyInferenceFailure,BrowserInferenceError} from "../integration-sources/bli1/policy.mjs";
test("WebLLM form schema restricts the actual selected fields without requiring missing values",()=>{
 assert.equal(formResponseFormat(undefined),undefined);
 const format=formResponseFormat([{key:"field_1"},{key:"field_3",choices:["actual","planned"]}]);
 assert.equal(format.type,"json_object");
 const schema=JSON.parse(format.schema);
 assert.deepEqual(schema.required,["fields"]);
 assert.equal(schema.additionalProperties,false);
 assert.equal(schema.properties.fields.additionalProperties,false);
 assert.equal(schema.properties.fields.required,undefined);
 assert.deepEqual(schema.properties.fields.properties,{
   field_1:{type:"string"},field_3:{type:"string",enum:["actual","planned"]}
 });
});
test("unknown keys, arbitrary grammar and oversized choice lists cannot enter native structured output",()=>{
 for(const fields of [null,[],[{key:"__proto__"}],[{key:"field_11"}],[{key:"field_1"},{key:"field_1"}],
   [{key:"field_1",choices:[]}],[{key:"field_1",choices:["x","x"]}],[{key:"field_1",choices:[12]}],
   [{key:"field_1",choices:Array.from({length:31},(_,i)=>String(i))}],
   [{key:"field_1",schema:"{}"}],[{key:"field_1",choices:Array.from({length:10},(_,i)=>String(i)+"x".repeat(1700))}]]){
   assert.throws(()=>formResponseFormat(fields),{code:"FORM_SCHEMA_INVALID"});
 }
});

import {readFileSync} from "node:fs";
import {planProfileReplacement,validateModelCatalog} from "../scripts/t3-model-catalog.mjs";
test("developer replacement dry run preserves the other two profiles and retains old exact cache identity",async()=>{
 const source=readFileSync(new URL("../integration-sources/bli1/catalog.mjs",import.meta.url),"utf8");
 const current=await import("../integration-sources/bli1/catalog.mjs");
 const prior=MODEL_PROFILES[0];
 const prebuilt={model_list:MODELS.map(m=>({model_id:m.upstreamId??m.id,model:m.upstreamModelSource??m.modelSource,
   model_lib:m.upstreamModelLib??m.modelLib,vram_required_MB:m.expectedVramMB}))};
 // Synthetic new revision exercises planning only; no network or model
 // availability claim, no change to the real catalog or source pin.
 const revision="a".repeat(40);
 const descriptor={profileId:prior.id,family:prior.family,license:prior.license,
   licenseInfo:prior.variants[0].licenseInfo,
   variants:prior.variants.map((m,i)=>({id:m.id,modelRevision:i===0?revision:m.modelRevision,
     modelLibRevision:m.modelLibRevision,estimatedDownloadBytes:m.estimatedDownloadBytes}))};
 const plan=planProfileReplacement(source,descriptor,prebuilt);
 const next=await import("data:text/javascript;base64,"+Buffer.from(plan.source).toString("base64"));
 validateModelCatalog(next);
 assert.equal(next.MODEL_CATALOG_VERSION,current.MODEL_CATALOG_VERSION+1);
 assert.deepEqual(next.MODEL_PROFILES.slice(1),current.MODEL_PROFILES.slice(1));
 assert.equal(next.MODEL_PROFILES[0].variants[0].modelRevision,revision);
 const old=next.LEGACY_MODELS.find(m=>m.retiredForProfile==="light"&&m.modelSource===prior.variants[0].modelSource);
 assert.equal(old?.upstreamId,prior.variants[0].id);
 assert.equal(old?.id,prior.variants[0].id+"@"+prior.variants[0].modelRevision);
 assert.ok(!next.modelInstallSources().some(s=>s.model===old.modelSource));
 assert.equal(next.MODEL_PROFILES.length,3);
 assert.throws(()=>planProfileReplacement(source,{...descriptor,profileId:"fourth"},prebuilt),/REPLACEMENT_DESCRIPTOR/);
 assert.throws(()=>planProfileReplacement(source,{...descriptor,variants:[{...descriptor.variants[0],id:"not-prebuilt-q4f16_1-MLC"}],family:"not-prebuilt"},prebuilt),/VARIANT_NOT_PREBUILT/);
 assert.throws(()=>planProfileReplacement(source,{...descriptor,variants:[{...descriptor.variants[0],modelRevision:"main"}]},prebuilt),/VARIANT_DESCRIPTOR/);
 assert.equal(current.MODEL_PROFILES[0].variants[0].modelRevision,prior.variants[0].modelRevision);
 // Reactivating the exact former revision uses its existing cache URL
 // and retires only the candidate that is now no longer offered.
 const originalDescriptor={...descriptor,variants:prior.variants.map(m=>({id:m.id,modelRevision:m.modelRevision,
   modelLibRevision:m.modelLibRevision,estimatedDownloadBytes:m.estimatedDownloadBytes}))};
 const rollback=planProfileReplacement(plan.source,originalDescriptor,prebuilt);
 const restored=await import("data:text/javascript;base64,"+Buffer.from(rollback.source).toString("base64"));
 validateModelCatalog(restored);
 assert.deepEqual(restored.MODEL_PROFILES,current.MODEL_PROFILES);
 assert.ok(!restored.LEGACY_MODELS.some(m=>m.retiredForProfile&&m.modelSource===prior.variants[0].modelSource));
});

test("WebLLM worker rejection strings have typed, non-data-bearing failure diagnostics",()=>{
 const cases=[
  ["ContextWindowSizeExceededError: Prompt tokens exceed context window size: number of prompt tokens: 12000","CONTEXT_WINDOW_EXCEEDED"],
  ["DeviceLostError: The WebGPU device was lost while loading the model","GPU_DEVICE_LOST"],
  [Error("GPUOutOfMemoryError: allocation failed"),"GPU_MEMORY_EXHAUSTED"],
  ["ModelNotLoadedError: Model not loaded before trying to complete chat","MODEL_SESSION_LOST"],
  ["GrammarMatcherInitError: Failed to initialize the grammar matcher","FORM_GRAMMAR_FAILED"],
  ["unexpected PRIVATE_REQUEST_SENTINEL","LOCAL_INFERENCE_FAILED"],
  [null,"LOCAL_INFERENCE_FAILED"],
  [new BrowserInferenceError("CANCELLED","stopped"),"CANCELLED"]
 ];
 for(const [error,code] of cases){
  const result=classifyInferenceFailure(error);
  assert.equal(result.code,code);
  assert.ok(result instanceof BrowserInferenceError);
  assert.doesNotMatch(result.message,/PRIVATE_REQUEST_SENTINEL|12000/);
 }
});
