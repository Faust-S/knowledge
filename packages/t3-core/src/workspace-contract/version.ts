/**
 * Workspace Contract version — the Host↔Module contract of the IWXA
 * Workspace shell.
 *
 * This is NOT the Kernel Runtime Contract (which is pinned separately in
 * `src/kernel-client/contracts/runtime-1.3.0`). Both contracts evolve
 * independently: a change here MUST NOT touch the Runtime snapshot.
 */

export const WORKSPACE_CONTRACT_VERSION = "0.1.0" as const;
export type WorkspaceContractVersion = typeof WORKSPACE_CONTRACT_VERSION;

/** Runtime Contract this Workspace Contract expects to interoperate with. */
import { CONTRACT_VERSION as CURRENT_RUNTIME_CONTRACT_VERSION } from "../kernel-client/contracts/runtime-1.3.0";
export const EXPECTED_RUNTIME_CONTRACT_VERSION = CURRENT_RUNTIME_CONTRACT_VERSION;
export type ExpectedRuntimeContractVersion =
  typeof EXPECTED_RUNTIME_CONTRACT_VERSION;

/** Frozen module-manifest schema version this Contract validates. */
export const SUPPORTED_MODULE_MANIFEST_VERSION = "1.0.0" as const;
