import test from "node:test";
import assert from "node:assert/strict";
import {MODEL,MODELS,MODEL_PROFILES,LEGACY_MODELS,modelInstallSources,requireCatalogModel} from "../integration-sources/bli1/catalog.mjs";

test("three stable user profiles contain one family each and two hardware variants",()=>{
  assert.deepEqual(MODEL_PROFILES.map(p=>p.id),["light","balanced","extended"]);
  assert.equal(new Set(MODEL_PROFILES.map(p=>p.family)).size,3);
  for(const profile of MODEL_PROFILES){
    assert.ok(Object.isFrozen(profile)&&Object.isFrozen(profile.variants));
    assert.equal(profile.variants.length,2);
    assert.deepEqual(profile.variants.map(m=>m.quantization),["q4f16_1","q4f32_1"]);
    for(const m of profile.variants){
      assert.equal(m.profileId,profile.id);
      assert.equal(m.license,"Apache-2.0");
      assert.ok(m.expectedVramMB>0);
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
