/**
 * Map a HostConfigDiagnostic code to the WorkspaceErrorCode surface used
 * by ErrorPage. All host-configuration failures — including Runtime and
 * Contract version mismatches, profile mismatches, and unsafe policies —
 * belong to `config_invalid`. `health_build_required` is reserved for the
 * separate case where a user opens the Health Workspace on a build compiled
 * without the health flag; it must NEVER be triggered by a config invariant.
 */
import type { HostConfigDiagnosticCode } from "../config/host-config";
import type { WorkspaceErrorCode } from "./codes";

export function hostConfigErrorToWorkspaceCode(
  _code: HostConfigDiagnosticCode | undefined,
): WorkspaceErrorCode {
  return "config_invalid";
}
