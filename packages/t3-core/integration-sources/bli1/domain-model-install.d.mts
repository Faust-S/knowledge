/** Temporary, explicitly confirmed SW permission for the pinned WebLLM model. */
export function beginDomainModelInstallation(modelId?:string,options?:{signal?:AbortSignal}): Promise<() => Promise<void>>;
