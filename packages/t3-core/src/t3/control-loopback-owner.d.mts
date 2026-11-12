import type {AppProps} from "../App";

export declare function createControlLoopbackOwner(input:{
  origin:string;
  token:string;
  fetchImpl?:typeof fetch;
}):Required<Pick<AppProps,
  "requireSignedOwner"|"signedKernelAccess"|"signedActivityAccess"|
  "subscribeSignedAccessInvalidation">>;
