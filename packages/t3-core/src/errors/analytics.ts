/**
 * Error analytics sink — strictly non-content.
 *
 * Contract: NEVER serialize user content into an analytics event. That means
 * no error.message strings from unknown sources, no stack frames containing
 * file:// URLs with user data, no workspace ids, no object payloads.
 *
 * Only the fields declared in `SafeErrorEvent` may leave the process.
 * Everything else is dropped at the boundary defined here.
 */
import type { WorkspaceErrorCode } from "./codes";

export interface SafeErrorEvent {
  /** Closed enum — safe to log. */
  readonly code: WorkspaceErrorCode;
  /** ISO timestamp of when the boundary caught the error. */
  readonly at: string;
  /** Build identifier injected at bundle time. Never a user string. */
  readonly buildId: string;
  /** Short opaque digest of the stack, for grouping only. */
  readonly stackDigest: string;
  /** Whether the app was running in dev mode. */
  readonly dev: boolean;
}

const BUILD_ID: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_ID) ||
  "dev";

/**
 * Cheap non-crypto digest — we only need stable grouping, not secrecy.
 * Kept dependency-free so this module has no runtime imports.
 */
function digest(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Sinks receive only fully-scrubbed events. */
export type AnalyticsSink = (event: SafeErrorEvent) => void;

let activeSink: AnalyticsSink | null = null;

/** Registered from `main.tsx` in real builds; tests inject a spy. */
export function setAnalyticsSink(sink: AnalyticsSink | null): void {
  activeSink = sink;
}

/**
 * Build a safe event from an arbitrary throwable. Callers pass the error
 * unchanged — sanitation happens *here* so no caller can accidentally leak
 * content by pre-formatting a message.
 */
export function buildSafeEvent(
  code: WorkspaceErrorCode,
  error: unknown,
  now: () => Date = () => new Date(),
): SafeErrorEvent {
  const stack =
    error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  return {
    code,
    at: now().toISOString(),
    buildId: BUILD_ID,
    // Digest the stack, not the message: message often contains user text.
    stackDigest: digest(stack),
    dev: Boolean(
      typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
    ),
  };
}

/** Report an error. No-op if no sink is registered. */
export function reportError(code: WorkspaceErrorCode, error: unknown): void {
  if (!activeSink) return;
  activeSink(buildSafeEvent(code, error));
}
