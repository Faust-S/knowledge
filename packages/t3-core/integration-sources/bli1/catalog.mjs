/** Curated WebLLM 0.2.87 models. Weights are downloaded only by explicit
 * user action, into the ORIGINAL WebLLM cache. No other inference engine. */
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
export const MODELS = Object.freeze([MODEL,Object.freeze({
  id: 'SmolLM2-1.7B-Instruct-q4f32_1-MLC',
  label: 'SmolLM2 1.7B Instruct',
  quantization: 'q4f32_1',
  expectedVramMB: 2693,
  modelSource: 'https://huggingface.co/mlc-ai/SmolLM2-1.7B-Instruct-q4f32_1-MLC',
  licenseInfo: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct',
  engine: '@mlc-ai/web-llm@0.2.87',
  contextWindow: 4096,
})]);

export function requireCatalogModel(modelId) {
  const found=MODELS.find(model=>model.id===modelId);
  if(!found)throw new Error('MODEL_NOT_IN_POC_CATALOG');
  return found;
}
