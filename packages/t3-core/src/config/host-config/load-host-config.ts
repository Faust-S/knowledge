import { diagnostic } from "./errors";
import {
  validateDomainDoc,
  validateShellDoc,
  validateWorkspaceDoc,
} from "./validators";
import { verifyCrossFileInvariants } from "./cross-file-invariants";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  HostConfigDiagnostic,
  HostConfigDiagnosticCode,
  HostConfigResult,
  WorkspaceConfigDoc,
} from "./types";

const DEV = import.meta.env.DEV;

const DOMAIN_PATH = "/_iwxa/domain.json";
const SHELL_PATH = "/_iwxa/domain-shell.json";
const WORKSPACE_PATH = "/workspace/workspace.config.json";

// --- Dev fixture registry (three files per fixture) ----------------------
//
// `import.meta.glob` is a Vite compile-time primitive: production bundles
// contain an empty map and this branch is tree-shaken.
const DEV_FIXTURE_FILES: Record<string, unknown> = DEV
  ? import.meta.glob(
      "/fixtures/host-configs/*/{domain,domain-shell,workspace.config}.json",
      { eager: true, import: "default" },
    )
  : {};

type FixtureSet = {
  domain: unknown;
  shell: unknown;
  workspace: unknown;
};

function collectFixture(name: string): FixtureSet | null {
  if (!DEV) return null;
  const prefix = `/fixtures/host-configs/${name}/`;
  const domain = DEV_FIXTURE_FILES[`${prefix}domain.json`];
  const shell = DEV_FIXTURE_FILES[`${prefix}domain-shell.json`];
  const workspace = DEV_FIXTURE_FILES[`${prefix}workspace.config.json`];
  if (!domain || !shell || !workspace) return null;
  return { domain, shell, workspace };
}

// --- Independent fetch with distinct failure classes ---------------------

type LoadOutcome =
  | { kind: "ready"; raw: unknown }
  | { kind: "missing" }
  | { kind: "not-found-dev" }
  | {
      kind: "http-error";
      status: number;
      /** Human-readable technical reason kept in diagnostic details. */
      reason: "network-error" | "http-status";
      error?: unknown;
    }
  | { kind: "invalid-json"; error: unknown };

async function fetchDoc(path: string): Promise<LoadOutcome> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-cache" });
  } catch (e) {
    // Network failure — NOT the same as missing. Prompt 08 §2.
    return { kind: "http-error", status: 0, reason: "network-error", error: e };
  }
  if (res.status === 404) return DEV ? { kind: "not-found-dev" } : { kind: "missing" };
  if (!res.ok) {
    return { kind: "http-error", status: res.status, reason: "http-status" };
  }
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  // Vite dev server serves the SPA index.html for unknown paths.
  if (
    DEV &&
    (contentType.includes("text/html") || /^\s*<!doctype html/i.test(body))
  ) {
    return { kind: "not-found-dev" };
  }
  try {
    return { kind: "ready", raw: JSON.parse(body) };
  } catch (e) {
    return { kind: "invalid-json", error: e };
  }
}

type Which = "domain" | "shell" | "workspace";

const MISSING_CODE: Record<Which, HostConfigDiagnosticCode> = {
  domain: "domain-config-missing",
  shell: "domain-shell-missing",
  workspace: "workspace-config-missing",
};
const HTTP_CODE: Record<Which, HostConfigDiagnosticCode> = {
  domain: "domain-config-http-error",
  shell: "shell-config-http-error",
  workspace: "workspace-config-http-error",
};
const JSON_CODE: Record<Which, HostConfigDiagnosticCode> = {
  domain: "domain-config-invalid-json",
  shell: "shell-config-invalid-json",
  workspace: "workspace-config-invalid-json",
};
const SCHEMA_CODE: Record<Which, HostConfigDiagnosticCode> = {
  domain: "domain-schema-invalid",
  shell: "shell-schema-invalid",
  workspace: "workspace-schema-invalid",
};

interface LoadOptions {
  /** Explicit dev fixture name (from `?fixture=` or a test). */
  fixture?: string | null;
  /** Runtime origin. Defaults to window.location.origin when available. */
  runtimeOrigin?: string | null;
  /** Force production semantics (no fixture fallback, enforce origin). */
  forceProduction?: boolean;
  /**
   * Optional direct injection for tests — bypasses fetch/fixture entirely.
   * All three raw documents must be provided.
   */
  injected?: { domain: unknown; shell: unknown; workspace: unknown } | null;
}

const WHICHES: Which[] = ["domain", "shell", "workspace"];

function toSourceDiagnostic(
  which: Which,
  outcome: LoadOutcome,
  { treatMissing }: { treatMissing: boolean },
): HostConfigDiagnostic | null {
  switch (outcome.kind) {
    case "ready":
      return null;
    case "invalid-json":
      return diagnostic(JSON_CODE[which], outcome.error);
    case "http-error":
      return diagnostic(HTTP_CODE[which], {
        status: outcome.status,
        reason: outcome.reason,
      });
    case "missing":
    case "not-found-dev":
      return treatMissing ? diagnostic(MISSING_CODE[which]) : null;
  }
}

/**
 * Load the three host-owned configuration files and return the combined
 * HostConfigResult. Never merges the three raw JSONs into a synthetic
 * contract — callers receive them as separate fields.
 *
 * Failure priorities (Prompt 08 §1–3):
 *  1. invalid-json / http-error / network-error on any file → blocking, no
 *     fixture fallback, all discovered source diagnostics preserved.
 *  2. Partial deployment (some ready, some missing) → blocking error with a
 *     diagnostic per missing file. Not a fixture-fallback trigger.
 *  3. All three missing (dev only) → generic fixture set.
 */
export async function loadHostConfig(
  options: LoadOptions = {},
): Promise<HostConfigResult> {
  const runtimeOrigin =
    options.runtimeOrigin ??
    (typeof window !== "undefined" ? window.location.origin : null);
  const isProduction = options.forceProduction === true || !DEV;

  const empty: HostConfigResult = {
    status: "loading",
    domain: null,
    shell: null,
    workspace: null,
    diagnostics: [],
    error: null,
    fixture: null,
  };

  let sources: FixtureSet | null = null;
  let fixtureName: string | null = null;
  const sourceDiagnostics: HostConfigDiagnostic[] = [];

  if (options.injected) {
    sources = options.injected;
  } else if (!isProduction && options.fixture) {
    const fx = collectFixture(options.fixture);
    if (!fx) {
      const err = diagnostic("domain-config-missing", {
        reason: "fixture-not-found",
        fixture: options.fixture,
      });
      return { ...empty, status: "error", error: err, diagnostics: [err] };
    }
    sources = fx;
    fixtureName = options.fixture;
  } else {
    // Fetch all three in parallel — do NOT short-circuit on the first result.
    const results = await Promise.all([
      fetchDoc(DOMAIN_PATH),
      fetchDoc(SHELL_PATH),
      fetchDoc(WORKSPACE_PATH),
    ]);

    // Step 1: invalid-json / http-error dominates any decision. Collect them
    // ALL so the UI can display the full picture. Never fall back to fixture.
    const hardFailures: HostConfigDiagnostic[] = [];
    for (let i = 0; i < 3; i++) {
      const r = results[i];
      const w = WHICHES[i];
      if (r.kind === "invalid-json" || r.kind === "http-error") {
        const d = toSourceDiagnostic(w, r, { treatMissing: false });
        if (d) hardFailures.push(d);
      }
    }

    if (hardFailures.length > 0) {
      // Include any missing-file diagnostics for completeness (details only).
      const supplementalMissing: HostConfigDiagnostic[] = [];
      for (let i = 0; i < 3; i++) {
        const r = results[i];
        const w = WHICHES[i];
        if (r.kind === "missing" || r.kind === "not-found-dev") {
          const d = toSourceDiagnostic(w, r, { treatMissing: true });
          if (d) supplementalMissing.push(d);
        }
      }
      const combined = [...hardFailures, ...supplementalMissing];
      return {
        ...empty,
        status: "error",
        diagnostics: combined,
        error: combined[0],
      };
    }

    // Step 2: classify missing counts.
    const missingIdx: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = results[i];
      if (r.kind === "missing" || r.kind === "not-found-dev") missingIdx.push(i);
    }

    if (missingIdx.length === 0) {
      // All three retrieved — validate real payloads.
      sources = {
        domain: (results[0] as { kind: "ready"; raw: unknown }).raw,
        shell: (results[1] as { kind: "ready"; raw: unknown }).raw,
        workspace: (results[2] as { kind: "ready"; raw: unknown }).raw,
      };
    } else if (missingIdx.length === 3 && !isProduction) {
      // Dev-only, all three absent → generic fixture set is allowed.
      const fx = collectFixture("generic");
      if (!fx) {
        const err = diagnostic("domain-config-missing", {
          reason: "no-real-config-and-no-fixture",
        });
        return { ...empty, status: "error", error: err, diagnostics: [err] };
      }
      sources = fx;
      fixtureName = "generic";
    } else {
      // Partial deployment (any env) or any-missing in production → blocking.
      const perFile: HostConfigDiagnostic[] = [];
      for (const i of missingIdx) {
        const r = results[i];
        const w = WHICHES[i];
        const d = toSourceDiagnostic(w, r, { treatMissing: true });
        if (d) perFile.push(d);
      }
      return {
        ...empty,
        status: "error",
        diagnostics: perFile,
        error: perFile[0],
      };
    }
  }

  // -- Schema validation --------------------------------------------------
  const domainR = validateDomainDoc(sources.domain);
  const shellR = validateShellDoc(sources.shell);
  const workspaceR = validateWorkspaceDoc(sources.workspace);

  const schemaDiagnostics: HostConfigDiagnostic[] = [];
  if (!domainR.valid) {
    schemaDiagnostics.push(diagnostic(SCHEMA_CODE.domain, domainR.errors));
  }
  if (!shellR.valid) {
    schemaDiagnostics.push(diagnostic(SCHEMA_CODE.shell, shellR.errors));
  }
  if (!workspaceR.valid) {
    schemaDiagnostics.push(diagnostic(SCHEMA_CODE.workspace, workspaceR.errors));
  }

  // Post-schema hardening: `runtime.runtime_version` is normatively required.
  // The projection type declares it required — enforce here so the diagnostic
  // is a schema-invalidity, not a silent undefined at the invariant step.
  if (domainR.valid && domainR.data) {
    const d = domainR.data as { runtime?: { runtime_version?: unknown } };
    if (
      !d.runtime ||
      typeof d.runtime.runtime_version !== "string" ||
      d.runtime.runtime_version.length === 0
    ) {
      schemaDiagnostics.push(
        diagnostic(SCHEMA_CODE.domain, {
          missing: "runtime.runtime_version",
        }),
      );
    }
  }

  if (schemaDiagnostics.length > 0) {
    return {
      ...empty,
      status: "error",
      diagnostics: [...sourceDiagnostics, ...schemaDiagnostics],
      error: schemaDiagnostics[0],
      fixture: fixtureName,
    };
  }

  const domain = domainR.data as DomainConfigDoc;
  const shell = shellR.data as DomainShellDoc;
  const workspace = workspaceR.data as WorkspaceConfigDoc;

  // -- Cross-file invariants ---------------------------------------------
  const originCheckMode =
    fixtureName !== null ? "skip-synthetic" : "enforce";
  const crossIssues = verifyCrossFileInvariants({
    domain,
    shell,
    workspace,
    runtimeOrigin,
    originCheckMode,
  });

  if (crossIssues.length > 0) {
    return {
      status: "error",
      domain,
      shell,
      workspace,
      diagnostics: crossIssues,
      error: crossIssues[0],
      fixture: fixtureName,
    };
  }

  return {
    status: "ready",
    domain,
    shell,
    workspace,
    diagnostics: [],
    error: null,
    fixture: fixtureName,
  };
}

/**
 * Pick the fixture name from the current window location (`?fixture=NAME`).
 * Returns null when not in a browser or when no fixture is requested.
 */
export function readFixtureFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("fixture");
}
