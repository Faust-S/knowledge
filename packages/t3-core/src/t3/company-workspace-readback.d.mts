import type {KernelFacade} from '../workspace-contract';
import type {PreviewObjectRow} from '../kernel-client/contracts/runtime-1.3.0';
export const COMPANY_WORK_SCHEMA:string;
export interface CompanyWorkReadbackRecord {
  readonly objectId:string;readonly eventId:string;
  readonly organizationId:string;readonly workspaceId:string;readonly executorId:string;
  readonly taskId:string;readonly taskRevisionId:string;readonly taskPackageSha256:string;
  readonly artifactId:string;readonly kind:'TASK'|'DRAFT'|'DOCUMENT'|'RESULT'|'HISTORY';
  readonly mimeType:string;readonly sha256:string;readonly text:string;
}
export interface CompanyWorkspaceReadback {
  readonly workspaceId:string;readonly originalKernelReadback:true;
  readonly checkedImportedObjects:number|null;
  readonly records:readonly CompanyWorkReadbackRecord[];
  readonly signedReceiptVerified:false;
}
export function isInstalledCompanyExchange(kernel:KernelFacade,signedWorkspaceScope:boolean):boolean;
export function companyWorkRecordKeyParts(data:Record<string,unknown>):unknown[];
export function companyWorkEventPayload(data:Record<string,unknown>,objectId:string):Record<string,unknown>;
export function readOriginalCompanyWorkspace(input:{
  kernel:KernelFacade;workspaceId:string;expectedRows?:readonly PreviewObjectRow[]|null;
  organizationId?:string|null;
}):Promise<CompanyWorkspaceReadback>;

export function completeCompanyMergePlan(preview:unknown,plan:unknown,workspaceId:string):boolean;
export function validateCompanyMergeReceipt(preview:unknown,plan:unknown,receipt:unknown):readonly string[];

export function readOriginalCompanyTaskRecords(input:{
  kernel:Pick<KernelFacade,'sessionInfo'|'hasOperation'|'getWorkspace'|'getObject'|'listEventsSince'>;
  organizationId:string;workspaceId:string;executorId:string;taskId:string;
  taskRevisionId:string;taskPackageSha256:string;selectedResultObjectId?:string|null;
}):Promise<Readonly<{
  organizationId:string;workspaceId:string;executorId:string;taskId:string;
  taskRevisionId:string;taskPackageSha256:string;originalKernelReadback:true;
  signedReceiptVerified:false;task:CompanyWorkReadbackRecord|null;
  results:readonly CompanyWorkReadbackRecord[];
  selectedEvidence?:Readonly<{object:unknown;events:readonly unknown[]}>;
}>>;
