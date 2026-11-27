import type { WorkspaceMethodRevisionSelection,WorkspaceMethodSourceRef } from '../modules/base/owners/project-process-method-comparison.mjs';
import type { WorkspaceMethodActor } from '../modules/base/features/workspace/workspace-project-method.mjs';
export type WorkspaceMethodReaderSelection = Readonly<{workspaceId:string;projectId:string;expected:WorkspaceMethodRevisionSelection}>;
export type WorkspaceMethodPublishedResultRef = Readonly<{workspace_id:string;object_id:string;schema_id:'iwxa.agent.accepted-result';revision:number}>;
export type WorkspaceMethodResultSelection = Readonly<{stepId:string;reference:WorkspaceMethodPublishedResultRef}>;
export type WorkspaceMethodPersonalResultSelection = Readonly<{stepId:string;taskId:string}>;
export type WorkspaceMethodStageRequest = WorkspaceMethodReaderSelection & Readonly<{stepId:string;resultSelections?:readonly WorkspaceMethodResultSelection[];
  personalResultSelections?:readonly WorkspaceMethodPersonalResultSelection[]}>;
export type WorkspaceMethodOverviewStage = Readonly<{
  stepId:string;name:string;actor:WorkspaceMethodActor;workRef:WorkspaceMethodSourceRef;
  state:'MATERIAL_REVIEW_REQUIRED'|'PREDECESSOR_RESULTS_REQUIRED'|'INPUT_REFERENCES_VERIFIED';
  inputBasisDigest:string|null;directPredecessorStepIds:readonly string[];prerequisiteCount:number;materialIssues:readonly string[];
}>;
export type WorkspaceMethodInputOverview = Readonly<{
  schema:'IWXA_T2_WORKSPACE_METHOD_INPUT_OVERVIEW_V1';workspaceId:string;projectId:string;
  projectRef:WorkspaceMethodSourceRef;stages:readonly WorkspaceMethodOverviewStage[];
  materials:readonly Readonly<{object_id:string;revision:number;state:'CURRENT'|'CHANGED'|'UNAVAILABLE';current:unknown}>[];
  counts:Readonly<{total:number;inputReferencesVerified:number;materialReviewRequired:number;predecessorResultsRequired:number;rootInputsVerified:number}>;
  completeMethodCurrentVerified:true;atomicSnapshot:false;writeAuthorized:false;executionAuthority:false;
  resultReuseProven:false;executionStatusObserved:false;
}>;
export type WorkspaceMethodStageInspection = Readonly<{
  state:string;stageInput:Readonly<{state:string;basis:Readonly<{workspaceId:string;projectId:string;stepId:string;stageRef:WorkspaceMethodSourceRef}>;
    inputBasisDigest:string|null}>;
  results:readonly Readonly<{stepId:string;state:string;reference:WorkspaceMethodPublishedResultRef|null;
    accepted:Readonly<{taskId:string;resultId:string}>|null}>[];
  executionAuthority:false;writeAuthorized:false;resultReuseProven:false;exactInputBindingProven:false;atomicSnapshot:false;
}>;
export type WorkspaceMethodHandoffPreview = Readonly<{
  schema:'IWXA_T2_WORKSPACE_METHOD_STAGE_HANDOFF_PREVIEW_V1';state:string;inspection:WorkspaceMethodStageInspection;
  candidateDigest:string|null;requiredOriginalOwnerChecks:readonly string[];
  subjectKind?:'PERSONAL'|'CORP';
  personalResultSelections?:readonly WorkspaceMethodPersonalResultSelection[];
  personalResults?:readonly Readonly<{stepId:string;canonicalWorkRef:WorkspaceMethodSourceRef;
    acceptedTask:Readonly<{taskId:string;resultId:string;reviewId:string;acceptedDigest:string;acceptedSummarySha256:string;candidateDigest:string;agentWorkspaceId:string}>}>[];
  materialEvidenceRequested?:true;materialEvidence?:WorkspaceMethodMaterialEvidence|null;
  signedTaskIssued:false;taskCreated:false;contentBindingProven:false;exactInputBindingProven:false;
  dispatchAuthorized:false;executionAuthority:false;writeAuthorized:false;resultReuseProven:false;
}>;
export type WorkspaceMethodNativeInspection = WorkspaceMethodStageInspection & Readonly<{
  nativeContinuationState:string;targetWorkBound:false;dispatchAuthorized:false;
  nativeContinuation:Readonly<{predecessorStepId:string;
    preview:Readonly<{status:'AVAILABLE'|'RECOVER_ONLY'|'OPERATION_IN_PROGRESS';operationId:string;recipientId:string;reference:WorkspaceMethodPublishedResultRef}>;
    receipt:Readonly<{status:'OWNER_READBACK_CONFIRMED'|'OUTCOME_UNKNOWN';operationId:string;resultRef?:string}>|null}>|null;
}>;
export type WorkspaceMethodMaterialEvidence=Readonly<{
  schema:'IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1';
  state:'MATERIAL_REVIEW_REQUIRED'|'VISIBLE_MATERIAL_CONTENT_OBSERVED';
  stageInput:WorkspaceMethodStageInspection['stageInput'];
  materialEvidenceDigest:string|null;
  observation:Readonly<{materials:readonly unknown[];counts:Readonly<{materials:number;assets:number;assetBytes:number;canonicalBytes:number}>}>|null;
  atomicSnapshot:false;allAssetsProven:false;contentBindingProven:false;exactInputBindingProven:false;
  writeAuthorized:false;executionAuthority:false;resultReuseProven:false;dispatchAuthorized:false;
}>;
export type WorkspaceMethodPersonalDraftReceipt=Readonly<{
  state:'DRAFT_CONFIRMED'|'DRAFT_ALREADY_PRESENT'|'DRAFT_OCCUPIED'|'DRAFT_CHANGED'|'USER_CANCELLED'|'OUTCOME_UNKNOWN';
  candidateDigest:string;workspaceId:string;projectId:string;stepId:string;agentWorkspaceId:string;draftDigest:string|null;
  draftSaved:boolean;taskCreated:false;executionPerformed:false;modelInvoked:false;allAssetsProven:false;exactInputBindingProven:false;
}>;
export type WorkspaceMethodPersonalTaskInspection=Readonly<{
  state:'ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED';workspaceId:string;projectId:string;stepId:string;
  candidateDigest:string;agentWorkspaceId:string;taskId:string;resultId:string;taskDigest:string;
  reviewId:string;acceptedDigest:string;acceptedSummarySha256:string;snapshotId:string;snapshotDigest:string;
  projectionDigest:string;bundleDigest:string;nativeSystemSourceCount:number;nativeSystemSourcesDigest:string;
  declaredDraftInputsVerified:true;allAssetsProven:false;
  exactInputBindingProven:false;workCompleted:false;resultReuseProven:false;executionAuthority:false;writeAuthorized:false;
}>;
export type WorkspaceMethodRecoveredPersonalTask=WorkspaceMethodPersonalTaskInspection & Readonly<{
  recoveredFromOriginalTask:true;canonicalWorkRef:WorkspaceMethodSourceRef;
  personalResultSelections:readonly WorkspaceMethodPersonalResultSelection[];
}>;
export interface WorkspaceMethodStageReader {
  overview(input:WorkspaceMethodReaderSelection):Promise<WorkspaceMethodInputOverview>;
  inspect(input:WorkspaceMethodStageRequest):Promise<WorkspaceMethodStageInspection>;
  previewHandoff(input:WorkspaceMethodStageRequest&Readonly<{includeMaterialEvidence?:boolean}>):Promise<WorkspaceMethodHandoffPreview>;
  inspectMaterialEvidence?(input:WorkspaceMethodStageRequest):Promise<WorkspaceMethodMaterialEvidence>;
  createPersonalDraft?(input:WorkspaceMethodStageRequest&Readonly<{expectedCandidateDigest:string}>):Promise<WorkspaceMethodPersonalDraftReceipt>;
  recoverPersonalDraft?(input:WorkspaceMethodStageRequest&Readonly<{expectedCandidateDigest:string}>):Promise<WorkspaceMethodPersonalDraftReceipt>;
  inspectPersonalTask?(input:WorkspaceMethodStageRequest&Readonly<{expectedCandidateDigest:string;taskId:string}>):Promise<WorkspaceMethodPersonalTaskInspection>;
  recoverPersonalTask?(input:WorkspaceMethodReaderSelection&Readonly<{stepId:string;taskId:string}>):Promise<WorkspaceMethodRecoveredPersonalTask>;
  previewContinuation(input:WorkspaceMethodStageRequest&Readonly<{predecessorStepId:string}>):Promise<WorkspaceMethodNativeInspection>;
  recoverContinuation(input:WorkspaceMethodStageRequest&Readonly<{predecessorStepId:string}>):Promise<WorkspaceMethodNativeInspection>;
}
export function createTrustedWorkspaceMethodStageReader(input:{
  kernel:unknown;accessForRead:(operation:string)=>unknown;currentWorkspace:unknown;
  sourceOwner:unknown;originalAgentResultOwner?:unknown;nativeContinuation?:unknown;nativeRecipientId?:string|null;
  personalTaskOwner?:unknown;personalComposer?:unknown;confirmPersonalDraft?:(preview:unknown)=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):WorkspaceMethodStageReader;
