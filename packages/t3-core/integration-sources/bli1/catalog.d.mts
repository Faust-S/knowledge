export const MODEL: Readonly<{
  id: string;
  label: string;
  engine: string;
  modelSource: string;
  licenseInfo: string;
  quantization: string;
  expectedVramMB: number;
  contextWindow: number;
}>;
export function requireCatalogModel(modelId: string): typeof MODEL;
