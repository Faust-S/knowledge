import type {ContextProjection,ContextRequest,EpistemicKind} from '../index.js';
export declare const PROJECT_CONTINUATION_VERSION:'0.1.0';
export type ContinuationSourceState='accepted'|'reference'|'proposed';
export type ContinuationSourceKind='document'|'correspondence'|'decision'|'result';
export interface ContinuationField {
 readonly key:string;
 readonly required:boolean;
 /** Case-insensitive exact field labels preceding a colon in a source line. */
 readonly labels:readonly string[];
}
export interface ContinuationRequest {
 readonly taskId:string;
 readonly workspaceRef:string;
 /** Host-owned revision of the authorized source roster, not a K01 store. */
 readonly scopeRevision:string;
 readonly maxTokens:number;
 readonly allowedSources:readonly string[];
 readonly fields:readonly ContinuationField[];
}
export type ContinuationSupersedes=string|{
 readonly sourceRef:string;
 readonly fields:readonly string[];
};
export interface ContinuationSource {
 readonly sourceRef:string;
 readonly workspaceRef:string;
 readonly revision:string;
 readonly kind:ContinuationSourceKind;
 readonly state:ContinuationSourceState;
 readonly epistemic:EpistemicKind;
 readonly issuedAt:string;
 readonly topics:readonly string[];
 readonly supersedes:readonly ContinuationSupersedes[];
}
export interface ContinuationSourcePort {
 /** Provider validates Task/Workspace permission and lists authorized metadata. */
 listSources(request:{
  taskId:string;workspaceRef:string;allowedSources:string[];
 }):Promise<{scopeRevision:string;sources:ContinuationSource[]}>;
 /** Provider supplies a pinned, full document snapshot; no write is performed. */
 readSource(request:{
  sourceRef:string;requestedRevision:string;workspaceRef:string;
 }):Promise<{revision:string;complete:boolean;content?:string}>;
}
export type ContinuationIssueType=
 'source_unavailable'|'superseded'|'approval_required'|'missing'|
 'contradiction'|'pending_change'|'ambiguous_lines'|'budget_exceeded';
export interface ContinuationIssue {
 readonly type:ContinuationIssueType;
 readonly fieldKey:string;
 readonly sources:readonly string[];
}
export interface ContinuationProjection {
 readonly contractVersion:'0.1.0';
 readonly workspaceRef:string;
 readonly scopeRevision:string;
 readonly request:ContextRequest;
 /** Original, compatible K01 ContextProjection; accepted facts only. */
 readonly projection:ContextProjection;
 readonly covered:string[];
 readonly requiredComplete:boolean;
 readonly issues:ContinuationIssue[];
 readonly metrics:{
  readonly readCount:number;readonly readBytes:number;readonly sourceCount:number;
  readonly relevantSources:number;readonly projectionBytes:number;
 };
}
export interface ContinuationRecheck {
 readonly allCurrent:boolean;
 readonly checked:number;
 readonly failures:readonly {reason:string;id?:string;sourceRef?:string}[];
}
export declare function prepareProjectContinuation(
 request:ContinuationRequest,port:ContinuationSourcePort):Promise<ContinuationProjection>;
export declare function revalidateProjectContinuation(
 previous:ContinuationProjection,request:ContinuationRequest,port:ContinuationSourcePort
):Promise<ContinuationRecheck>;
