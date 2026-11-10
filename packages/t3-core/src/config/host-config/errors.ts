import type {
  HostConfigDiagnostic,
  HostConfigDiagnosticCode,
} from "./types";

/**
 * Public, user-safe messages. They deliberately avoid disclosing Service
 * Passports, module_ids, service_ids, allowed_object_classes, or any other
 * detail the host does not want to advertise. Technical detail belongs
 * inside a closed <details> block populated from `HostConfigDiagnostic.details`.
 */
const MESSAGES: Record<HostConfigDiagnosticCode, string> = {
  "domain-config-missing":
    "The domain configuration for this Workspace is not published yet.",
  "domain-shell-missing":
    "The domain shell configuration for this Workspace is not published yet.",
  "workspace-config-missing":
    "The Workspace configuration file is not published yet.",
  "domain-schema-invalid":
    "The domain configuration does not match the Domain Keys 2.0 schema.",
  "shell-schema-invalid":
    "The domain shell configuration does not match the Domain Keys 2.0 schema.",
  "workspace-schema-invalid":
    "The Workspace configuration does not match the Domain Keys 2.0 schema.",
  "domain-id-mismatch":
    "The three host configuration files describe different domains.",
  "origin-mismatch":
    "The host configuration origin does not match the running site.",
  "workspace-service-mismatch":
    "The Workspace configuration is not linked to a valid Workspace module in the domain.",
  "workspace-profile-mismatch":
    "Профиль Workspace не совпадает с профилем, объявленным доменом.",
  "workspace-profile-disabled":
    "Профиль Workspace не включён в конфигурации домена.",
  "runtime-version-mismatch":
    "The Workspace was built against a different runtime version than the domain expects.",
  "contract-version-mismatch":
    "The Workspace was built against a different Kernel contract than the domain expects.",
  "local-store-name-mismatch":
    "The domain and Workspace disagree about the local store name.",
  "unsafe-module-policy":
    "The Workspace module policy allows remote or untrusted modules and cannot be used.",
  "unsafe-storage-policy":
    "The Workspace storage policy conflicts with the iwxa-client-only rule and cannot be used.",
  "domain-config-invalid-json":
    "The domain configuration file is not valid JSON.",
  "shell-config-invalid-json":
    "The domain shell configuration file is not valid JSON.",
  "workspace-config-invalid-json":
    "The Workspace configuration file is not valid JSON.",
  "domain-config-http-error":
    "The domain configuration file could not be downloaded.",
  "shell-config-http-error":
    "The domain shell configuration file could not be downloaded.",
  "workspace-config-http-error":
    "The Workspace configuration file could not be downloaded.",
};

export function diagnostic(
  code: HostConfigDiagnosticCode,
  details?: unknown,
): HostConfigDiagnostic {
  return { code, message: MESSAGES[code], details };
}

/**
 * Error wrapper that carries a full HostConfigDiagnostic through the
 * React error surface without losing the diagnostic code or details.
 * Prefer this over `new Error(diagnostic.message)` — the ErrorPage devtools
 * pane consumes `error.cause` to render technical context.
 */
export class HostConfigError extends Error {
  public readonly code: HostConfigDiagnostic["code"];
  constructor(public readonly diagnostic: HostConfigDiagnostic) {
    super(diagnostic.message, { cause: diagnostic.details });
    this.name = "HostConfigError";
    this.code = diagnostic.code;
  }
}
