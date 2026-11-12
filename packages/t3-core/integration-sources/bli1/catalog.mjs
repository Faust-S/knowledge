/** Small browser WebGPU model, present in WebLLM 0.2.87's prebuilt catalog.
 * Model weights and their license are separate from the Apache-2.0 engine.
 * This POC does not claim pinned model bytes or strict T3 qualification. */
export const MODEL = Object.freeze({
  id: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
  label: 'SmolLM2 360M Instruct',
  quantization: 'q4f32_1',
  expectedVramMB: 580,
  modelSource: 'https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC',
  licenseInfo: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct',
  engine: '@mlc-ai/web-llm@0.2.87',
  contextWindow: 4096,
});

export function requireCatalogModel(modelId) {
  if (modelId !== MODEL.id) throw new Error('MODEL_NOT_IN_POC_CATALOG');
  return MODEL;
}
