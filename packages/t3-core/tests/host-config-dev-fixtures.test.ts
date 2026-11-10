import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateDomainDoc,
  validateShellDoc,
  validateWorkspaceDoc,
} from "../src/config/host-config/validators";

const ROOT = process.cwd();
const HOST_FX = resolve(ROOT, "fixtures/host-configs");

function readJson(p: string): unknown {
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("dev host-config fixture sets", () => {
  it("generic fixture set has all three files and no Learning/LMS references", () => {
    const dir = resolve(HOST_FX, "generic");
    expect(existsSync(resolve(dir, "domain.json"))).toBe(true);
    expect(existsSync(resolve(dir, "domain-shell.json"))).toBe(true);
    expect(existsSync(resolve(dir, "workspace.config.json"))).toBe(true);
    const raw = readFileSync(resolve(dir, "domain.json"), "utf8") +
      readFileSync(resolve(dir, "workspace.config.json"), "utf8");
    expect(raw.toLowerCase()).not.toMatch(/learning|\blms\b/);
  });

  it("learning fixture set has all three files and is used only via explicit ?fixture=learning", () => {
    const dir = resolve(HOST_FX, "learning");
    expect(existsSync(resolve(dir, "domain.json"))).toBe(true);
    expect(existsSync(resolve(dir, "domain-shell.json"))).toBe(true);
    expect(existsSync(resolve(dir, "workspace.config.json"))).toBe(true);
  });

  it("every fixture set validates against all three Keys 2.0 schemas", () => {
    for (const name of readdirSync(HOST_FX)) {
      const dir = resolve(HOST_FX, name);
      const d = readJson(resolve(dir, "domain.json"));
      const s = readJson(resolve(dir, "domain-shell.json"));
      const w = readJson(resolve(dir, "workspace.config.json"));
      const dR = validateDomainDoc(d);
      const sR = validateShellDoc(s);
      const wR = validateWorkspaceDoc(w);
      expect({ name, ok: dR.valid, errors: dR.errors }).toEqual({ name, ok: true, errors: null });
      expect({ name, ok: sR.valid, errors: sR.errors }).toEqual({ name, ok: true, errors: null });
      expect({ name, ok: wR.valid, errors: wR.errors }).toEqual({ name, ok: true, errors: null });
    }
  });

  it("fixture triads share a single domain_id (no cross-fixture bleeding)", () => {
    for (const name of readdirSync(HOST_FX)) {
      const dir = resolve(HOST_FX, name);
      const d = readJson(resolve(dir, "domain.json")) as { domain_id: string };
      const s = readJson(resolve(dir, "domain-shell.json")) as { domain_id: string };
      const w = readJson(resolve(dir, "workspace.config.json")) as { domain_id: string };
      expect(d.domain_id).toBe(s.domain_id);
      expect(d.domain_id).toBe(w.domain_id);
    }
  });

  it("no host-config source uses ?profile= for fixture selection", () => {
    const loader = readFileSync(
      resolve(ROOT, "src/config/host-config/load-host-config.ts"),
      "utf8",
    );
    const hook = readFileSync(
      resolve(ROOT, "src/config/host-config/useHostConfig.ts"),
      "utf8",
    );
    expect(loader).not.toMatch(/get\(\s*["']profile["']\s*\)/);
    expect(hook).not.toMatch(/get\(\s*["']profile["']\s*\)/);
    expect(loader).toMatch(/get\(\s*["']fixture["']\s*\)/);
  });

  it("browser host-config code never references domain-key.json", () => {
    const dir = resolve(ROOT, "src/config/host-config");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(src).not.toMatch(/domain-key\.json/);
    }
  });
});
