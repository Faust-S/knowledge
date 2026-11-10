/**
 * Public entry point for the Domain Keys 2.0 host-config controller.
 *
 * This module owns the loading and validation of the three host-owned
 * configuration files. It intentionally does NOT expose a synthesised
 * "merged" contract — callers must consume `domain`, `shell` and
 * `workspace` separately.
 *
 * The IWXA Workspace shell consumes `domain`, `shell` and `workspace`
 * separately — there is no synthesised "merged" contract, and the former
 * legacy-projection bridge has been removed.
 */
export * from "./types";
export * from "./errors";
export { loadHostConfig, readFixtureFromLocation } from "./load-host-config";
export { verifyCrossFileInvariants } from "./cross-file-invariants";
export {
  validateDomainDoc,
  validateShellDoc,
  validateWorkspaceDoc,
} from "./validators";
export { useHostConfig } from "./useHostConfig";
