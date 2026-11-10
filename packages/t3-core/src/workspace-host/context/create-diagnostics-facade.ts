/**
 * createDiagnosticsFacade (PROMPT 17 §10).
 *
 * Stamps every diagnostic with the reporting module's id and strips any
 * accidental payload keys that could leak state (`stack`, `session`,
 * `adapter`, etc.).
 */

import type { DiagnosticsFacade } from "@/workspace-contract";

export interface DiagnosticSink {
  report(diagnostic: {
    code: string;
    message: string;
    moduleId: string;
    details?: unknown;
  }): void;
}

export interface DiagnosticsFacadeInput {
  moduleId: string;
  sink: DiagnosticSink;
}

const FORBIDDEN_DETAIL_KEYS = new Set([
  "session",
  "adapter",
  "runtime",
  "client",
  "indexedDB",
  "IDBDatabase",
  "window",
  "IWXA",
  "secrets",
  "config",
  "stack",
]);

function sanitizeDetails(details: unknown): unknown {
  if (details === null || details === undefined) return undefined;
  if (typeof details !== "object") return details;
  if (Array.isArray(details)) return details.map((v) => sanitizeDetails(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (FORBIDDEN_DETAIL_KEYS.has(k)) continue;
    out[k] = sanitizeDetails(v);
  }
  return out;
}

export function createDiagnosticsFacade(
  input: DiagnosticsFacadeInput,
): DiagnosticsFacade {
  const facade: DiagnosticsFacade = {
    report(d) {
      if (!d || typeof d.code !== "string" || typeof d.message !== "string") {
        return;
      }
      input.sink.report({
        code: d.code,
        message: d.message,
        moduleId: input.moduleId,
        details: sanitizeDetails(d.details),
      });
    },
  };
  return Object.freeze(facade);
}
