/** Public Kernel UI boundary: the single normative Runtime Contract 1.3.0. */
import type { IWXAClient } from "./contracts/runtime-1.3.0";
// Optional original successor surface; keep the accepted Runtime snapshot intact.
export type OriginalEventCommitWindow = {
  entries: Array<{event: import("./contracts/runtime-1.3.0").EventRecord; legacy_history: boolean}>;
  next_after_event_id: string | null;
  has_more: boolean;
  order: "LOCAL_TRANSACTION_COMMIT_ORDER";
  legacy_history_causal_proven: false;
};
export type OriginalEventCommitReader = (
  workspaceId: string, afterEventId: string | null, limit: number,
) => Promise<OriginalEventCommitWindow>;
export type OriginalEventObjectCommitReader = (
  workspaceId: string, objectId: string, afterEventId: string | null, limit: number,
) => Promise<OriginalEventCommitWindow>;
export type KernelSession = IWXAClient & {
  t1: IWXAClient["t1"] & { listEventCommitWindow?: OriginalEventCommitReader; listEventObjectCommitWindow?: OriginalEventObjectCommitReader };
};
export type OperationId = import("./contracts/runtime-1.3.0").OperationId;

export type KernelStatus =
  | "loading"
  | "ready"
  | "limited"
  | "read-only"
  | "update-required"
  | "config-invalid"
  | "kernel-unavailable";

export type KernelErrorCode =
  | "service_id_missing"
  | "config_invalid"
  | "loader_unreachable"
  | "loader_timeout"
  | "kernel_missing"
  | "update_required"
  | "contract_version_mismatch"
  | "mode_denied"
  | "level_not_granted"
  | "connect_failed";

export class KernelError extends Error {
  constructor(
    public readonly code: KernelErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "KernelError";
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export type KernelState =
  | { status: "loading" }
  | { status: "ready"; session: KernelSession }
  | { status: "limited"; session: KernelSession }
  | { status: "read-only"; session: KernelSession }
  | { status: "update-required"; error: KernelError }
  | { status: "config-invalid"; error: KernelError }
  | { status: "kernel-unavailable"; error: KernelError };

export interface KernelBootstrap {
  version: number;
  connect(request: { service_id: string }): Promise<IWXAClient>;
  _describe?: () => Promise<unknown>;
}

declare global {
  interface Window {
    IWXA?: KernelBootstrap;
  }
}

/** Legacy alias — the normative contract calls this `OperationId`. */
export type GrantedOperation = OperationId;

export type {
  IWXAClient,
  ConnectMode,
  Level,
  ServicePassport,
} from "./contracts/runtime-1.3.0";
export type {
  WorkspaceRecord,
  ObjectRecord,
  EventRecord,
  RelationRecord,
  ObjectWithRelations,
} from "./contracts/runtime-1.3.0";
