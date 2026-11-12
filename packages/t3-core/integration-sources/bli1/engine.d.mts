export class BrowserLocalRuntimeAdapter {
  readonly ready: boolean;
  cachedWeights(): Promise<boolean>;
  cachedForOffline(knownWeights?: boolean): Promise<{ready:boolean;missing:readonly string[]}>;
  load(options?: { networkConsent?: boolean; signal?: AbortSignal;
    onProgress?: (progress: { text?: string; progress?: number }) => void
  }): Promise<{ reused: boolean; cachedWeights: boolean }>;
  invoke(prompt: string, options?: { onChunk?: (text: string) => void; maxTokens?: number }): Promise<string>;
  cancel(): void;
  dispose(): void;
  unload(): Promise<void>;
  deleteCachedWeights(): Promise<void>;
}
