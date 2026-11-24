/** Single owner of curated local models for all T3 domains.
 * Replace the variants inside a stable profile, not domain/UI code.
 * Sources: @mlc-ai/web-llm 0.2.87 prebuiltAppConfig; exact URLs, not immutable
 * weight hashes. Source updates are explicit qualified T3 release changes.
 * expectedVramMB is upstream GPU estimate, NOT transfer bytes or free RAM.
 */
export const MODEL_CATALOG_VERSION = 2;
const PROFILES = [
  {
    "id": "light",
    "label": "Лёгкая",
    "family": "Qwen2.5-0.5B-Instruct",
    "licenseInfo": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct",
    "license": "Apache-2.0",
    "variants": [
      {
        "id": "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
        "quantization": "q4f16_1",
        "expectedVramMB": 944.62,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm"
      },
      {
        "id": "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
        "quantization": "q4f32_1",
        "expectedVramMB": 1060.2,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-0.5B-Instruct-q4f32_1_cs1k-webgpu.wasm"
      }
    ]
  },
  {
    "id": "balanced",
    "label": "Сбалансированная",
    "family": "Qwen2.5-1.5B-Instruct",
    "licenseInfo": "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct",
    "license": "Apache-2.0",
    "variants": [
      {
        "id": "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
        "quantization": "q4f16_1",
        "expectedVramMB": 1629.75,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm"
      },
      {
        "id": "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
        "quantization": "q4f32_1",
        "expectedVramMB": 1888.97,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-1.5B-Instruct-q4f32_1_cs1k-webgpu.wasm"
      }
    ]
  },
  {
    "id": "extended",
    "label": "Расширенная",
    "family": "Qwen2.5-7B-Instruct",
    "licenseInfo": "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
    "license": "Apache-2.0",
    "variants": [
      {
        "id": "Qwen2.5-7B-Instruct-q4f16_1-MLC",
        "quantization": "q4f16_1",
        "expectedVramMB": 5106.67,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm"
      },
      {
        "id": "Qwen2.5-7B-Instruct-q4f32_1-MLC",
        "quantization": "q4f32_1",
        "expectedVramMB": 5900.09,
        "modelSource": "https://huggingface.co/mlc-ai/Qwen2.5-7B-Instruct-q4f32_1-MLC",
        "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-7B-Instruct-q4f32_1_cs1k-webgpu.wasm"
      }
    ]
  }
];
const LEGACY = [
  {
    "id": "SmolLM2-360M-Instruct-q4f32_1-MLC",
    "quantization": "q4f32_1",
    "expectedVramMB": 580,
    "modelSource": "https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC",
    "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm",
    "label": "SmolLM2 360M Instruct",
    "licenseInfo": "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
    "license": "Apache-2.0",
    "profileId": null
  },
  {
    "id": "SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    "quantization": "q4f32_1",
    "expectedVramMB": 2693,
    "modelSource": "https://huggingface.co/mlc-ai/SmolLM2-1.7B-Instruct-q4f32_1-MLC",
    "modelLib": "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/SmolLM2-1.7B-Instruct-q4f32_1_cs1k-webgpu.wasm",
    "label": "SmolLM2 1.7B Instruct",
    "licenseInfo": "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct",
    "license": "Apache-2.0",
    "profileId": null
  }
];
const ENGINE = "@mlc-ai/web-llm@0.2.87";
const makeModel = model => Object.freeze({...model,engine:ENGINE,contextWindow:4096});
const visible = PROFILES.map(profile => Object.freeze({
  id:profile.id,label:profile.label,family:profile.family,license:profile.license,
  variants:Object.freeze(profile.variants.map(variant => makeModel({
    ...variant,profileId:profile.id,label:profile.family,
    license:profile.license,licenseInfo:profile.licenseInfo,
  }))),
}));
export const MODEL_PROFILES = Object.freeze(visible);
export const LEGACY_MODELS = Object.freeze(LEGACY.map(makeModel));
// Keep the already-qualified technical default for existing native/Host
// BLI callers. Ordinary domain assistants select one of MODEL_PROFILES.
export const MODEL = LEGACY_MODELS[0];
export const MODELS = Object.freeze([...LEGACY_MODELS,...MODEL_PROFILES.flatMap(p=>p.variants)]);
export function requireCatalogModel(modelId) {
  const found=MODELS.find(model=>model.id===modelId);
  if(!found)throw Error("MODEL_NOT_IN_POC_CATALOG");
  return found;
}
export function modelInstallSources() {
  return MODELS.map(model=>({model:model.modelSource,wasm:model.modelLib}));
}
