import type { WorkspaceMethodDraft } from '../features/workspace/workspace-project-method.mjs';
export type WorkspaceMethodSourceRef = Readonly<{family:string;objectId:string;recordId:string;revision:number}>;
export type WorkspaceMethodRevisionReadback = Readonly<{
  workspaceId:string;
  draft:WorkspaceMethodDraft;
  projectRef:WorkspaceMethodSourceRef;
  workRefs:readonly WorkspaceMethodSourceRef[];
  revisionSetVerified:true;
  atomicSnapshot?:false;
  historicalRead?:boolean;
  currentHeadVerified?:boolean;
  writeAuthorized?:false;
  executionAuthority?:false;
}>;
export type WorkspaceMethodRevisionComparison = Readonly<{
  schema:'IWXA_T2_WORKSPACE_METHOD_REVISION_COMPARISON_V1';
  state:'UNCHANGED'|'SOURCE_REBIND_ONLY'|'CHANGES_PROPOSED';
  workspaceId:string;
  projectId:string;
  projectChanges:readonly Readonly<{field:string;before:unknown;after:unknown}>[];
  projectCompositionChanged:boolean;
  displayOrderChanged:boolean;
  projectIntentChanged:boolean;
  materialChanges:readonly Readonly<{object_id:string;beforeRevision:number|null;afterRevision:number|null;operation:'ADDED'|'REMOVED'|'REVISED'}>[];
  unassignedMaterialChanges:readonly Readonly<{object_id:string;beforeRevision:number|null;afterRevision:number|null;operation:'ADDED'|'REMOVED'|'REVISED'}>[];
  stepChanges:readonly Readonly<{stepId:string;operation:'ADDED'|'REMOVED'|'CHANGED'|'UNCHANGED';changedFields:readonly string[];beforeIndex:number|null;afterIndex:number|null;reviewRequired:boolean}>[];
  changedStepIds:readonly string[];
  dependencyChanges:readonly unknown[];
  materialImpactStepIds:readonly string[];
  affectedStepIds:readonly string[];
  sourceRevisionSetChanged:boolean;
  sourceRevisionChanges:Readonly<{project:Readonly<{before:WorkspaceMethodSourceRef;after:WorkspaceMethodSourceRef;changed:boolean}>;works:readonly unknown[]}>;
  reviewRequired:boolean;
  atomicSnapshot:false;
  writeAuthorized:false;
  executionAuthority:false;
  resultReuseProven:false;
}>;
export function compareWorkspaceMethodRevisions(input:{before:WorkspaceMethodRevisionReadback;after:WorkspaceMethodRevisionReadback}):WorkspaceMethodRevisionComparison;

export type WorkspaceMethodRevisionSelection = Readonly<{
  projectRef:WorkspaceMethodSourceRef;
  workRefs:readonly WorkspaceMethodSourceRef[];
}>;
export type WorkspaceMethodHistoryPort = {
  history?: (kind:string,workspaceId:string,id:string)=>Promise<unknown>;
  historyThrough?: (kind:string,workspaceId:string,id:string,recordId:string,revision:number)=>Promise<unknown>;
};
export type WorkspaceMethodSelectionComparison = WorkspaceMethodRevisionComparison & Readonly<{
  comparisonBasis:'EXACT_HISTORICAL_REVISIONS';
  beforeSelection:WorkspaceMethodRevisionSelection;
  afterSelection:WorkspaceMethodRevisionSelection;
  currentHeadVerified:false;
}>;
export function compareWorkspaceMethodSelections(input:{
  owner:WorkspaceMethodHistoryPort;workspaceId:string;projectId:string;
  before:WorkspaceMethodRevisionSelection;after:WorkspaceMethodRevisionSelection;
}):Promise<WorkspaceMethodSelectionComparison>;
