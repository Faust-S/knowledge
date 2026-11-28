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


export type WorkspaceMethodAlternativeComparison = Omit<WorkspaceMethodRevisionComparison,'schema'|'state'|'projectId'> & Readonly<{
  schema:'IWXA_T2_WORKSPACE_METHOD_ALTERNATIVE_COMPARISON_V1';
  state:'INDEPENDENT_IDENTITIES'|'CHANGES_PROPOSED';
  beforeProjectId:string;
  afterProjectId:string;
  independentIdentities:true;
  comparisonBasis:'EXACT_RELATED_ALTERNATIVE_REVISIONS';
  beforeSelection:WorkspaceMethodRevisionSelection;
  afterSelection:WorkspaceMethodRevisionSelection;
  origin:WorkspaceMethodRevisionSelection & Readonly<{workspaceId:string;projectId:string}>;
  beforeFromOrigin:unknown;
  afterFromOrigin:unknown;
  currentHeadVerified:false;
  mergeAuthorized:false;
}>;
export function compareWorkspaceMethodAlternatives(input:{
  owner:WorkspaceMethodHistoryPort;workspaceId:string;
  before:WorkspaceMethodRevisionSelection & Readonly<{projectId:string}>;
  after:WorkspaceMethodRevisionSelection & Readonly<{projectId:string}>;
}):Promise<WorkspaceMethodAlternativeComparison>;


export type WorkspaceMethodCreationComparison = WorkspaceMethodRevisionComparison & Readonly<{
  comparisonBasis:'ORIGINAL_CREATION_TO_SELECTED_CURRENT';
  beforeSelection:WorkspaceMethodRevisionSelection;
  afterSelection:WorkspaceMethodRevisionSelection;
  currentHeadVerified:true;
  stageDetails:readonly Readonly<{stepId:string;
    before:WorkspaceMethodDraft['steps'][number]|null;after:WorkspaceMethodDraft['steps'][number]|null}>[];
}>;
export function compareWorkspaceMethodWithCreation(input:{
  owner:WorkspaceMethodHistoryPort & {load:(kind:string,workspaceId:string,id:string)=>Promise<unknown>};
  workspaceId:string;projectId:string;expected:WorkspaceMethodRevisionSelection;
}):Promise<WorkspaceMethodCreationComparison>;
