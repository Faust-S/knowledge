/**
 * Operation inventory — the shell may only refer to operations that the
 * normative `ALL_OPERATIONS` array declares. Any string literal starting
 * with `t0.` / `t1.` / `t2.` inside the shell must exist in that list,
 * otherwise the capability gate will silently deny it at runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { ALL_OPERATIONS } from "../src/kernel-client/contracts/runtime-1.2.0/index";
import { ALL_OPERATIONS as SUCCESSOR_ALL_OPERATIONS } from "../src/kernel-client/contracts/runtime-1.3.0/index";

const ROOT = resolve(process.cwd(), "src");
const OP_RE = /["'`](t[012]\.[a-zA-Z]+)["'`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      // Skip the normative snapshot — it defines the list itself.
      if (p.includes("contracts/runtime-1.2.0")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("operation inventory", () => {
  it("Baseline 1.2 grants exactly 26 canonical operations", () => {
    expect(ALL_OPERATIONS).toHaveLength(26);
  });

  it("every operation string referenced under src/ exists in ALL_OPERATIONS", () => {
    const known = new Set<string>(SUCCESSOR_ALL_OPERATIONS);
    expect(SUCCESSOR_ALL_OPERATIONS.filter(op => !ALL_OPERATIONS.includes(op as never))).toEqual(["t1.commitObjectGraph"]);
    const files = walk(ROOT);
    const offenders: Array<{ file: string; op: string }> = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      OP_RE.lastIndex = 0;
      while ((m = OP_RE.exec(src)) !== null) {
        const op = m[1];
        if (!known.has(op)) offenders.push({ file: f, op });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recovery ops from Baseline 1.2 are all present", () => {
    for (const op of [
      "t1.softDeleteWorkspace",
      "t1.restoreWorkspace",
      "t1.purgePreview",
      "t1.purgeCommit",
      "t1.purgeCancel",
    ]) {
      expect(ALL_OPERATIONS).toContain(op);
    }
  });
});
