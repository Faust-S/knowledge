import type { T3SignedActivityAccess } from "./index.mjs";
import type { SignedAccessInvalidationSubscription } from "../workspace-host/runtime/types";

/** Exact browser owner shape. Every access selector is callable and
 * asynchronous; a port is either selected by original Control or null. */
export declare function createControlLoopbackOwner(input:{
  origin:string;
  token:string;
  fetchImpl?:typeof fetch;
}): {
  requireSignedOwner:true;
  signedKernelAccess:(operation:string)=>Promise<T3SignedActivityAccess|null>;
  signedActivityAccess:()=>Promise<T3SignedActivityAccess|null>;
  subscribeSignedAccessInvalidation:SignedAccessInvalidationSubscription;
  /** Trusted Kernel-realm only. Original D3 is executed in native Control. */
  reconciliationRequest:(verb:string,payload?:Record<string,unknown>)=>Promise<any>;
};
