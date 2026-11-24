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
  assert.equal(LEGACY_MODELS.length,2);
  assert.ok(LEGACY_MODELS.every(m=>m.profileId===null));
  assert.equal(new Set(MODELS.map(m=>m.id)).size,MODELS.length);
  assert.throws(()=>requireCatalogModel("unapproved"),/MODEL_NOT_IN_POC_CATALOG/);
});
test("one exact install source per actual model including legacy, no aliasing",()=>{
  const pairs=modelInstallSources();
  assert.deepEqual(pairs,MODELS.map(m=>({model:m.modelSource,wasm:m.modelLib})));
  assert.equal(new Set(pairs.map(p=>p.model)).size,pairs.length);
  assert.ok(pairs.every(p=>new URL(p.model).origin==="https://huggingface.co"&&new URL(p.wasm).origin==="https://raw.githubusercontent.com"));
});

import {formResponseFormat} from "../integration-sources/bli1/policy.mjs";
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
