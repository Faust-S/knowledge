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
export interface T3NativeContinuationStatus {
  status:"AVAILABLE"|"RECOVER_ONLY"|"USER_CANCELLED"|"OUTCOME_UNKNOWN"|"OWNER_READBACK_CONFIRMED";
  operationId?:string;
  recipientId?:string;
  resultRef?:string;
  reference?:T3NativeContinuationReference;
  reason?:string;
}
export function createTrustedNativeContinuation(options:{
  kernel:KernelFacade;
  accessForRead:(operation:string)=>T3SignedActivityAccess|null|
    Promise<T3SignedActivityAccess|null>;
  currentWorkspace:Pick<CurrentWorkspaceFacade,"get"|"subscribe">;
  nativeOwner:T3NativeContinuationOwner;
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
  open(input:{ciphertext:Uint8Array;selectedWorkspaceId?:string;
    recipientId?:string}):unknown|Promise<unknown>;
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
  seal(input:{workspace_id:string;archiveBytes:Uint8Array}):
    Promise<T3AgeProtectionReceipt>;
  open(input:{ciphertext:Uint8Array}):Promise<T3AgeOpenReceipt>;
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
