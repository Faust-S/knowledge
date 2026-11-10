/**
 * Safe generator for opaque `workspace_id` values.
 *
 * The value is presented to the kernel verbatim. It must:
 *   - use cryptographically random bytes only (never insecure PRNGs);
 *   - contain no domain, profile, user, or time information;
 *   - match the shell's `isSafeOpaqueId` grammar
 *     (`/^[A-Za-z0-9._:-]{1,128}$/`);
 *   - be short (`ws-<uuid>` = 39 chars).
 */
import { isSafeOpaqueId } from "../../../../shell/routing";

const WEB_CRYPTO_MISSING =
  "Web Crypto is unavailable; refusing to generate a workspace_id from an insecure source";

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

function getCrypto(): CryptoLike | null {
  const g = globalThis as unknown as { crypto?: CryptoLike };
  return g.crypto ?? null;
}

function randomUuid(): string {
  const c = getCrypto();
  if (!c) throw new Error(WEB_CRYPTO_MISSING);
  if (typeof c.randomUUID === "function") return c.randomUUID();
  if (typeof c.getRandomValues !== "function") throw new Error(WEB_CRYPTO_MISSING);
  // RFC 4122 v4 fallback using getRandomValues (no insecure PRNGs).
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (const b of bytes) hex.push(b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

export function generateWorkspaceId(): string {
  const id = `ws-${randomUuid()}`;
  if (!isValidWorkspaceId(id)) {
    throw new Error(`Generated workspace_id failed validation: ${id}`);
  }
  return id;
}

export function isValidWorkspaceId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length <= 128 &&
    id.startsWith("ws-") &&
    isSafeOpaqueId(id)
  );
}
