/**
 * Compatibility re-export.
 *
 * The v1 folder no longer defines Runtime Contract types on its own.
 * All Baseline 1.2 shapes come from the immutable snapshot at
 * ../runtime-1.2.0/. This file exists only so existing imports of
 * `contracts/v1/public-api` keep resolving.
 */
export * from "../runtime-1.2.0/public-api";
