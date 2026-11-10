/**
 * Compatibility barrel for the Baseline 1.2 Runtime Contract.
 *
 * All contract types come from the immutable snapshot at
 * `../runtime-1.2.0/`. This barrel adds only two things:
 *   - `SUPPORTED_CONTRACT_VERSION` — the exact value the shell requires
 *     in `IWXAClient.contract_version` to consider itself compatible.
 *   - Auxiliary shell-side error classes (see ./errors).
 *
 * A parity test (`tests/runtime-contract-parity.test.ts`) enforces that
 * this folder never re-introduces its own type definitions.
 */
export * from "../runtime-1.2.0/public-api";
export * from "./errors";
import manifestJson from "./manifest.json";
import { CONTRACT_VERSION } from "../runtime-1.2.0/index";

export const CONTRACT_MANIFEST = manifestJson as {
  contract_version: string;
  loader_version: number;
  source_project: string;
  source_files: string[];
  copied_at: string;
  methods_used: { t1: string[]; t2: string[] };
  granted_operations: string[];
};

export const SUPPORTED_CONTRACT_VERSION = CONTRACT_VERSION;
export const LOADER_VERSION = CONTRACT_MANIFEST.loader_version;
export { CONTRACT_VERSION };
