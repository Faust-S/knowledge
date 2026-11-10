/**
 * PROMPT 22c-2 — static-check boundary.
 *
 * Enforces that `KernelSession` and `Capabilities` types are only
 * imported inside the sanctioned host infrastructure:
 *   - src/kernel-client/**      (owners of the types)
 *   - src/shell/AppShell.tsx    (composition root)
 *   - src/workspace-host/context/**  (facade factories)
 *   - src/workspace-host/runtime/**  (host runtime plumbing)
 *
 * Modules (`src/modules/**`) and shell chrome (Navigation / ActionBar /
 * Header / views / routing) must consume `KernelFacade` instead.
 * Comments referencing the legacy names are permitted; only real
 * `import` statements are rejected.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "src");

const ALLOW_PREFIXES = [
  path.join(ROOT, "kernel-client"),
  path.join(ROOT, "workspace-host", "context"),
  path.join(ROOT, "workspace-host", "runtime"),
  // Host-owned first-run provisioning gate is a sanctioned Kernel bootstrap boundary.
  path.join(ROOT, "workspace-host", "bootstrap"),
];

const ALLOW_FILES = [
  path.join(ROOT, "shell", "AppShell.tsx"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function isAllowed(file: string): boolean {
  if (ALLOW_FILES.includes(file)) return true;
  return ALLOW_PREFIXES.some((p) => file === p || file.startsWith(p + path.sep));
}

const IMPORT_RE =
  /^\s*import\s+(?:type\s+)?\{[^}]*\b(KernelSession|Capabilities)\b[^}]*\}\s+from\s+["'][^"']+["']/m;

describe("PROMPT 22c-2 — KernelSession / Capabilities boundary", () => {
  const violations: string[] = [];
  for (const file of walk(ROOT)) {
    if (isAllowed(file)) continue;
    const src = readFileSync(file, "utf8");
    // Strip line + block comments so doc comments don't count.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (IMPORT_RE.test(stripped)) {
      violations.push(path.relative(ROOT, file));
    }
  }

  it("forbids KernelSession / Capabilities imports outside sanctioned paths", () => {
    expect(violations).toEqual([]);
  });
});
