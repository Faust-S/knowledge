import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative } from "node:path";

const ROOT = process.cwd();
const SNAP = resolve(ROOT, "src/config/schemas/keys-2.0");
const EXPECTED = [
  "domain-config.schema.json",
  "domain-key.schema.json",
  "domain-shell.schema.json",
  "workspace-config.schema.json",
  "workspace-module-manifest.schema.json",
];
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("domain-keys 2.0 snapshot", () => {
  it("has exactly five schemas matching inventory", () => {
    const found = readdirSync(SNAP).filter((f) => f.endsWith(".schema.json")).sort();
    expect(found).toEqual([...EXPECTED].sort());
    expect(found).toHaveLength(5);
  });
  it("all schemas parse as JSON", () => {
    for (const s of EXPECTED) expect(() => JSON.parse(readFileSync(resolve(SNAP, s), "utf8"))).not.toThrow();
  });
  it("SHA-256 parity with packaged provenance", () => {
    const provenance = JSON.parse(readFileSync(resolve(SNAP, "provenance.json"), "utf8")) as { files: Record<string,string> };
    for (const s of EXPECTED) expect(sha(resolve(SNAP, s))).toBe(provenance.files[s]);
  });
  it("contain no remote executable URLs", () => {
    for (const s of EXPECTED) {
      const raw = readFileSync(resolve(SNAP, s), "utf8");
      // Extract syntactically plausible URLs; regex alternations such as
      // "https://|http://..." in a schema pattern are not remote URLs.
      const urls = raw.match(/https?:\/\/[A-Za-z0-9.-]+\/[^"\s]+/g) ?? [];
      for (const u of urls) {
        expect(u).toMatch(/^https:\/\/(json-schema\.org|iwxa\.dev)\//);
        expect(u).not.toMatch(/\.(js|mjs|cjs|wasm)(\?|$)/);
      }
    }
  });
  it("domain-key schema exists but is not referenced by browser source", () => {
    expect(existsSync(resolve(SNAP, "domain-key.schema.json"))).toBe(true);
    const offenders = sourceFiles(resolve(ROOT, "src"))
      .filter((p) => relative(SNAP, p).startsWith(".."))
      .filter((p) => /domain-key(?:\.schema)?/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
  it("production source does not import from .source-materials", () => {
    const offenders = sourceFiles(resolve(ROOT, "src"))
      .filter((p) => /(?:from|require\()\s*["'][^"']*\.source-materials/.test(readFileSync(p, "utf8")))
      .map((p) => relative(ROOT, p));
    expect(offenders).toEqual([]);
  });
  it("provenance metadata matches spec", () => {
    const p = JSON.parse(readFileSync(resolve(SNAP, "provenance.json"), "utf8"));
    expect(p.source_package).toBe("IWXA_Domain_Keys_2.0_RU");
    expect(p.package_version).toBe("2.0");
    expect(p.schema_count).toBe(5);
    expect(p.status).toBe("workspace-host-derived-from-domain-keys-2.0");
    expect(Object.keys(p.source_files).sort()).toEqual([...EXPECTED].sort());
    expect(Object.keys(p.derived_files).sort()).toEqual(["domain-shell.schema.json", "workspace-config.schema.json", "workspace-module-manifest.schema.json"].sort());
    for (const name of ["domain-config.schema.json", "domain-key.schema.json"]) {
      expect(p.files[name]).toBe(p.source_files[name]);
    }
    // site-owned was added to the packaged Host derivative; retain the
    // immutable original package hash separately rather than falsifying it.
    expect(p.files["domain-shell.schema.json"]).not.toBe(p.source_files["domain-shell.schema.json"]);
    expect(p.source_files["domain-shell.schema.json"]).toBe("373eb2e67e2888b2243713cb60de3dbfad199def8eb09421845a8e0e729d4c93");
    expect(typeof p.derived_files["domain-shell.schema.json"]).toBe("string");
    expect(Object.keys(p.files).sort()).toEqual([...EXPECTED].sort());
  });
});
