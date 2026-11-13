import type { KernelBootstrap } from "../kernel-client/types";
export declare const ORIGINAL_KERNEL_CONTRACT_OPERATIONS: readonly string[];
export declare function createIsolatedOriginalKernelBootstrap(input: {
  client: {invoke(method: string,...args: unknown[]): Promise<unknown>};
  serviceId: string;
}): KernelBootstrap;
