export type OriginalMutationRouteResult={kind:"LOCAL_T3"}|{kind:"CAPTURED";originalReceipt:unknown};
export type OriginalMutationRoute=(method:string,args:unknown[])=>Promise<OriginalMutationRouteResult>;
export interface OriginalLocalSourceMutationRoute {
  accept(negotiated:unknown):void;
  clear():void;
  route:OriginalMutationRoute;
}
export function createOriginalLocalSourceMutationRoute(input:{
  workspaceId:string;
  originalKernelRelay:(verb:"sourceMutation",payload:Record<string,unknown>)=>Promise<unknown>;
  isHostActive:()=>boolean;
}):OriginalLocalSourceMutationRoute;
