import type {D05RouteReview,D05QualityReview} from './d05-route-comparison.mjs';
export type D05SignedRouteReview=Omit<D05RouteReview,'source_authority'> & {
 source_authority:'ORIGINAL_SIGNED_SELECTED_READBACK';quality_review?:D05QualityReview;
};
export type D05RouteReviewPort={
 readSelectedRoutes:(options?:{includeRecordedReports?:boolean})=>Promise<D05SignedRouteReview>;
 subscribeInvalidation:(listener:()=>void)=>(()=>void);
};
export type D05RouteHostConfig={
 context:unknown;signedAccess:unknown;createSubjectKernelBinding:Function;
 subscribeOwnerInvalidation:(listener:()=>void)=>(()=>void);includeQualityPlans?:boolean;includeTechnologyDraft?:boolean;includeRecordedReports?:boolean;
};
export function reviewSelectedD05RouteModels(config:D05RouteHostConfig):Promise<D05SignedRouteReview>;
export function createTrustedD05RouteReviewPort(config:D05RouteHostConfig):D05RouteReviewPort;
