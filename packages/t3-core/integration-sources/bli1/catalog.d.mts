export type BrowserLocalModel = Readonly<{
  id:string;
  label:string;
  engine:string;
  modelSource:string;
  licenseInfo:string;
  quantization:string;
  expectedVramMB:number;
  contextWindow:number;
}>;
export const MODEL:BrowserLocalModel;
export const MODELS:readonly BrowserLocalModel[];
export function requireCatalogModel(modelId:string):BrowserLocalModel;
