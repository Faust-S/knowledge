import type { SupportedHostRuntimeVersion } from "./runtime-binding";

/**
 * Host configuration triad (Domain Keys 2.0).
 *
 * Three host-owned configuration files, kept SEPARATE — never merged into
 * a synthetic contract record:
 *
 *   /_iwxa/domain.json          → DomainConfigDoc   (kernel, storage, security)
 *   /_iwxa/domain-shell.json    → DomainShellDoc    (brand, theme, chrome)
 *   /workspace/workspace.config.json → WorkspaceConfigDoc (profile, host policy, modules)
 *
 * The IWXA Workspace only reads these documents — it does not own or
 * regenerate them. Types below are intentionally narrower than the JSON
 * Schemas: they describe the validated view the Workspace consumes.
 * Normative validation is performed by AJV against the schemas in
 * src/config/schemas/keys-2.0/.
 */

export interface DomainConfigModule {
  service_id: string;
  base_path: string;
  [key: string]: unknown;
}

/**
 * Runtime block inside domain.json.
 *
 * `runtime_version` is normatively required by the loader — an absent or
 * empty value is reported as `domain-schema-invalid`, not silently accepted.
 * The type therefore keeps the field required.
 */
export interface DomainRuntimeBlock {
  kernel_release: string;
  runtime_version: string;
  local_store_version: string;
  package_version: string;
  current_manifest_path: string;
}

export interface DomainConfigDoc {
  config_schema_version: "1.0.0";
  config_version: string;
  status: string;
  domain_id: string;
  origin: string;
  local_store_name: "iwxa-local";
  workspace_profile: string;
  brand: string | Record<string, unknown>;
  runtime: DomainRuntimeBlock;
  modules: DomainConfigModule[];
  enabled_profiles: string[];
  enabled_capabilities: Array<"T0" | "T1" | "T2">;
  handoff: Record<string, unknown>;
  service_worker: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  security: Record<string, unknown>;
  release: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DomainShellDoc {
  shell_schema_version: "1.0.0";
  config_version: string;
  domain_id: string;
  origin: string;
  brand: {
    name: string;
    short_name: string;
    descriptor: string;
    home_path: string;
    logo_path: string;
    favicon_path: string;
  };
  theme: Record<string, unknown>;
  layout: Record<string, unknown>;
  navigation: Record<string, unknown>;
  workspace_entry: {
    id: "workspace";
    label: string;
    path: "/workspace/";
    placement: "primary" | "utility" | "cta";
  };
  accessibility: Record<string, unknown>;
  release: Record<string, unknown>;
}

export interface WorkspaceConfigDoc {
  workspace_config_schema_version: "1.0.0";
  config_version: string;
  domain_id: string;
  workspace_service_id: string;
  base_path: "/workspace/";
  profile: "generic" | "learning" | "personal" | "organization" | "health";
  shell_config_path: "/_iwxa/domain-shell.json";
  host: {
    required_contract_version: "1.3.0";
    required_runtime_version: SupportedHostRuntimeVersion;
    local_store_name: "iwxa-local";
    storage_access: "iwxa-client-only";
    direct_indexeddb: false;
  };
  module_loading: {
    strategy: "compile-time-registry";
    allow_remote_modules: false;
    lazy_loading: "dynamic-import";
    unknown_module_policy: "disable-with-diagnostics";
  };
  navigation: Record<string, unknown>;
  terminology: Record<string, string>;
  modules: Array<Record<string, unknown>>;
  unknown_objects: Record<string, unknown>;
  security: {
    trusted_build_modules_only: true;
    module_direct_indexeddb: false;
    executable_code_in_iwxa: false;
    remote_module_urls: false;
  };
  release: Record<string, unknown>;
}

/**
 * Public host-config load status. `limited` was reserved for a future
 * non-blocking degraded mode but never emitted; at this stage all three
 * files are required so we keep the union tight to only reachable values.
 */
export type HostConfigStatus = "idle" | "loading" | "ready" | "error";

export type HostConfigDiagnosticCode =
  | "domain-config-missing"
  | "domain-shell-missing"
  | "workspace-config-missing"
  | "domain-schema-invalid"
  | "shell-schema-invalid"
  | "workspace-schema-invalid"
  | "domain-id-mismatch"
  | "origin-mismatch"
  | "workspace-service-mismatch"
  | "workspace-profile-mismatch"
  | "workspace-profile-disabled"
  | "runtime-version-mismatch"
  | "contract-version-mismatch"
  | "local-store-name-mismatch"
  | "unsafe-module-policy"
  | "unsafe-storage-policy"
  | "domain-config-invalid-json"
  | "shell-config-invalid-json"
  | "workspace-config-invalid-json"
  | "domain-config-http-error"
  | "shell-config-http-error"
  | "workspace-config-http-error";

export interface HostConfigDiagnostic {
  code: HostConfigDiagnosticCode;
  /** Short public message safe to render in the UI. */
  message: string;
  /** Structured internal details — MUST stay inside a closed <details>. */
  details?: unknown;
}

export interface HostConfigResult {
  status: HostConfigStatus;
  domain: DomainConfigDoc | null;
  shell: DomainShellDoc | null;
  workspace: WorkspaceConfigDoc | null;
  /** All source, schema, and cross-file diagnostics discovered this load. */
  diagnostics: HostConfigDiagnostic[];
  /** First blocking diagnostic. Non-fatal issues stay only in diagnostics. */
  error: HostConfigDiagnostic | null;
  /** Which dev fixture set produced this result, else null. */
  fixture: string | null;
}
