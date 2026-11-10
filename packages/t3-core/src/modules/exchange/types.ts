/**
 * Public types owned by the exchange module.
 *
 * PROMPT 22b — `PackagesTab` moved out of `src/shell/routing.ts` into
 * the exchange module (which owns the Packages surface). The Host still
 * re-exports it from `src/shell/routing.ts` for legacy hash-parsing
 * back-compat; the canonical home is here.
 */

export type PackagesTab = "export" | "import";
