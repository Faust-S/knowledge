import type { KernelFacade } from "../workspace-contract";
export declare const ISOLATED_KERNEL_SCHEMA: string;
export declare const ALLOWED_ISOLATED_KERNEL_METHODS: readonly string[];
export interface IsolatedKernelClient {
  invoke(method: string,...args: unknown[]): Promise<any>;
  subscribeInvalidation(listener:(reason?:"unavailable")=>void):()=>void;
  close(): void;
}
export interface IsolatedKernelReceiver {
  invalidate(): void;
  close(): void;
}
interface TrustedRealmServerArgs {
  event: MessageEvent;
  uiOrigin: string;
  parentWindow: Window;
  createSignedFacade(method: string, reportReadStage:(stage:string)=>void):
    Promise<KernelFacade> | KernelFacade;
  isActive(): boolean;
  describeOriginalSession?(): Promise<unknown> | unknown;
  validateOriginalObjects?(value: unknown): Promise<unknown> | unknown;
  selectedWorkspaceContext?(operation: string): Promise<unknown> | unknown;
  /** Only the native signed Control can execute these D3 operations. */
  reconciliationRequest?(verb: string,payload?: unknown): Promise<unknown> | unknown;
  /** An installed original D6 signed Result port through Control/SSE. */
  nativeD6Request?(verb: string,payload?: unknown): Promise<unknown> | unknown;
  /** Original installed age/Publisher owner through the same Control/SSE. */
  nativeD7Request?(verb: string,payload?: unknown): Promise<unknown> | unknown;
}
export declare function acceptOriginalKernelRealmChannel(input: TrustedRealmServerArgs):
  IsolatedKernelReceiver | null;
export declare function bindSignedOriginalKernelPort(input: Omit<TrustedRealmServerArgs,"event"|"uiOrigin"|"parentWindow"> & {
  port: MessagePort;
}): IsolatedKernelReceiver;
export declare function createIsolatedKernelClient(input: {
  port: MessagePort;
  isActive?: () => boolean;
  timeoutMs?: number;
  readTimeoutMs?: number;
}): IsolatedKernelClient;
export declare function openOriginalKernelRealm(input: {
  frame: Window;
  realmOrigin: string;
  channelFactory: () => MessageChannel;
  sessionToken?: string | null;
  nonceFactory?: () => string;
  timeoutMs?: number;
  readTimeoutMs?: number;
}): Promise<IsolatedKernelClient>;