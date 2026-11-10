import { isSupportedHostRuntimeVersion, SUPPORTED_HOST_RUNTIME_VERSIONS } from "./runtime-binding";
import { CONTRACT_VERSION } from "../../kernel-client/contracts/runtime-1.3.0";
import { diagnostic } from "./errors";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  HostConfigDiagnostic,
  WorkspaceConfigDoc,
} from "./types";

export interface CrossFileInput {
  domain: DomainConfigDoc;
  shell: DomainShellDoc;
  workspace: WorkspaceConfigDoc;
  /** Runtime origin, or null when running outside the browser. */
  runtimeOrigin: string | null;
  /** If true (dev + synthetic fixture), origin match is not enforced. */
  originCheckMode: "enforce" | "skip-synthetic";
}

/**
 * Cross-file invariants required by Domain Keys 2.0 / Prompt 07 §5–6 and
 * Prompt 08 §4–5. These checks run AFTER all three documents have passed
 * schema validation. `originCheckMode` — only synthetic dev fixtures may
 * skip origin identity; a real config in DEV must still be enforced.
 */
export function verifyCrossFileInvariants(
  input: CrossFileInput,
): HostConfigDiagnostic[] {
  const { domain, shell, workspace, runtimeOrigin, originCheckMode } = input;
  const issues: HostConfigDiagnostic[] = [];

  // Domain identity.
  if (
    domain.domain_id !== shell.domain_id ||
    domain.domain_id !== workspace.domain_id
  ) {
    issues.push(
      diagnostic("domain-id-mismatch", {
        domain: domain.domain_id,
        shell: shell.domain_id,
        workspace: workspace.domain_id,
      }),
    );
  }

  // Origin identity — three-way plus, in production, runtime.
  if (domain.origin !== shell.origin) {
    issues.push(
      diagnostic("origin-mismatch", {
        source: "domain-vs-shell",
        domain: domain.origin,
        shell: shell.origin,
      }),
    );
  }
  if (originCheckMode === "enforce" && runtimeOrigin) {
    if (domain.origin !== runtimeOrigin || shell.origin !== runtimeOrigin) {
      issues.push(
        diagnostic("origin-mismatch", {
          source: "runtime",
          runtime: runtimeOrigin,
          domain: domain.origin,
          shell: shell.origin,
        }),
      );
    }
  }

  // Workspace ↔ Domain module identity.
  const wsService = workspace.workspace_service_id;
  const wsModule = domain.modules.find(
    (m) => m.base_path === "/workspace/" && m.service_id === wsService,
  );
  if (!wsModule) {
    issues.push(
      diagnostic("workspace-service-mismatch", {
        expected_service_id: wsService,
        modules: domain.modules.map((m) => ({
          service_id: m.service_id,
          base_path: m.base_path,
        })),
      }),
    );
  }

  // Profile invariants (Prompt 08 §4).
  if (domain.workspace_profile !== workspace.profile) {
    issues.push(
      diagnostic("workspace-profile-mismatch", {
        domain: domain.workspace_profile,
        workspace: workspace.profile,
      }),
    );
  }
  if (!domain.enabled_profiles.includes(workspace.profile)) {
    issues.push(
      diagnostic("workspace-profile-disabled", {
        workspace_profile: workspace.profile,
        enabled_profiles: domain.enabled_profiles,
      }),
    );
  }

  // Runtime & Local Store invariants (Prompt 08 §5).
  const domainRt = domain.runtime.runtime_version;
  const wsRt = workspace.host.required_runtime_version;
  if (domainRt !== wsRt || !isSupportedHostRuntimeVersion(domainRt) || !isSupportedHostRuntimeVersion(wsRt)) {
    issues.push(
      diagnostic("runtime-version-mismatch", {
        domain_runtime_version: domainRt,
        workspace_required_runtime_version: wsRt,
        expected: SUPPORTED_HOST_RUNTIME_VERSIONS,
      }),
    );
  }
  if (
    domain.local_store_name !== workspace.host.local_store_name ||
    domain.local_store_name !== "iwxa-local"
  ) {
    issues.push(
      diagnostic("local-store-name-mismatch", {
        domain: domain.local_store_name,
        workspace: workspace.host.local_store_name,
        expected: "iwxa-local",
      }),
    );
  }

  // Storage / Host policy — schemas already gate these as consts, but we
  // re-assert here so cross-file diagnostics carry the right code.
  const host = workspace.host;
  if (
    host.local_store_name !== "iwxa-local" ||
    host.storage_access !== "iwxa-client-only" ||
    host.direct_indexeddb !== false
  ) {
    issues.push(diagnostic("unsafe-storage-policy", { host }));
  }
  if (host.required_contract_version !== CONTRACT_VERSION) {
    issues.push(
      diagnostic("contract-version-mismatch", {
        got: host.required_contract_version,
        expected: CONTRACT_VERSION,
      }),
    );
  }
  if (!isSupportedHostRuntimeVersion(host.required_runtime_version)) {
    issues.push(
      diagnostic("runtime-version-mismatch", {
        source: "workspace-host",
        got: host.required_runtime_version,
        expected: SUPPORTED_HOST_RUNTIME_VERSIONS,
      }),
    );
  }

  // Module security.
  const ml = workspace.module_loading;
  const sec = workspace.security;
  if (
    ml.strategy !== "compile-time-registry" ||
    ml.allow_remote_modules !== false ||
    ml.lazy_loading !== "dynamic-import" ||
    ml.unknown_module_policy !== "disable-with-diagnostics" ||
    sec.trusted_build_modules_only !== true ||
    sec.module_direct_indexeddb !== false ||
    sec.executable_code_in_iwxa !== false ||
    sec.remote_module_urls !== false
  ) {
    issues.push(
      diagnostic("unsafe-module-policy", { module_loading: ml, security: sec }),
    );
  }

  // base_path + shell_config_path (schema-const, re-asserted for diagnostics).
  if (workspace.base_path !== "/workspace/") {
    issues.push(diagnostic("workspace-schema-invalid", { base_path: workspace.base_path }));
  }
  if (workspace.shell_config_path !== "/_iwxa/domain-shell.json") {
    issues.push(
      diagnostic("workspace-schema-invalid", {
        shell_config_path: workspace.shell_config_path,
      }),
    );
  }

  return issues;
}
