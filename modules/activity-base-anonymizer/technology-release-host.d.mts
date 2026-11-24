import type {TechnologyProduct} from './technology-product.mjs';
export type TechnologyReleaseRequest={object_data:TechnologyProduct;product_sha256:string};
export type TechnologyReleaseStatus='ORIGINAL_TECHNOLOGY_RELEASED'|'TECHNOLOGY_RELEASE_CANCELLED'|
 'TECHNOLOGY_RELEASE_NOT_STARTED'|'TECHNOLOGY_RELEASE_BUSY'|'TECHNOLOGY_RELEASE_RECONCILIATION_REQUIRED'|
 'TECHNOLOGY_SAVE_OUTCOME_UNKNOWN'|'TECHNOLOGY_SAVE_READBACK_FAILED'|'TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN';
export type TechnologyReleaseResult={status:TechnologyReleaseStatus;product_sha256:string;
 file_saved:boolean|null;export_confirmed:boolean;package_digest?:string};
export type TechnologyReleasePort={reviewAndRelease(request:TechnologyReleaseRequest):Promise<TechnologyReleaseResult>};
export type OriginalTechnologyReleaseBinding={
 subject:unknown;workspace_id:string;readAcceptedProduct:(digest:string)=>Promise<unknown>;
 inspectWholeWorkspace:(id:string)=>Promise<unknown>;isCurrent:()=>boolean;
 saveAndReadback:(input:{filename:string;bytes:Uint8Array;package_digest:string;product_sha256:string})=>Promise<unknown>;
};
export type OriginalTechnologyReleaseResolver=(request:TechnologyReleaseRequest,isCurrent:()=>boolean)=>
 Promise<OriginalTechnologyReleaseBinding|null>;
export function createTechnologyReleaseHost(input:{resolveOriginalRelease:OriginalTechnologyReleaseResolver;
 subscribeInvalidation:(listener:()=>void)=>()=>void}):{readonly port:TechnologyReleasePort;dispose():void};
