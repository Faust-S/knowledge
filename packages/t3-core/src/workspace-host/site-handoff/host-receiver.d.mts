export interface HandoffHostWindow {
  readonly location: { readonly origin: string };
  readonly opener: { postMessage(value: unknown, origin: string): void } | null;
  readonly crypto: Crypto;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
export function mountT2SiteHandoffReceiver<T>(options: {
  hostWindow: HandoffHostWindow;
  expectedSiteOrigin: string;
  validateSource: (raw: string) => T | false | Promise<T | false>;
  onPreview: (candidate: T) => void | boolean | { status?: string; allowed?: boolean; accepted?: boolean } |
    Promise<void | boolean | { status?: string; allowed?: boolean; accepted?: boolean }>;
  cryptoSource?: Crypto;
  onStatus?: (status: string) => void;
}): { dispose(): void; readonly consumed: boolean; sendReceipt(raw: string): void };
