import type {OriginalLocalSourceMutationRoute,OriginalMutationRoute} from './original-local-source-mutation-route.mjs';
export interface OriginalInstalledNetworkScope {
  readonly schema:'IWXA_T4_INSTALLED_NATIVE_NETWORK_SCOPE/1';
  readonly role:'SOURCE'|'RECIPIENT';
  readonly sourceWorkspaceId:string;
  readonly technicalWorkspaceId:string;
  readonly registryWorkspaceId:string;
}
export function normalizeOriginalInstalledNetworkScope(value:unknown):OriginalInstalledNetworkScope;
export function sameOriginalInstalledNetworkScope(a:unknown,b:unknown):boolean;
export function allowOriginalInstalledNetworkUiOperation(scope:OriginalInstalledNetworkScope,operation:string,context:unknown,networkReady?:boolean):boolean;
export function allowOriginalInstalledNetworkUiRequest(scope:OriginalInstalledNetworkScope,input:unknown,context:unknown,networkReady?:boolean):boolean;
export function createOriginalInstalledNetworkMutationRoute(input:{scope:OriginalInstalledNetworkScope;sourceRoute?:OriginalLocalSourceMutationRoute|null;isHostActive:()=>boolean}):OriginalMutationRoute;
