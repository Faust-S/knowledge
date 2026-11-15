import type { KernelFacade, CurrentWorkspaceFacade } from "../workspace-contract";

export interface T3SignedActivityAccess {
  /** Trusted native owner may deliver its selected context asynchronously. */
  currentContext(): unknown | Promise<unknown>;
  actionFor(operation: string): string | Promise<string>;
  operationDigest(input: unknown): string | Promise<string>;
  authorize(request: unknown): unknown | Promise<unknown>;
  verifyDecisionBinding(request: unknown, decision: unknown): boolean | Promise<boolean>;
}
export interface T3ActivityReadOptions {
  bindings: {
    objects: { schema_id: string; schema_version: string; semantic_kind: string;
      links?: { field: string; relation: string; many?: boolean }[] }[];
    events: { event_type: string; semantic_kind: string }[];
    relations?: { kind: string; relation: string }[];
  };
  workspace_id?: string;
  max_objects?: number;
  max_events?: number;
}
export interface T3ActivityProjection {
  workspace_id: string;
  nodes: unknown[];
  events: unknown[];
  relations: unknown[];
  unresolved: unknown[];
  unmapped: { object_ids: string[]; event_ids: string[]; relation_ids: string[] };
}
export function readActivityFromWorkspaceContext(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  options: T3ActivityReadOptions & { signedAccess?: T3SignedActivityAccess | null },
): Promise<T3ActivityProjection>;

/** The existing signed D1 binding for the original selected T2 Kernel.
 * All requested methods remain implemented by the inherited Runtime 1.3.0. */
export function createSubjectKernelBinding(input: {
  kernel: KernelFacade;
  access: T3SignedActivityAccess;
  clock?: () => number;
  /** D3 original owner check, synchronously after D1 JIT and before Graph commit. */
  commitObjectGraphPrecondition?: (query: Readonly<{
    command: unknown; context: unknown; operationDigest: string;
  }>) => boolean;
  /** Original Host lifecycle check, including after signed Access JIT. */
  isHostActive?: () => boolean;
  /** Notification immediately before the ORIGINAL Graph call (no retry). */
  onCommitObjectGraphDispatch?: () => void;
}): Pick<KernelFacade,
  "createWorkspace" | "getWorkspace" | "getObject" | "listObjects" |
  "putObject" | "deleteObject" | "putRelation" | "deleteRelation" |
  "listAssets" | "getAsset" | "putAsset" | "deleteAsset" |
  "listEventsSince" | "softDeleteWorkspace" | "restoreWorkspace" |
  "exportPreview" | "exportPackage" | "confirmExport" |
  "importPreview" | "importCommit" | "importCancel" |
  "purgePreview" | "purgeCommit" | "purgeCancel" | "commitObjectGraph">;

/** D5 explicit local-model suggestion. The original selected ModuleContext.kernel
 * performs every write/readback; a model draft never becomes accepted evidence. */
export interface T3LocalInferenceDraftInput {
  expected_workspace_id: string;
  model_id: string;
  engine: string;
  output: string;
}
export interface T3LocalInferenceDraftReceipt {
  workspace_id: string;
  object_id: string;
  revision: number;
  event_id: string;
  status: "DRAFT_UNTRUSTED";
  readback: true;
}
export function saveLocalInferenceDraft(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  input: T3LocalInferenceDraftInput,
): Promise<T3LocalInferenceDraftReceipt>;
export function listLocalInferenceDrafts(
  context: { kernel: KernelFacade; currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe"> },
  input: { expected_workspace_id: string },
): Promise<Array<{ workspace_id: string; object_id: string; revision: number;
  status: string; model_id: string; text: string }>>;

/** Read one retained untrusted draft after a cold browser restart through the original Kernel. */
export function getLocalInferenceDraft(
  context: {kernel: KernelFacade;currentWorkspace: Pick<CurrentWorkspaceFacade, "get" | "subscribe">},
  input: {expected_workspace_id: string;object_id: string},
): Promise<{workspace_id:string;object_id:string;revision:number;
  status:"DRAFT_UNTRUSTED";model_id:string;engine:string;text:string;readback:true}>;

/** Add this declared schema to the ORIGINAL service passport before saving.
 * Declaring it does not grant any permission to use the schema. */
export const LOCAL_INFERENCE_DRAFT_SCHEMA: "iwxa.local-inference.draft";
export const LOCAL_INFERENCE_DRAFT_DECLARATION: {
  readonly schema_version: "1.0.0";
  readonly preserve_unknown: false;
  readonly json_schema: Record<string, unknown>;
  readonly embedded: Record<string, never>;
};

/** D3. Trusted owner adapter, NOT a second Reconciliation, signed issuer, UI
 * callback or Kernel writer. The original recipient owner must be injected
 * by the installed Host and supply actual signed policy/JIT review. */
export interface T3OriginalReconcilerOwner {
  recipientId:string;
  receive(bytes:Uint8Array):unknown|Promise<unknown>;
  preview(packageSha256:string):unknown|Promise<unknown>;
  accept(packageSha256:string,decision:{operationId:string;previewDigest:string;decisionBy:string}):unknown|Promise<unknown>;
  reject(packageSha256:string,decision:{operationId:string;previewDigest:string;decisionBy:string;reason:string}):unknown|Promise<unknown>;
  receipt(operationId:string):unknown|Promise<unknown>;
  inspectApplicationProjection(input:{acceptanceId:string;revisionIds:string[];target:Record<string,unknown>}):unknown|Promise<unknown>;
}
export function createTrustedReconciliationAdmission(options:{
  reconciler:T3OriginalReconcilerOwner;
  currentContext:()=>unknown|Promise<unknown>;
  recipientForContext:(context:unknown)=>string|Promise<string>;
  confirmHumanReview:(request:unknown)=>boolean|Promise<boolean>;
  /** Original Host lifecycle; retained D3 ports are invalid after logout. */
  isHostActive:()=>boolean;
}):Readonly<{
  receive(bytes:Uint8Array):Promise<unknown>;
  preview(packageSha256:string):Promise<unknown>;
  /** Original durable recipient receipt after a lost native decision ACK. */
  receipt(operationId:string,packageSha256:string):Promise<unknown>;
  accept(input:{packageSha256:string;previewDigest:string;operationId:string;decisionBy:string}):Promise<unknown>;
  reject(input:{packageSha256:string;previewDigest:string;operationId:string;decisionBy:string;reason:string}):Promise<unknown>;
  inspectAcceptedApplication(input:{acceptanceId:string;revisionIds:string[];target:Record<string,unknown>}):Promise<unknown>;
}>;

/** D3. Optional trusted recipient-host APPLY only. The owning product must
 * provide the original sealed application Host binding and a domain-native
 * graph command; this does NOT implement a new Reconciliation/Result engine. */
export function createTrustedReconciliationKernelApply(options:{
  admission:{inspectAcceptedApplication(input:{acceptanceId:string;revisionIds:string[];target:Record<string,unknown>}):Promise<unknown>};
  /** ORIGINAL inherited T2 KernelFacade, held only inside the trusted Host. */
  kernel:KernelFacade;
  /** The existing signed D1 owner. No raw Kernel path is accepted. */
  access:T3SignedActivityAccess;
  stageFromOriginalOwner:(query:unknown)=>unknown|Promise<unknown>;
  confirmSeparateApply:(query:unknown)=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):Readonly<{
  applyAccepted(input:{acceptanceId:string;revisionIds:string[];target:Record<string,unknown>}):Promise<unknown>;
  /** Read the original signed Kernel history after uncertain Apply. No replay. */
  recoverApplied(input:{acceptanceId:string;revisionIds:string[];target:Record<string,unknown>}):Promise<unknown>;
}>;

/** D6: a trusted already-installed product owner handles the selected original
 * Result/Project/Task/Document object, its own durable operation receipt and
 * readback. This is not a new transport, Task Engine or recipient Store. */
export interface T3NativeContinuationReference {
  workspace_id:string;object_id:string;schema_id:string;revision:number;
}
export interface T3NativeContinuationOwner {
  readonly recipientId:string;
  inspect(input:{reference:T3NativeContinuationReference;recipientId:string}):
    unknown|Promise<unknown>;
  receive(input:{operationId:string;recipientId:string;
    reference:T3NativeContinuationReference;object:unknown}):unknown|Promise<unknown>;
  receipt(operationId:string):unknown|Promise<unknown>;
  readback(operationId:string):unknown|Promise<unknown>;
}
/** Optional original domain owner. For CehoVod it MUST independently read
 * saved Kernel Result rows and run the canonical verifyStoredFinalPlanFact;
 * an n8n/native owner receipt alone cannot assert this verification. */
export interface T3OriginalDomainResultOwner {
  ownerId:string;
  resultType:string;
  orderRef:string;
  /** REQUIRED for CehoVod plan-fact-analysis. From the trusted original
   * CehoVod production-execution object, NOT a pending Project/Process
   * WorkRef and not an editable renderer field. */
  executionRef?:string;
  verifySaved(input:{resultRef:string;operationId:string;recipientId:string;
    orderRef:string;executionRef?:string;
    sourceReference:T3NativeContinuationReference}):unknown|Promise<unknown>;
}
export interface T3NativeContinuationStatus {
  status:"AVAILABLE"|"SOURCE_ACCOUNT_REQUIRED"|"RECOVER_ONLY"|"OPERATION_IN_PROGRESS"|"USER_CANCELLED"|"OUTCOME_UNKNOWN"|"OWNER_READBACK_CONFIRMED"|"DOMAIN_RESULT_UNVERIFIED"|"DOMAIN_RESULT_READBACK_CONFIRMED";
  operationId?:string;
  recipientId?:string;
  resultRef?:string;
  resultOwnerId?:string;
  orderRef?:string;
  executionRef?:string;
  resultRevision?:number;
  owner_action_confirmed?:boolean;
  domain_result_confirmed?:boolean;
  can_retry?:boolean;
  reference?:T3NativeContinuationReference;
  reason?:string;
}
export function createTrustedNativeContinuation(options:{
  kernel:KernelFacade;
  accessForRead:(operation:string)=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  currentWorkspace:Pick<CurrentWorkspaceFacade,"get"|"subscribe">;
  nativeOwner:T3NativeContinuationOwner;
  /** Optional STRICT second owner verification, provided by the trusted Host,
   * never by a browser field or a transport ACK. */
  resultOwner?:T3OriginalDomainResultOwner|null;
  /** Trusted Host uses the ORIGINAL external-process-link.prepareContinuation
   * immediately before dispatch, after consent. Its current signed reference
   * must equal the selected T2 revision. Offline cached read is insufficient;
   * original native owner still enforces its own external revision on receive.
   * Other native continuations can omit this port. */
  sourceCurrent?:(reference:T3NativeContinuationReference)=>
    T3NativeContinuationReference|Promise<T3NativeContinuationReference>;
  confirmHuman:(input:{recipientId:string;operationId:string;
    reference:T3NativeContinuationReference})=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):Readonly<{
  preview(input:T3NativeContinuationReference):Promise<T3NativeContinuationStatus>;
  continueSelected(input:T3NativeContinuationReference):Promise<T3NativeContinuationStatus>;
  recover(input:T3NativeContinuationReference):Promise<T3NativeContinuationStatus>;
}>;

/** D7: existing installed native age owner. Key custody, envelope verification,
 * and the authenticated current recipient stay in the original product.
 * A receiver-only owner supports recovery BEFORE Workspace creation. */
export interface T3OriginalAgeOwner {
  /** Actual size supported by installed native age, not browser Exchange.
   * Defaults to historical 32 MiB when absent; higher requires native proof. */
  readonly maxArchiveBytes?:number;
  /** The existing pinned split-origin signed Kernel realm returns its own
   * selected Workspace identity. The UI never supplies a subject or signer;
   * kernel.getWorkspace itself still executes ORIGINAL D1 JIT on every read.
   * This optional callback is compiled into the trusted installed AppShell. */
  trustedSelectedWorkspace?():{
    kind:"CORP"|"PERSONAL";workspace_id:string;resource:string;
    organization_id?:string|null;
  }|Promise<{
    kind:"CORP"|"PERSONAL";workspace_id:string;resource:string;
    organization_id?:string|null;
  }|null>|null;
  /** Original installed identity from key custody, never a .iwxa or UI field.
   * bindingEpoch must change when the user/recipient/key authority changes. */
  currentRecipient?():{recipientId:string;bindingEpoch:string}|
    Promise<{recipientId:string;bindingEpoch:string}>;
  /** Required only for Workspace-signed encryption, not first restore. */
  prepareSeal?(input:{workspaceId:string;archiveSha256:string;archiveSize:number}):
    {status:string;format:string;recipientIds:string[]}|
    Promise<{status:string;format:string;recipientIds:string[]}>;
  seal?(input:{archiveBytes:Uint8Array;archiveSha256:string;recipientIds:string[];
    workspaceId:string}):unknown|Promise<unknown>;
  /** Existing native verifier. Original signed mode passes selectedWorkspaceId;
   * clean-install native mode passes authenticated recipientId instead. */
  open?(input:{ciphertext:Uint8Array;selectedWorkspaceId?:string;
    recipientId?:string}):unknown|Promise<unknown>;
  /** Native original age owner performs authenticated decrypt and calls
   * ORIGINAL Kernel.importPreview without returning any plaintext to WebView.
   * Returned token must be usable by that SAME original Kernel.importCommit. */
  previewInOriginalKernel?(input:{ciphertext:Uint8Array;recipientId:string}):
    unknown|Promise<unknown>;
  /** Must be bound to the SAME ORIGINAL Kernel which made the preview.
   * Its own signed JIT policy and existing importCommit are authoritative. */
  commitInOriginalKernel?(input:Parameters<KernelFacade["importCommit"]>[0]&
    {recipientId:string}):ReturnType<KernelFacade["importCommit"]>;
  cancelInOriginalKernel?(input:{preview_token:string;recipientId:string}):
    boolean|Promise<boolean>;
  /** Optional installed ORIGINAL recipient's independent, read-only recovery.
   * Must resolve its own persisted Kernel receipt and verify stored data with
   * ORIGINAL signed Kernel reads, not echo a UI receipt or replay importCommit.
   * Works after cold launch WITHOUT Control's volatile preview token claims.
   * Confirmed responses must also attest the EXACT preview_token, because
   * multiple genuine imports can have identical package/semantic digests. */
  readbackInOriginalKernel?(input:{
    preview_token:string;package_digest:string;semantic_digest:string;
    mode:"full"|"selective"|"merge"|"new-workspace"|"cancel";
    recipientId:string;
  }):unknown|Promise<unknown>;
}
export interface T3AgeProtectionReceipt {
  status:"AGE_PROTECTED_DOWNLOAD_READY";format:"age-encryption.org/v1";
  archiveSha256:string;recipientIds:readonly string[];ciphertext:Uint8Array;
  savedToDevice:false;recipientImported:false;
}
export interface T3AgeOpenReceipt {
  status:"AGE_OPENED_NOT_IMPORTED";recipientId:string;archiveSha256:string;
  archiveBytes:Uint8Array;kernelPreviewed:false;accepted:false;
}
export function createTrustedAgeExchange(options:{
  /** Original D1 selected Workspace access, required only for encryption
   * and for legacy age owners without native currentRecipient. */
  kernel?:KernelFacade;
  accessForRead?:(operation:string)=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  ageOwner:T3OriginalAgeOwner;
  confirmRecipients?:(input:{workspaceId:string;recipientIds:string[];
    archiveSha256:string;archiveSize:number})=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):Readonly<{
  readonly canSeal:boolean;
  readonly canOpen:boolean;
  readonly maxArchiveBytes:number;
  readonly maxCiphertextBytes:number;
  seal(input:{workspace_id:string;archiveBytes:Uint8Array}):
    Promise<T3AgeProtectionReceipt>;
  open(input:{ciphertext:Uint8Array}):Promise<T3AgeOpenReceipt>;
  /** Source ZIP never crosses the installed product's WebView boundary. */
  readonly canNativeKernelPreview:boolean;
  /** Only true for a native owner that independently reads its original
   * Kernel Store and authentic persisted receipt. Does not imply G4 PASS. */
  readonly canNativeKernelReadback:boolean;
  previewInOriginalKernel(input:{ciphertext:Uint8Array}):Promise<{
    status:"KERNEL_PREVIEW_READY";recipientId:string;archiveSha256:string;
    handle:Awaited<ReturnType<KernelFacade["importPreview"]>>;
  }>;
  commitInOriginalKernel(input:Parameters<KernelFacade["importCommit"]>[0]):
    ReturnType<KernelFacade["importCommit"]>;
  cancelInOriginalKernel(input:{preview_token:string}):
    Promise<boolean>;
  readbackInOriginalKernel(input:{
    preview_token:string;package_digest:string;semantic_digest:string;
    mode:"full"|"selective"|"merge"|"new-workspace"|"cancel";
  }):Promise<{
    status:"OUTCOME_UNKNOWN"|"OWNER_READBACK_CONFIRMED";
    recipientId?:string;
    receipt?:Awaited<ReturnType<KernelFacade["importCommit"]>>;
  }>;
}>;

/** D7: existing signed Publisher licence/status owner inside an installed
 * product. Original owner provides pinned publisher trust, durable receipts,
 * monotonic STATUS floors, tombstones and cold-restart readback. This port
 * neither issues credentials nor turns entitlements into data access rights. */
export type T3PublisherHandoffKind = "LICENSE"|"STATUS";
/** Signed IWXA_T3_LICENSE_STATUS/2 permits multiple entries per holder and
 * full snapshots with ZERO entries. Licence renewal uses original lineages. */
export type T3PublisherStatusMode =
  "FULL_HOLDER_SNAPSHOT"|"SELECTIVE_DELTA"|"TOMBSTONE_EVENT";
export type T3PublisherStatusState =
  "ACTIVE"|"SUSPENDED"|"REVOKED"|"SUPERSEDED";
export interface T3PublisherStatusScope {
  readonly mode:T3PublisherStatusMode;
  readonly lineageId:string|null;
  readonly licenseIds:readonly string[];
}
export interface T3PublisherStatusEntry {
  readonly licenseId:string;readonly lineageId:string;
  readonly state:T3PublisherStatusState;
  readonly effectiveAt:string;readonly evidenceRef:string;
}
export interface T3OriginalPublisherHolder {
  /** Trusted original installed holder identity, available BEFORE a Workspace
   * exists. The owner must verify the OS/user holder itself and rotate
   * bindingEpoch whenever its active subject or authentication changes.
   * Never derive this identity from a package, form or Publisher licence. */
  currentSubject?():{
    holderId:string;recipientId:string;
    subjectType:"PERSON"|"ORGANIZATION";bindingEpoch:string;
  }|Promise<{
    holderId:string;recipientId:string;
    subjectType:"PERSON"|"ORGANIZATION";bindingEpoch:string;
  }>;
  /** Legacy signed D1 Workspace-bound owner. This route remains available
   * for existing consumers, but MUST NOT be required for first licence. */
  subjectForContext?(context:unknown):
    {holderId:string;recipientId:string;subjectType:"PERSON"|"ORGANIZATION"}|
    Promise<{holderId:string;recipientId:string;subjectType:"PERSON"|"ORGANIZATION"}>;
  inspect(input:{kind:T3PublisherHandoffKind;archiveBytes:Uint8Array;
    packageSha256:string;context:unknown;subject:unknown}):unknown|Promise<unknown>;
  apply(input:{kind:T3PublisherHandoffKind;archiveBytes:Uint8Array;
    operationId:string;packageSha256:string;previewDigest:string;
    subject:unknown;context:unknown}):unknown|Promise<unknown>;
  receipt(input:{kind:T3PublisherHandoffKind;operationId:string;
    packageSha256:string;holderId:string;recipientId:string}):unknown|Promise<unknown>;
  statusReadback(input:{kind:T3PublisherHandoffKind;operationId:string;
    packageSha256:string;holderId:string;recipientId:string}):unknown|Promise<unknown>;
}
export interface T3PublisherHandoffPreview {
  status:"VERIFIED_PENDING_CONSENT"|"RECOVER_ONLY";
  kind:T3PublisherHandoffKind;packageSha256:string;previewDigest:string;
  holderId:string;recipientId:string;operationId:string;
  issuerAuthorityId:string;publisherId:string;licenseId:string|null;
  sequence:number|null;
  statusScope:T3PublisherStatusScope|null;
  statusEntries:readonly T3PublisherStatusEntry[]|null;
  statusPayloadDigest:string|null;
  dataAccessAuthorized:false;entitlementActivated:false;
}
export interface T3PublisherHandoffResult {
  status:"USER_CANCELLED"|"OUTCOME_UNKNOWN"|"OPERATION_IN_PROGRESS"|
    "ORIGINAL_HOLDER_READBACK_CONFIRMED";
  kind:T3PublisherHandoffKind;operationId?:string;
  packageSha256?:string;holderId?:string;issuerAuthorityId?:string;
  licenseId?:string|null;sequence?:number|null;
  statusScope?:T3PublisherStatusScope|null;
  statusEntries?:readonly T3PublisherStatusEntry[]|null;
  statusPayloadDigest?:string|null;
  entitlementActivated?:false;dataAccessAuthorized?:false;
}
export function createTrustedPublisherHandoff(options:{
  /** Needed only for legacy subjectForContext; no T2 data grant is required
   * when trusted nativeHolder.currentSubject identifies the installed user. */
  kernel?:KernelFacade;
  accessForRead?:(operation:string)=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  nativeHolder:T3OriginalPublisherHolder;
  confirmHuman:(preview:T3PublisherHandoffPreview)=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):Readonly<{
  preview(input:{kind:T3PublisherHandoffKind;archiveBytes:Uint8Array}):
    Promise<T3PublisherHandoffPreview>;
  admit(input:{kind:T3PublisherHandoffKind;archiveBytes:Uint8Array;
    previewDigest:string}):Promise<T3PublisherHandoffResult>;
  recover(input:{kind:T3PublisherHandoffKind;archiveBytes:Uint8Array}):
    Promise<T3PublisherHandoffResult>;
}>;

/** Agent 0.6: reference an external ERP/BPM/workflow source without transferring
 * ERP ownership, credentials, process execution, or making reported steps observed.
 * The original T2 service passport must declare the schema and authorize writes.
 * A trusted Host supplies the existing original signed D1 owner + Kernel. */
export const EXTERNAL_PROCESS_LINK_SCHEMA: "iwxa.agent06.external-process-link";
export const EXTERNAL_PROCESS_LINK_EVENT: "t3.external-process.record.reported";
/** Normal original T2 Host service passport; not an IAM grant. */
export const EXTERNAL_PROCESS_LINK_PASSPORT: Readonly<{
  service_id:"iwxa.agent06.external-process";
  service_version:"1.0.0";
  base_path:"/workspace/external-process/";
  supported_levels:readonly ["T1","T2"];
  input_object_types:readonly [];
  output_object_types:readonly ["iwxa.agent06.external-process-link"];
  schemas:Record<string,unknown>;
  permissions:Record<string,unknown>;
}>;
export const EXTERNAL_PROCESS_LINK_DECLARATION: Readonly<{
  schema_version:"1.0.0";preserve_unknown:false;
  json_schema:Record<string,unknown>;embedded:Record<string,never>;
}>;
export interface T3ExternalRecordReference {
  expected_workspace_id:string;record_kind:string;record_id:string;
}
export interface T3ExternalRecordOwner {
  readonly ownerId:string;
  /** Exact revision/digest/owner receipt verified by the external owner; no raw
   * customer data or credentials are persisted by the T3 link. */
  /** Optional until an external account is available. readSaved() needs
   * only the trusted ownerId; online link/refresh/recover still need readExact. */
  readExact?(input:{record_kind:string;record_id:string}):unknown|Promise<unknown>;
}
export interface T3ExternalLinkStatus {
  status:"LINK_PERSISTED"|"ALREADY_LINKED"|"NOT_FOUND"|"REVISION_CONFLICT"|
    "OUTCOME_UNKNOWN"|"USER_CANCELLED";
  workspace_id?:string;object_id?:string;revision?:number;
  event_id?:string;source_revision?:string;epistemic_status?:"reported";
  cause_code?:string;saved_revision?:number;
}
export interface T3ExternalSavedLink {
  status:"SAVED_UNVERIFIED"|"NOT_FOUND";
  workspace_id:string;object_id:string;revision?:number;
  source_owner?:string;record_kind?:string;record_id?:string;
  source_revision?:string;source_state?:string;source_digest?:string;
  epistemic_status?:"reported";owner_current:false;can_execute:false;
}
/** Read-only, signed original Kernel + exact external owner comparison.
 * Not a D6 source-current ticket, authorization or execution receipt. */
export interface T3ExternalRefreshPreview {
  status:"NOT_FOUND"|"MATCHED_AT_READ"|"SOURCE_REVISION_CHANGED"|
    "SOURCE_REVISION_INCONSISTENT";
  workspace_id:string;object_id:string;
  original_revision?:number;
  source_owner?:string;record_kind?:string;record_id?:string;
  saved_source_revision?:string;saved_source_state?:string;
  saved_source_digest?:string;
  current_source_revision?:string;current_source_state?:string;
  current_source_digest?:string;
  epistemic_status?:"reported";
  owner_match_at_read?:boolean;
  requires_review:boolean;
  can_execute:false;
}
export function createTrustedExternalProcessLink(options:{
  kernel:KernelFacade;
  /** Existing signed D1 owner; required only for link/refresh. */
  accessForWrite?:(operation:"t1.putObject")=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  /** Signed D1 read-only owner for recover/prepareContinuation; at least
   * one of accessForRead/accessForWrite must be provided. */
  accessForRead?:(operation:"t1.getObject")=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  currentWorkspace:Pick<CurrentWorkspaceFacade,"get"|"subscribe">;
  externalOwner:T3ExternalRecordOwner;
  confirmHuman?:(input:{workspace_id:string;object_id:string;
    source_owner:string;record_kind:string;record_id:string;
    source_revision:string;previous_source_revision?:string;
    expected_t3_revision?:number;epistemic_status:"reported"})=>boolean|Promise<boolean>;
  isHostActive:()=>boolean;
}):Readonly<{
  link(input:T3ExternalRecordReference):Promise<T3ExternalLinkStatus>;
  refresh(input:T3ExternalRecordReference):Promise<T3ExternalLinkStatus>;
  /** Compare saved and remote revisions before showing the user an optional
   * separately approved refresh. It never modifies original T2 state. */
  previewRefresh(input:T3ExternalRecordReference):Promise<T3ExternalRefreshPreview>;
  /** Signed original Kernel snapshot, never claims the ERP is current. */
  readSaved(input:T3ExternalRecordReference):Promise<T3ExternalSavedLink>;
  recover(input:T3ExternalRecordReference):Promise<T3ExternalLinkStatus>;
  /** Read-only handoff to existing D6, never a new workflow or permission. */
  prepareContinuation(input:T3ExternalRecordReference):Promise<T3NativeContinuationReference>;
}>;

/** BPMN files are *proposed models*, never executed process observations. */
export interface T3ExternalBpmnCandidate {
  schema:"IWXA_T3_BPMN2_MODEL_CANDIDATE_V1";
  status:"UNTRUSTED_MODEL_NOT_EXECUTED";
  sourceTruth:false;derived:true;observed:false;requiresOwnerReview:true;
  bpmnNamespace:string;processId:string;processName:string;
  bpmnExecutableFlag:boolean;workspaceId:string|null;
  activityIds:readonly string[];
  tasks:readonly Readonly<{id:string;name:string;bpmn_type:string;
    execution_status:"NOT_OBSERVED"}>[];
  flowNodes:readonly Readonly<{id:string;bpmn_type:string}>[];
  sequenceFlows:readonly Readonly<{id:string;from:string;to:string;
    has_condition:boolean}>[];
  flowOrderAuthority:"MODEL_ONLY_NOT_OBSERVED";
}
export function inspectExternalBpmn2Model(options:{
  xml:string;processId?:string|null;workspaceId?:string|null;
  DOMParser?:new()=>{parseFromString(input:string,type:string):Document};
}):T3ExternalBpmnCandidate;
export function compareExternalBpmn2ToProcessDefinition(input:{
  candidate:T3ExternalBpmnCandidate;
  definition:{schema:"IWXA_T2_PROCESS_DEFINITION_V1";objectKind:"processDefinition";
    workspaceId:string;definitionId:string;versionId:string;
    sourceTruth:true;activityIds:readonly string[]};
}):Readonly<{
  schema:"IWXA_T3_BPMN2_MODEL_MATCH_V1";
  candidate_status:"UNTRUSTED_MODEL_NOT_EXECUTED";
  processDefinitionId:string;processDefinitionVersion:string;bpmnProcessId:string;
  status:"TASK_IDS_MATCH"|"REVIEW_MAPPING";
  missingTaskIds:readonly string[];extraTaskIds:readonly string[];
  executionObserved:false;conformance:"NOT_EVALUATED";
}>;

/** Trust-boundary input for Frappe v1:
 * GET /api/resource/Sales%20Order/{encoded exact record name}.
 * Transport, credentials, write authorization and remote CAS remain owned
 * by the installed Agent/ERPNext account, not by this source normalizer. */
export interface T3ErpNextSalesOrderSource {
  readonly source_owner:string;
  readonly record_kind:"Sales Order";
  readonly record_id:string;
  readonly source_revision:string;
  readonly source_digest:string;
  readonly source_receipt:null;
  readonly source_state:string;
  readonly epistemic_status:"reported";
  readonly record_authority:"EXTERNAL_OWNER";
}
export function normalizeErpNextSalesOrderRead(input:{
  ownerId:string;expectedRecordId:string;
  response:{data:Record<string,unknown>};
}):Promise<T3ErpNextSalesOrderSource>;

/** Odoo 19+/20+ JSON-2 sale.order/read source, not an execution receipt.
 * Requires a single exact numeric Odoo record id in the response array;
 * the installed Agent supplies the bearer credentials / database context. */
export interface T3OdooSaleOrderSource {
  readonly source_owner:string;
  readonly record_kind:"sale.order";
  readonly record_id:string;
  readonly source_revision:string;
  readonly source_digest:string;
  readonly source_receipt:null;
  readonly source_state:string;
  readonly epistemic_status:"reported";
  readonly record_authority:"EXTERNAL_OWNER";
}
export function normalizeOdooSaleOrderRead(input:{
  ownerId:string;expectedRecordId:string;
  response:readonly Record<string,unknown>[];
  /** Exact Odoo sale.order.line/read rows; missing child data is a failure. */
  linesResponse:readonly Record<string,unknown>[];
}):Promise<T3OdooSaleOrderSource>;

/** Selected by the trusted installed Agent Account owner, never by a renderer.
 * The binding digest and source owner must identify the current ERP account. */
export interface T3AgentErpAccountBinding {
  readonly sourceFormat:"ERPNEXT_REST_V1"|"ODOO_JSON2_V1";
  readonly providerId:string;
  readonly providerBindingDigest:string;
  readonly ownerId:string;
}
/** A selected Agent 0.6 ToolRuntime.read response is reported evidence,
 * NOT an ERP-native execution receipt. */
export interface T3AgentErpReadResult {
  readonly profile:"IWXA_PERSONAL_TOOL_PROVIDER_0.12";
  readonly input_required:false;
  readonly receipt:Readonly<{
    status:"SUCCEEDED";tool_id:"erp.order.read";
    provider_slot:"erp_orders";provider_id:string;
    provider_binding_digest:string;
    receipt_id:string;output_digest:string;
  }>;
  readonly data:Readonly<{
    source_format:"ERPNEXT_REST_V1"|"ODOO_JSON2_V1";
    source_owner:string;record_kind:"Sales Order"|"sale.order";
    record_id:string;
    response:unknown;linesResponse?:unknown;
  }>;
}
/** Install only in the original trusted Host. No credentials or HTTP flow
 * are created in T3; Agent ToolRuntime owns the actual read and TRR. */
export function createTrustedAgentErpOrderOwner(options:{
  selectedAccount:T3AgentErpAccountBinding;
  readTool:(tool_id:"erp.order.read",arguments:{readonly record_id:string})=>
    Promise<T3AgentErpReadResult>;
  isHostActive:()=>boolean;
}):Readonly<{
  ownerId:string;
  readExact(input:{record_kind:string;record_id:string}):
    Promise<T3ErpNextSalesOrderSource|T3OdooSaleOrderSource>;
}>;

