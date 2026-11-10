import { loadBootstrap, resetLoaderCache } from "./loader";
import type { KernelBootstrap, KernelSession, KernelState } from "./types";
import { KernelError } from "./types";
import { CONTRACT_VERSION } from "./contracts/runtime-1.3.0";

export interface ConnectOptions {
  serviceId: string;
  requiredLevels?: Array<"T0" | "T1" | "T2">;
  timeoutMs?: number;
  /** Dev/tests-only override. Removed from prod bundle by DEV guards. */
  bootstrap?: KernelBootstrap;
}

/**
 * Establish a session with the real kernel. Never throws — every failure
 * becomes a typed `KernelState` the UI can render.
 *
 * Compatibility gate (in order):
 *   1. Exact qualified Runtime Contract 1.3.0; no backward-compatible path.
 *      `runtime_version` is diagnostic only and never gates connect.
 *   2. `client.mode !== "update-required"`.
 *   3. Every `requiredLevels` entry is in `client.granted_levels`.
 */
export async function connectKernel(opts: ConnectOptions): Promise<KernelState> {
  const { serviceId, timeoutMs, bootstrap, requiredLevels = ["T1"] } = opts;

  if (!serviceId) {
    return {
      status: "config-invalid",
      error: new KernelError(
        "service_id_missing",
        "workspace service_id is missing",
      ),
    };
  }

  try {
    const b = bootstrap ?? (await loadBootstrap(timeoutMs));
    const client = (await b.connect({ service_id: serviceId })) as KernelSession;

    // 1. Explicit contract allowlist; future versions remain fail-closed.
    if (client.contract_version !== CONTRACT_VERSION) {
      return {
        status: "update-required",
        error: new KernelError(
          "contract_version_mismatch",
          `Kernel contract_version "${client.contract_version}" is not the required ${CONTRACT_VERSION}`,
        ),
      };
    }

    // 2. Kernel-declared mode.
    if (client.mode === "update-required") {
      return {
        status: "update-required",
        error: new KernelError(
          "mode_denied",
          "Kernel reports mode=update-required",
        ),
      };
    }

    // 3. Required levels.
    const granted = client.granted_levels ?? [];
    const missing = requiredLevels.filter((l) => !granted.includes(l));
    if (missing.length > 0) {
      return {
        status: "kernel-unavailable",
        error: new KernelError(
          "level_not_granted",
          `Required levels not granted: ${missing.join(", ")}`,
        ),
      };
    }

    return sessionToState(client);
  } catch (raw) {
    return errorToState(raw);
  }
}

export function sessionToState(session: KernelSession): KernelState {
  switch (session.mode) {
    case "limited":
      return { status: "limited", session };
    case "read-only":
    case "emergency-export":
      return { status: "read-only", session };
    case "full":
    default:
      return { status: "ready", session };
  }
}

export function errorToState(raw: unknown): KernelState {
  const code =
    raw instanceof KernelError
      ? raw.code
      : classify(raw);
  const message =
    raw instanceof Error ? raw.message : String(raw);
  const err = raw instanceof KernelError ? raw : new KernelError(code, message, raw);
  switch (err.code) {
    case "update_required":
    case "contract_version_mismatch":
      return { status: "update-required", error: err };
    case "config_invalid":
    case "service_id_missing":
      return { status: "config-invalid", error: err };
    default:
      return { status: "kernel-unavailable", error: err };
  }
}

function classify(raw: unknown): import("./types").KernelErrorCode {
  const rawCode =
    raw && typeof raw === "object" && "code" in raw
      ? String((raw as { code: unknown }).code)
      : "";
  if (rawCode === "UPDATE_REQUIRED") return "update_required";
  if (rawCode === "UNKNOWN_SERVICE" || rawCode === "PASSPORT_INVALID")
    return "config_invalid";
  if (rawCode === "LEVEL_NOT_ALLOWED" || rawCode === "MISSING_LEVEL")
    return "level_not_granted";
  const msg = raw instanceof Error ? raw.message.toLowerCase() : String(raw);
  if (/update.?required/i.test(msg)) return "update_required";
  if (/config|invalid|serviceid|service_id/i.test(msg)) return "config_invalid";
  return "connect_failed";
}

export function retryConnect(opts: ConnectOptions): Promise<KernelState> {
  resetLoaderCache();
  return connectKernel(opts);
}
