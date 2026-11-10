/**
 * Legacy projection only. Not a configuration loader.
 *
 * Legacy DomainConfig validation fixture utility (NOT a loader).
 *
 * Historic role: this module used to fetch `/_iwxa/domain.json` and shape
 * a synthesised "merged" contract for the Workspace shell. Both roles are
 * gone. The tri-document Domain Keys 2.0 controller in
 * `./host-config/` is the ONLY source of runtime configuration.
 *
 * What remains here is a compact validation surface used exclusively by
 * legacy fixture tests under `tests/domain-config.test.ts`. Nothing in the
 * production `App` / `AppShell` / `Header` bundle imports from this file.
 *
 * The tri-document runtime path re-exports profile identifiers from
 * `./workspace-profiles.ts`; the same re-exports are provided here strictly
 * to keep the legacy fixture tests compiling. New code MUST import profile
 * identifiers from `./workspace-profiles.ts` directly.
 */
import { z } from "zod";
import {
  CAPABILITIES,
  LOCAL_STORE_NAME,
  WORKSPACE_PROFILES,
  type Capability,
  type WorkspaceProfileId,
} from "./workspace-profiles";

export {
  CAPABILITIES,
  LOCAL_STORE_NAME,
  WORKSPACE_PROFILES,
  type Capability,
  type WorkspaceProfileId,
};

/** Frozen projection schema version this Workspace understands. */
export const SUPPORTED_CONFIG_SCHEMA_VERSION = "1.0.0" as const;

export const domainModuleSchema = z
  .object({
    service_id: z.string().min(1),
    base_path: z
      .string()
      .regex(/^\/[a-z0-9/_-]*\/$/i, "base_path must start and end with '/'"),
    title: z.string().min(1).optional(),
  })
  .passthrough();

export const domainConfigSchema = z
  .object({
    config_schema_version: z.literal(SUPPORTED_CONFIG_SCHEMA_VERSION),
    domain_id: z.string().min(1),
    origin: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), {
        message: "origin must be an https URL (http://localhost allowed in dev)",
      }),
    local_store_name: z.literal(LOCAL_STORE_NAME),
    workspace_profile: z.enum(WORKSPACE_PROFILES),
    brand: z.string().min(1),
    modules: z.array(domainModuleSchema).min(1),
    enabled_capabilities: z.array(z.enum(CAPABILITIES)).min(1),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const ws = v.modules.find((m) => m.base_path === "/workspace/");
    if (!ws) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules"],
        message: 'modules must contain an entry with base_path === "/workspace/"',
      });
    }
  });

export type DomainConfig = z.infer<typeof domainConfigSchema>;

export function resolveWorkspaceServiceId(config: DomainConfig): string {
  const mod = config.modules.find((m) => m.base_path === "/workspace/");
  if (!mod) {
    throw new Error(
      'DomainConfig has no module with base_path === "/workspace/"',
    );
  }
  return mod.service_id;
}

export function hasCapability(config: DomainConfig, cap: Capability): boolean {
  return config.enabled_capabilities.includes(cap);
}

export type DomainConfigErrorCode =
  | "config_missing"
  | "config_parse_failed"
  | "config_invalid"
  | "origin_mismatch"
  | "health_build_required";

export class DomainConfigError extends Error {
  constructor(
    public readonly code: DomainConfigErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainConfigError";
  }
}

export function validateDomainConfig(raw: unknown): DomainConfig {
  const result = domainConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new DomainConfigError(
      "config_invalid",
      "DomainConfig failed projection validation",
      result.error.issues,
    );
  }
  return result.data;
}

/** Origin identity is enforced by the host-config controller in production. */
export function assertOriginMatch(_config: DomainConfig): void {
  /* no-op — retained for legacy fixture tests only */
}

export function assertProfileBuildEnabled(config: DomainConfig): void {
  if (config.workspace_profile !== "health") return;
  const flag = (import.meta.env.VITE_ENABLE_HEALTH_PROFILE as string | undefined)
    ?.toLowerCase();
  if (flag !== "true" && flag !== "1") {
    throw new DomainConfigError(
      "health_build_required",
      "DomainConfig requests the health profile but this build was compiled without VITE_ENABLE_HEALTH_PROFILE=true",
    );
  }
}
