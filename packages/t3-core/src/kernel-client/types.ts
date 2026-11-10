/** Public Kernel UI boundary: the single normative Runtime Contract 1.3.0. */
import type { IWXAClient } from "./contracts/runtime-1.3.0";
export type KernelSession = IWXAClient;
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
