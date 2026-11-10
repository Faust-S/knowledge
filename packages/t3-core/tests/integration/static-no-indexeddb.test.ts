/**
 * Integration T2 — architecture lock: no direct IndexedDB from the shell.
 *
 * Static scan (no runtime): the shell must never bypass the kernel by
 * touching browser storage APIs directly. The kernel-client and its mock
 * live outside the shell surface — those are the only files allowed to
 * mention storage primitives (and even the mock currently doesn't).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SHELL_ROOTS = [
  "src/shell",
  "src/features",
  "src/renderers",
  "src/profiles",
  "src/config",
  "src/errors",
  "src/components",
];

// APIs that would smuggle storage/IO past the kernel gateway.
const FORBIDDEN = [
  /\bindexedDB\b/,
  /\bIDBFactory\b/,
  /\bIDBDatabase\b/,
  /\bIDBObjectStore\b/,
  /\bIDBTransaction\b/,
  /["']idb["']/, // import "idb"
  /["']idb-keyval["']/,
  /["']dexie["']/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
];

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield full;
  }
}

describe("Static scan — shell does not touch storage APIs directly", () => {
  it("no shell file mentions IndexedDB / localStorage / sessionStorage", () => {
    const offenders: string[] = [];
    for (const rel of SHELL_ROOTS) {
      for (const file of walk(join(ROOT, rel))) {
        const src = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN) {
          if (pattern.test(src)) {
            offenders.push(`${relative(ROOT, file)} :: ${pattern}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
