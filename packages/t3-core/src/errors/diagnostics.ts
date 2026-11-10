/**
 * Dev-only diagnostic details.
 *
 * In production `getDevDetails()` returns null so we never render
 * stack traces, causes, or raw messages to end users.
 */

export interface DevDetails {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  readonly cause: string | null;
}

function isDev(): boolean {
  return Boolean(
    typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
  );
}

export function getDevDetails(error: unknown): DevDetails | null {
  if (!isDev()) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause:
        error.cause === undefined
          ? null
          : typeof error.cause === "string"
            ? error.cause
            : safeStringify(error.cause),
    };
  }
  return {
    name: "NonError",
    message: safeStringify(error),
    stack: null,
    cause: null,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
