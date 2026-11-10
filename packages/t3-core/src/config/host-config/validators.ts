/**
 * AJV 2020 validators for the three normative Domain Keys 2.0 schemas.
 *
 * Rules (see prompt 07):
 *  - Do not load $schema from the network — AJV runs entirely offline.
 *  - Do not mutate the source schemas.
 *  - Do not strip unknown properties — the schemas already declare
 *    `additionalProperties: false` where required, so anything unknown is an
 *    invalidity, not a silent fix.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import domainSchema from "../schemas/keys-2.0/domain-config.schema.json";
import shellSchema from "../schemas/keys-2.0/domain-shell.schema.json";
import workspaceSchema from "../schemas/keys-2.0/workspace-config.schema.json";

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  loadSchema: () => {
    throw new Error("host-config validator must not load remote $schema");
  },
});
addFormats(ajv);

export interface SchemaValidationResult<T> {
  valid: boolean;
  data: T | null;
  errors: ErrorObject[] | null;
}

function build<T>(schema: unknown): (raw: unknown) => SchemaValidationResult<T> {
  const fn = ajv.compile(schema as object) as ValidateFunction<T>;
  return (raw) => {
    const ok = fn(raw);
    return {
      valid: ok,
      data: ok ? (raw as T) : null,
      errors: ok ? null : (fn.errors ?? []),
    };
  };
}

import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
} from "./types";

export const validateDomainDoc = build<DomainConfigDoc>(domainSchema);
export const validateShellDoc = build<DomainShellDoc>(shellSchema);
export const validateWorkspaceDoc = build<WorkspaceConfigDoc>(workspaceSchema);
