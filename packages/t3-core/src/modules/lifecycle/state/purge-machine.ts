/**
 * Purge state machine (PROMPT 27 §4-§12).
 *
 * 12 explicit states covering the full Runtime Contract Baseline 1.2
 * purge flow. Pure reducer: no timers, no I/O, no window/localStorage.
 *
 * The kernel-issued `challenge` string must match user input EXACTLY —
 * no trim(), no toLowerCase(), no workspace title alternative. Any
 * unrelated Runtime signal (state changed, token stale) collapses the
 * flow into `stale` so the caller must obtain a fresh preview.
 */
import type {
  PurgePreview,
  PurgeReceipt,
} from "@/kernel-client/contracts/runtime-1.3.0";

export type PurgeStatus =
  | "idle"
  | "previewing"
  | "preview-ready"
  | "awaiting-no-backup-ack"
  | "awaiting-challenge"
  | "committing"
  | "committed"
  | "cancelling"
  | "cancelled"
  | "expired"
  | "stale"
  | "error";

export interface PurgeState {
  status: PurgeStatus;
  workspaceId: string | null;
  preview: PurgePreview | null;
  /** User-supplied challenge input — verbatim, never normalised. */
  challengeInput: string;
  /** Set only after user explicitly acknowledged the missing-backup risk. */
  noBackupAcknowledged: boolean;
  receipt: PurgeReceipt | null;
  error: string | null;
}

export const INITIAL_PURGE_STATE: PurgeState = Object.freeze({
  status: "idle" as PurgeStatus,
  workspaceId: null,
  preview: null,
  challengeInput: "",
  noBackupAcknowledged: false,
  receipt: null,
  error: null,
});

export type PurgeAction =
  | { type: "preview-started"; workspaceId: string; acknowledgeNoBackup: boolean }
  | { type: "preview-succeeded"; preview: PurgePreview }
  | { type: "preview-failed"; error: string }
  | { type: "ack-no-backup" }
  | { type: "challenge-input"; value: string }
  | { type: "commit-started" }
  | { type: "commit-succeeded"; receipt: PurgeReceipt }
  | { type: "commit-failed"; error: string }
  | {
      type: "commit-retryable";
      error: string;
      clearInput: boolean;
    }
  | { type: "cancel-started" }
  | { type: "cancel-succeeded" }
  | { type: "cancel-failed"; error: string }
  | { type: "expire" }
  | { type: "stale-detected" }
  | { type: "reset" };

/**
 * Compute the next `status` after a preview succeeds. `missing` backup
 * without acknowledgement blocks the flow at `awaiting-no-backup-ack`;
 * anything else advances directly to `awaiting-challenge` for the
 * exact-match input.
 */
function validPreviewForState(state: PurgeState, preview: PurgePreview): boolean {
  if (!state.workspaceId || preview.workspace_id !== state.workspaceId) return false;
  if (typeof preview.purge_token !== "string" || preview.purge_token.length === 0) return false;
  if (typeof preview.challenge !== "string" || preview.challenge.length === 0) return false;
  if (typeof preview.expires_at !== "string" || !Number.isFinite(Date.parse(preview.expires_at))) return false;
  if (Boolean(preview.acknowledge_no_backup) !== state.noBackupAcknowledged) return false;
  return true;
}

function statusAfterPreview(preview: PurgePreview): PurgeStatus {
  const backup = preview.last_export.backup_status;
  if (backup === "missing" && !preview.acknowledge_no_backup) {
    return "awaiting-no-backup-ack";
  }
  return "awaiting-challenge";
}

export function purgeReducer(state: PurgeState, action: PurgeAction): PurgeState {
  switch (action.type) {
    case "preview-started":
      return {
        ...INITIAL_PURGE_STATE,
        status: "previewing",
        workspaceId: action.workspaceId,
        noBackupAcknowledged: action.acknowledgeNoBackup,
      };
    case "preview-succeeded":
      if (state.status !== "previewing") return state;
      if (!validPreviewForState(state, action.preview)) {
        return {
          ...INITIAL_PURGE_STATE,
          status: "error",
          workspaceId: state.workspaceId,
          error: "PURGE_PREVIEW_IDENTITY_INVALID",
        };
      }
      return {
        ...state,
        status: statusAfterPreview(action.preview),
        preview: action.preview,
      };
    case "preview-failed":
      if (state.status !== "previewing") return state;
      return { ...state, status: "error", error: action.error };
    case "ack-no-backup":
      if (state.status !== "awaiting-no-backup-ack") return state;
      // Do NOT auto-advance. The route triggers a new preview with
      // acknowledge_no_backup: true. Meanwhile clear the stale
      // preview so no commit can be attempted against it.
      return {
        ...state,
        status: "previewing",
        preview: null,
        challengeInput: "",
        noBackupAcknowledged: true,
      };
    case "challenge-input":
      if (state.status !== "awaiting-challenge") return state;
      return { ...state, challengeInput: action.value };
    case "commit-started":
      if (state.status !== "awaiting-challenge") return state;
      if (!isChallengeAccepted(state)) return state;
      return { ...state, status: "committing" };
    case "commit-succeeded":
      if (state.status !== "committing") return state;
      if (!state.workspaceId || action.receipt.workspace_id !== state.workspaceId) {
        return {
          ...INITIAL_PURGE_STATE,
          status: "error",
          workspaceId: state.workspaceId,
          error: "PURGE_RECEIPT_IDENTITY_MISMATCH",
        };
      }
      return { ...state, status: "committed", receipt: action.receipt };
    case "commit-failed":
      if (state.status !== "committing") return state;
      return { ...state, status: "error", error: action.error };
    case "commit-retryable":
      if (state.status !== "committing" || !state.preview) return state;
      return {
        ...state,
        status: "awaiting-challenge",
        challengeInput:
          action.clearInput
            ? ""
            : state.challengeInput,
        error: action.error,
      };
    case "cancel-started":
      if (
        state.status === "committed" ||
        state.status === "cancelled" ||
        state.status === "cancelling"
      ) {
        return state;
      }
      return { ...state, status: "cancelling" };
    case "cancel-succeeded":
      if (state.status !== "cancelling") return state;
      return {
        ...INITIAL_PURGE_STATE,
        status: "cancelled",
      };
    case "cancel-failed":
      if (state.status !== "cancelling") return state;
      return { ...state, status: "error", error: action.error };
    case "expire":
      if (state.status === "committed") return state;
      return {
        ...INITIAL_PURGE_STATE,
        status: "expired",
        workspaceId: state.workspaceId,
      };
    case "stale-detected":
      if (state.status === "committed") return state;
      return {
        ...INITIAL_PURGE_STATE,
        status: "stale",
        workspaceId: state.workspaceId,
      };
    case "reset":
      return { ...INITIAL_PURGE_STATE };
  }
}

/**
 * The user-supplied challenge input must match the kernel-issued
 * challenge string EXACTLY. No trim, no case folding, no alternative
 * acceptance of workspace id or workspace title. Comparison happens
 * on raw strings so that trailing whitespace is a mismatch by design.
 */
export function isChallengeAccepted(state: PurgeState): boolean {
  if (state.status !== "awaiting-challenge") return false;
  if (!state.preview) return false;
  if (state.challengeInput.length === 0) return false;
  return state.challengeInput === state.preview.challenge;
}

/** Preview considered expired when `expires_at` is in the past. */
export function isPreviewExpired(
  preview: PurgePreview | null,
  nowMs: number = Date.now(),
): boolean {
  if (!preview) return false;
  const t = Date.parse(preview.expires_at);
  if (!Number.isFinite(t)) return true;
  return t <= nowMs;
}

export function currentPurgeToken(state: PurgeState): string | null {
  return state.preview?.purge_token ?? null;
}
