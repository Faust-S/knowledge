/**
 * PROMPT 18 §7 §9 — planned/unknown module exclusion.
 *
 * Guarantees:
 *   - a `planned` declaration NEVER surfaces its loader in the
 *     composition loaderTable, even if AVAILABLE_MODULES happens to
 *     know its id;
 *   - an `active` declaration for an unknown id produces the
 *     `unknown-active-module` diagnostic;
 *   - forbidden entry fields (url/path/import/loader/…) are rejected
 *     with `config-import-path-forbidden`.
 */
import { describe, it, expect } from "vitest";
import { resolveConfiguredModules, FORBIDDEN_MODULE_ENTRY_KEYS } from "@/composition";

const noLoaders = Object.freeze({}) as never;

describe("Composition — planned + unknown module handling", () => {
  it("keeps `planned` declarations out of the loaderTable", () => {
    const res = resolveConfiguredModules(
      {
        modules: [
          { module_id: "iwxa.workspace.base", state: "planned" },
          { module_id: "iwxa.workspace.exchange", state: "planned" },
        ],
      },
      // Even if the base loader is available, planned state MUST NOT
      // expose it in the loaderTable.
      { "iwxa.workspace.base": async () => ({ default: {} as never }) },
    );
    expect(res.loaderTable).toEqual({});
    expect(res.declarations.map((d) => `${d.moduleId}:${d.state}`)).toEqual([
      "iwxa.workspace.base:planned",
      "iwxa.workspace.exchange:planned",
    ]);
  });

  it("reports `unknown-active-module` for an active id absent from the loader table", () => {
    const res = resolveConfiguredModules(
      { modules: [{ module_id: "iwxa.mystery", state: "active" }] },
      noLoaders,
    );
    expect(res.loaderTable).toEqual({});
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("unknown-active-module");
  });

  it("rejects every forbidden loader-target field in a module entry", () => {
    for (const forbidden of FORBIDDEN_MODULE_ENTRY_KEYS) {
      const res = resolveConfiguredModules(
        {
          modules: [
            {
              module_id: "iwxa.workspace.base",
              state: "active",
              [forbidden]: "https://evil.example/x.js",
            },
          ],
        },
        { "iwxa.workspace.base": async () => ({ default: {} as never }) },
      );
      const diag = res.diagnostics.find(
        (d) => d.code === "config-import-path-forbidden",
      );
      expect(diag, `expected diagnostic for ${forbidden}`).toBeTruthy();
      expect(diag!.details).toEqual({ field: forbidden });
    }
  });

  it("flags duplicate module declarations", () => {
    const res = resolveConfiguredModules(
      {
        modules: [
          { module_id: "iwxa.workspace.base", state: "active" },
          { module_id: "iwxa.workspace.base", state: "planned" },
        ],
      },
      { "iwxa.workspace.base": async () => ({ default: {} as never }) },
    );
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("duplicate-module-declaration");
  });
});
