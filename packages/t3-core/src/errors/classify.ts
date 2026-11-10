/**
 * Map arbitrary throwables to a WorkspaceErrorCode.
 *
 * This is the single place that translates kernel/domain error shapes into
 * the shell's closed taxonomy. Anything unrecognised becomes `"unknown"` —
 * which is still explicit (see registry) and never a silent fallback.
 */
import type { WorkspaceErrorCode } from "./codes";

interface Coded {
  code?: unknown;
  name?: unknown;
}

const KERNEL_TO_WORKSPACE: Record<string, WorkspaceErrorCode> = {
  config_invalid: "config_invalid",
  loader_unreachable: "kernel_unavailable",
  loader_timeout: "kernel_unavailable",
  kernel_missing: "kernel_unavailable",
  connect_failed: "kernel_unavailable",
  update_required: "migration_required",
  quota_exceeded: "quota_exceeded",
  conflict: "conflict",
  unsupported_schema: "unsupported_schema",
  package_corrupted: "package_corrupted",
};

export function classifyError(error: unknown): WorkspaceErrorCode {
  if (!error || typeof error !== "object") return "unknown";
  const rawCode = (error as Coded).code;
  if (typeof rawCode === "string" && rawCode in KERNEL_TO_WORKSPACE) {
    return KERNEL_TO_WORKSPACE[rawCode];
  }
  if (typeof rawCode === "string" && (rawCode as WorkspaceErrorCode)) {
    // If the throwable already speaks the shell's vocabulary, honour it.
    const asShell = rawCode as WorkspaceErrorCode;
    if (
      asShell === "config_invalid" ||
      asShell === "kernel_unavailable" ||
      asShell === "migration_required" ||
      asShell === "quota_exceeded" ||
      asShell === "conflict" ||
      asShell === "unsupported_schema" ||
      asShell === "package_corrupted"
    ) {
      return asShell;
    }
  }
  return "unknown";
}
