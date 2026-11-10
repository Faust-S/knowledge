import { z } from "zod";
import type { ValidationIssue, ValidationResult } from "./types";
import type {
  EmbeddedSchemaReference,
  ServiceSchemaDeclaration,
} from "@/public-contract";

/**
 * Canonical Zod schema for a Service Passport (T0-T2 module manifest).
 *
 * Single source of truth for what a valid passport looks like. Every
 * consumer — build-time service catalog, external deployment validator,
 * runtime `connect`, diagnostic UI, and every test — MUST route through
 * `validateServicePassport` (or `ServicePassportSchema`).
 */

export const LevelSchema = z.enum(["T0", "T1", "T2"]);
export type Level = z.infer<typeof LevelSchema>;

// Unified canonical ID patterns (see §3 of the final schema-model spec).
export const SERVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const SCHEMA_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const OBJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const RELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ASSET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export const ServiceIdSchema = z
  .string()
  .regex(SERVICE_ID_RE, "service_id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
  .refine((s) => !s.includes(".."), "service_id must not contain '..'")
  .refine((s) => !s.includes("/") && !s.includes("\\"), "service_id must not contain '/' or '\\'")
  .refine((s) => !s.includes(":"), "service_id must not contain ':'");

export const SchemaIdSchema = z
  .string()
  .regex(SCHEMA_ID_RE, "schema_id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
  .refine((s) => !s.includes(".."), "schema_id must not contain '..'")
  .refine((s) => !s.includes("/") && !s.includes("\\"), "schema_id must not contain '/' or '\\'")
  .refine((s) => !s.includes(":"), "schema_id must not contain ':'");

export const BasePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/[A-Za-z0-9._\-/]*$/, "base_path must start with '/' and be url-safe");

export const ObjectTypeSchema = SchemaIdSchema;

/**
 * Permission arrays hold exact `schema_id` strings, or the single literal
 * "*" for an explicit wildcard.
 */
const SchemaPermissionListSchema = z
  .array(z.string().min(1).max(128))
  .max(256)
  .refine(
    (list) => list.every((s) => s === "*" || SCHEMA_ID_RE.test(s)),
    "permission entries must be '*' or valid schema ids",
  );

export const ExportPackageScopeSchema = z.enum(["readable_objects", "workspace"]);
export const ImportPackageScopeSchema = z.enum(["writable_objects", "workspace"]);
export type ExportPackageScope = z.infer<typeof ExportPackageScopeSchema>;
export type ImportPackageScope = z.infer<typeof ImportPackageScopeSchema>;

export const ServicePermissionsSchema = z
  .object({
    operations: z.array(z.literal("t1.commitObjectGraph")).max(1).optional(),
    workspace: z
      .object({
        list: z.boolean(),
        read: z.boolean(),
        create: z.boolean(),
        soft_delete: z.boolean(),
        restore: z.boolean(),
        purge: z.boolean(),
      })
      .strict(),
    objects: z
      .object({
        read: SchemaPermissionListSchema,
        write: SchemaPermissionListSchema,
        delete: SchemaPermissionListSchema,
      })
      .strict(),
    events: z
      .object({
        read_scope: z.enum(["service", "workspace"]),
      })
      .strict(),
    packages: z
      .object({
        export: z.boolean(),
        import: z.boolean(),
        export_scope: ExportPackageScopeSchema,
        import_scope: ImportPackageScopeSchema,
      })
      .strict(),
  })
  .strict();

export type ServicePermissions = z.infer<typeof ServicePermissionsSchema>;

// ---------------------------------------------------------------------------
// ServiceSchemaDeclaration (see §1 of the final schema-model spec).
// ---------------------------------------------------------------------------

const EmbeddedSchemaReferenceSchema: z.ZodType<EmbeddedSchemaReference> = z
  .object({
    schema_id: SchemaIdSchema,
    schema_version: z.string().regex(SEMVER_RE, "schema_version must be semver x.y.z"),
  })
  .strict();

/** Enforces the semantic rules a JSON Schema declaration must obey. */
const JsonSchemaObjectShape = z
  .object({
    type: z.literal("object"),
    additionalProperties: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
  })
  .catchall(z.unknown());

export const ServiceSchemaDeclarationSchema: z.ZodType<ServiceSchemaDeclaration> = z
  .object({
    schema_version: z.string().regex(SEMVER_RE, "schema_version must be semver x.y.z"),
    preserve_unknown: z.boolean(),
    json_schema: JsonSchemaObjectShape,
    embedded: z.record(z.string(), EmbeddedSchemaReferenceSchema),
  })
  .strict()
  .superRefine((decl, ctx) => {
    // A stray `version` next to JSON Schema keys is a common confusion
    // between "schema declaration version" and JSON Schema `$id`.
    if ("version" in decl.json_schema) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["json_schema", "version"],
        message:
          "do not put 'version' inside json_schema; use the outer schema_version",
      });
    }
    const ap = (decl.json_schema as { additionalProperties?: unknown })
      .additionalProperties;
    if (decl.preserve_unknown === false) {
      if (ap !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["json_schema", "additionalProperties"],
          message:
            "preserve_unknown=false requires json_schema.additionalProperties === false",
        });
      }
    } else {
      // preserve_unknown = true: allow true or a subschema, but reject
      // the explicit `false` which contradicts the declared policy.
      if (ap === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["json_schema", "additionalProperties"],
          message:
            "preserve_unknown=true forbids json_schema.additionalProperties === false",
        });
      }
    }
  }) as unknown as z.ZodType<ServiceSchemaDeclaration>;

/**
 * Trusted-universal-Workspace test.
 */
export function isTrustedWorkspacePassport(p: {
  service_id: string;
  base_path: string;
  permissions: ServicePermissions;
}): boolean {
  const pm = p.permissions;
  const oneStar = (list: string[]) => list.length === 1 && list[0] === "*";
  return (
    p.base_path === "/workspace/" &&
    p.service_id.endsWith(".workspace") &&
    oneStar(pm.objects.read) &&
    oneStar(pm.objects.write) &&
    oneStar(pm.objects.delete) &&
    pm.events.read_scope === "workspace" &&
    pm.workspace.restore === true &&
    pm.workspace.purge === true
  );
}

export const ServicePassportSchema = z
  .object({
    service_id: ServiceIdSchema,
    service_version: z.string().min(1).max(32),
    base_path: BasePathSchema,
    supported_levels: z.array(LevelSchema).min(1).max(3),
    input_object_types: z.array(ObjectTypeSchema).max(256),
    output_object_types: z.array(ObjectTypeSchema).max(256),
    schemas: z.record(SchemaIdSchema, ServiceSchemaDeclarationSchema),
    permissions: ServicePermissionsSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.supported_levels).size !== p.supported_levels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supported_levels"],
        message: "supported_levels must not contain duplicates",
      });
    }

    // Every schema declaration key must exactly match its value's schema_id
    // context — the key IS the schema_id (no value.schema_id field to check).
    // But every declared schema must be referenced by input/output types.
    const io = new Set([...p.input_object_types, ...p.output_object_types]);
    const out = new Set(p.output_object_types);
    for (const schema_id of Object.keys(p.schemas)) {
      if (!io.has(schema_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schemas", schema_id],
          message:
            `declared schema "${schema_id}" is not listed in input_object_types or output_object_types`,
        });
      }
    }

    // Every output_object_types entry MUST have a local declaration —
    // outputs are what the service produces, so it owns their shape.
    for (const t of p.output_object_types) {
      if (!(t in p.schemas)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["output_object_types"],
          message: `output type "${t}" is missing a declaration in schemas`,
        });
      }
    }
    // Every writable/deletable non-wildcard schema requires a declaration.
    for (const s of p.permissions.objects.write) {
      if (s === "*") continue;
      if (!(s in p.schemas)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissions", "objects", "write"],
          message: `writable schema "${s}" requires a local declaration in schemas`,
        });
      }
    }
    for (const s of p.permissions.objects.delete) {
      if (s === "*") continue;
      if (!(s in p.schemas)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissions", "objects", "delete"],
          message: `deletable schema "${s}" requires a local declaration in schemas`,
        });
      }
    }

    // Permissions must refer to declared types (except wildcard).
    const check = (
      list: string[],
      allowed: Set<string>,
      allowedName: string,
      path: string,
    ) => {
      for (const s of list) {
        if (s === "*") continue;
        if (!allowed.has(s)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["permissions", ...path.split(".")],
            message:
              `permissions.${path} entry "${s}" is not declared in ${allowedName}`,
          });
        }
      }
    };
    check(p.permissions.objects.read, io, "input_object_types + output_object_types", "objects.read");
    check(p.permissions.objects.write, out, "output_object_types", "objects.write");
    check(p.permissions.objects.delete, out, "output_object_types", "objects.delete");

    // Trusted-Workspace rule.
    const trusted = isTrustedWorkspacePassport(p);
    const explain =
      'workspace scope requires base_path="/workspace/", service_id ending ".workspace", ' +
      'objects.{read,write,delete}=["*"], events.read_scope="workspace", ' +
      "workspace.restore=true, workspace.purge=true";
    if (p.permissions.packages.export_scope === "workspace" && !trusted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions", "packages", "export_scope"],
        message: 'export_scope="workspace" is not permitted: ' + explain,
      });
    }
    if (p.permissions.packages.import_scope === "workspace" && !trusted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions", "packages", "import_scope"],
        message: 'import_scope="workspace" is not permitted: ' + explain,
      });
    }
  });

export type ServicePassport = z.infer<typeof ServicePassportSchema>;

function issuesFromZod(err: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.map(String).join(".") || "(root)",
    message: i.message,
  }));
}

/** Metadata returned alongside a validated passport. */
export type PassportValidationMeta = {
  /** Input types whose schema was NOT declared locally. The DomainSchema
   *  Registry resolves these against sibling modules; unresolved refs
   *  block `connect`. */
  unresolved_external_inputs: string[];
};

export function validateServicePassport(
  raw: unknown,
  opts: { expected_service_id?: string } = {},
): ValidationResult<ServicePassport> & { meta?: PassportValidationMeta } {
  const parsed = ServicePassportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: issuesFromZod(parsed.error) };
  }
  if (opts.expected_service_id && parsed.data.service_id !== opts.expected_service_id) {
    return {
      ok: false,
      errors: [
        {
          path: "service_id",
          message:
            `passport.service_id "${parsed.data.service_id}" does not match ` +
            `expected "${opts.expected_service_id}"`,
        },
      ],
    };
  }
  const declared = new Set(Object.keys(parsed.data.schemas));
  const unresolved_external_inputs = parsed.data.input_object_types.filter(
    (t) => !declared.has(t),
  );
  return {
    ok: true,
    value: parsed.data,
    meta: { unresolved_external_inputs },
  };
}
