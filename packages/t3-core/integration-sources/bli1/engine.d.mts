export class BrowserLocalRuntimeAdapter {
  constructor(options?: {modelId?:string});
  readonly modelId:string;
  readonly ready: boolean;
  cachedWeights(): Promise<boolean>;
  cachedForOffline(knownWeights?: boolean): Promise<{ready:boolean;missing:readonly string[]}>;
  load(options?: { networkConsent?: boolean; signal?: AbortSignal;
    onProgress?: (progress: { text?: string; progress?: number }) => void
  }): Promise<{ reused: boolean; cachedWeights: boolean }>;
  invoke(prompt: string, options?: { onChunk?: (text: string) => void; maxTokens?: number;
    formFields?: readonly Readonly<{key:string;choices?:readonly string[]}>[] }): Promise<string>;
  cancel(): void;
  dispose(): void;
  unload(): Promise<void>;
  deleteCachedWeights(): Promise<void>;
}

export class AgentLocalModelAdapter {
  constructor(connectionCode: string);
  readonly ready: boolean;
  connect(): Promise<{model:string}>;
  invoke(prompt:string,options?:{onChunk?:(text:string)=>void;maxTokens?:number;formFields?:readonly Readonly<{key:string;choices?:readonly string[]}>[]}):Promise<string>;
  cancel():void;
  unload():Promise<void>;
  dispose():void;
}
