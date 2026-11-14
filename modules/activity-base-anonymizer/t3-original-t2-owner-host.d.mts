import type {T3ControlActivityBinding} from './t3-control-host-link.mjs';
export type T2ActivityKernelFacade = {
  readonly sessionInfo: Readonly<{
    mode: string;contract_version:'1.3.0';runtime_version:'0.3.6';service_id:string;
  }>;
  hasOperation(operation:string):boolean;
  getWorkspace(workspaceId:string):Promise<unknown>;
  listObjects(query:unknown):Promise<unknown>;
  getObject(workspaceId:string,objectId:string):Promise<unknown>;
  listEventsSince(workspaceId:string):Promise<unknown>;
  putObject?(input:unknown):Promise<unknown>;
};
export function useOriginalT2ActivityKernelFacade(session:unknown):T2ActivityKernelFacade;
export function openActivityFromOriginalT2Host(input:{
  session:unknown;
  reviewerSession?:unknown;
  control:unknown;
  currentWorkspace:unknown;
  bindings:unknown;
  readActivityFromWorkspaceContext:Function;
  createSubjectKernelBinding:Function;
  subscribeExistingInvalidation?:(listener:()=>void)=>(()=>void);
}):Promise<T3ControlActivityBinding>;
