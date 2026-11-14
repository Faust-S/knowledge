/** Temporary, explicitly confirmed SW permission for the pinned WebLLM model. */
export function beginDomainModelInstallation(modelId?:string): Promise<() => Promise<void>>;
