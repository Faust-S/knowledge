// @vitest-environment node
/**
 * IWXA DomainConfig — Workspace projection acceptance matrix.
 *
 * The Workspace does NOT fully validate the domain-kernel configuration
 * contract. It only validates a projection of the fields it needs and
 * accepts the many additional keys present in real production
 * `/_iwxa/domain.json` files via passthrough.
 *
 * This suite exercises the synthetic fixtures under
 * `fixtures/domain-configs/`. The project deliberately does NOT ship
 * real production domain configurations.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertOriginMatch,
  assertProfileBuildEnabled,
  DomainConfigError,
  domainConfigSchema,
  LOCAL_STORE_NAME,
  resolveWorkspaceServiceId,
  SUPPORTED_CONFIG_SCHEMA_VERSION,
  validateDomainConfig,
  WORKSPACE_PROFILES,
} from "../src/config/domain-config";

const FX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "domain-configs");

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(FX_DIR, `${name}.json`), "utf8"));
}

const VALID = [
  "minimal-valid",
  "full-valid",
  "generic",
  "learning",
  "personal",
  "organization",
  "health",
];

const INVALID = [
  { name: "invalid-missing-workspace",   expected: /workspace/i },
  { name: "invalid-origin",              expected: /origin/i },
  { name: "invalid-local-store-name",    expected: /local_store_name|iwxa-local/i },
  { name: "invalid-schema-version",      expected: /config_schema_version|1\.0\.0/i },
];

describe("DomainConfig projection — synthetic fixture matrix", () => {
  it("ships exactly the documented 11 synthetic fixtures", () => {
    const files = readdirSync(FX_DIR).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(
      [...VALID, ...INVALID.map((i) => i.name)]
        .map((n) => `${n}.json`)
        .sort(),
    );
  });

  for (const name of VALID) {
    it(`valid: ${name} passes projection and resolves service_id`, () => {
      const raw = load(name);
      const cfg = validateDomainConfig(raw);
      const sid = resolveWorkspaceServiceId(cfg);
      expect(sid).toMatch(/./);
      expect(cfg.local_store_name).toBe(LOCAL_STORE_NAME);
      expect(cfg.config_schema_version).toBe(SUPPORTED_CONFIG_SCHEMA_VERSION);
    });
  }

  for (const { name, expected } of INVALID) {
    it(`invalid: ${name} is rejected before kernel connect`, () => {
      const raw = load(name);
      const result = domainConfigSchema.safeParse(raw);
      expect(result.success).toBe(false);
      if (!result.success) {
        const flat = JSON.stringify(result.error.issues);
        expect(flat).toMatch(expected);
      }
    });
  }
});

describe("Passthrough — extra kernel-owned fields do not break projection", () => {
  it("accepts a fully-populated production-shape config with runtime, handoff, service_worker, diagnostics, security and release", () => {
    const raw = load("full-valid") as Record<string, unknown>;
    // Sanity: the fixture actually carries all the extra sections.
    for (const key of [
      "config_version",
      "status",
      "runtime",
      "enabled_profiles",
      "handoff",
      "service_worker",
      "diagnostics",
      "security",
      "release",
    ]) {
      expect(raw).toHaveProperty(key);
    }
    const cfg = validateDomainConfig(raw);
    expect(resolveWorkspaceServiceId(cfg)).toBe("synthetic.full.workspace");
    // Passthrough preserves the extra fields.
    const asRecord = cfg as unknown as Record<string, unknown>;
    expect(asRecord.runtime).toBeTypeOf("object");
    expect(asRecord.handoff).toBeTypeOf("object");
    expect(asRecord.service_worker).toBeTypeOf("object");
    expect(asRecord.diagnostics).toBeTypeOf("object");
    expect(asRecord.security).toBeTypeOf("object");
    expect(asRecord.release).toBeTypeOf("object");
  });

  it("accepts arbitrary unknown top-level keys without warnings (kernel-owned)", () => {
    const cfg = validateDomainConfig({
      config_schema_version: "1.0.0",
      domain_id: "x",
      origin: "https://x.example",
      local_store_name: "iwxa-local",
      workspace_profile: "generic",
      brand: "x",
      modules: [{ service_id: "x.ws", base_path: "/workspace/" }],
      enabled_capabilities: ["T0"],
      future_kernel_feature: { anything: true },
      telemetry_pipeline: [1, 2, 3],
    });
    expect((cfg as Record<string, unknown>).future_kernel_feature).toBeDefined();
  });
});

describe("Frozen constants", () => {
  it("config_schema_version is exactly '1.0.0' (no 1.x.y range)", () => {
    expect(SUPPORTED_CONFIG_SCHEMA_VERSION).toBe("1.0.0");
    const bad = { ...(load("minimal-valid") as object), config_schema_version: "1.0.1" };
    expect(domainConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("local_store_name is exactly 'iwxa-local'", () => {
    expect(LOCAL_STORE_NAME).toBe("iwxa-local");
  });
});

describe("Profile enum is the canonical selector", () => {
  it("accepts every documented workspace_profile enum value", () => {
    for (const p of WORKSPACE_PROFILES) {
      const cfg = validateDomainConfig({
        config_schema_version: "1.0.0",
        domain_id: "x",
        origin: "https://x.example",
        local_store_name: "iwxa-local",
        workspace_profile: p,
        brand: "x",
        modules: [{ service_id: "x.ws", base_path: "/workspace/" }],
        enabled_capabilities: ["T0"],
      });
      expect(cfg.workspace_profile).toBe(p);
    }
  });
});

describe("Workspace service_id resolution algorithm", () => {
  it("finds the module whose base_path === '/workspace/'", () => {
    const cfg = validateDomainConfig(load("organization"));
    expect(resolveWorkspaceServiceId(cfg)).toBe("synthetic.organization.workspace");
  });
});

describe("Capability flags gate T1/T2 detection", () => {
  it("minimal fixture is T0-only", () => {
    const cfg = validateDomainConfig(load("minimal-valid"));
    expect(cfg.enabled_capabilities).toEqual(["T0"]);
  });
  it("full fixture advertises T0+T1+T2", () => {
    const cfg = validateDomainConfig(load("full-valid"));
    expect(cfg.enabled_capabilities).toEqual(["T0", "T1", "T2"]);
  });
});

describe("Health profile — dedicated build state, no silent substitution", () => {
  it("throws health_build_required when the build flag is off", () => {
    (import.meta.env as Record<string, unknown>).VITE_ENABLE_HEALTH_PROFILE =
      undefined;
    const cfg = validateDomainConfig(load("health"));
    let caught: unknown;
    try {
      assertProfileBuildEnabled(cfg);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DomainConfigError);
    expect((caught as DomainConfigError).code).toBe("health_build_required");
  });
});

describe("Origin guard", () => {
  it("assertOriginMatch is a no-op in DEV (import.meta.env.DEV)", () => {
    const cfg = validateDomainConfig(load("learning"));
    expect(() => assertOriginMatch(cfg)).not.toThrow();
  });
});
