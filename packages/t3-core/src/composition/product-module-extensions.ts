import type { ModuleLoaderTable } from "@/workspace-host/modules";

/**
 * Canonical T2 Host is domain-neutral. Every domain must be staged from its
 * own repositories into a disposable Host checkout at build time.
 * The external-module stager appends compile-time literal imports here.
 */
export const PRODUCT_MODULE_EXTENSIONS: ModuleLoaderTable = Object.freeze({
  // T2_EXTERNAL_DOMAIN_MODULES
});
