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
  /** Internal trusted Kernel realm transport. Not exposed on UI MessagePort.
   * The original DPAPI D3 owner is the only caller allowed to enqueue T2
   * operations, and its signed JIT and separate Human APPLY remain native. */
  originalKernelRelay:(verb:"attach"|"next"|"result"|"detach"|"sourceMutation",
    payload?:Record<string,unknown>)=>Promise<any>;
  /** Existing D6 signed native Result owner, never raw Object material. */
  nativeD6Request:(verb:string,payload?:Record<string,unknown>)=>Promise<any>;
  /** Native age/Publisher is resolved inside the installed Control process. */
  nativeD7Request:(verb:string,payload?:Record<string,unknown>)=>Promise<any>;
};
