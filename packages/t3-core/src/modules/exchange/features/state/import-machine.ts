/**
 * Import flow state machine (PROMPT 23 §8–§14, PROMPT 32 §2).
 *
 * Canonical states:
 *   idle → previewing → preview-ready → validating → committing
 *        → committed
 *   * → cancelled | expired | error
 *
 * The machine holds NO package bytes past `previewing`. Only the
 * server-issued preview token / digests / structural preview survive.
 * Every file change or explicit cancel disposes the current token.
 */

import type {
  ImportMode,
  ConflictPolicy,
  ImportPreview,
  ImportReceipt,
  ImportPlan,
} from "@/kernel-client/contracts/runtime-1.3.0";

export type ImportStatus =
  | "idle"
  | "previewing"
  | "preview-ready"
  | "validating"
  | "committing"
  | "committed"
  | "incomplete"
  | "unconfirmed"
  | "cancelled"
  | "expired"
  | "error";

export interface ImportPreviewHandle {
  readonly preview_token: string;
  readonly package_digest: string;
  readonly semantic_digest: string;
  readonly expires_at: string;
  readonly allowed_modes: ReadonlyArray<ImportMode>;
  readonly preview: ImportPreview;
}

export interface ImportPlanForm {
  readonly mode: ImportMode;
  readonly conflict: ConflictPolicy;
  readonly include_workspaces: ReadonlyArray<string>;
  readonly include_history: boolean;
  readonly include_assets: boolean;
  readonly include_relations: boolean;
  /** §11 selective: subset of objects `workspace_id/object_id`. Empty = all. */
  readonly include_objects?: ReadonlyArray<`${string}/${string}`>;
  /** §11 new-workspace: src → dst workspace_id mapping. */
  readonly workspace_id_map?: Readonly<Record<string, string>>;
  /** §11 merge: local target workspace_id to receive the incoming payload. */
  readonly target_workspace?: string | null;
}

export interface ImportState {
  readonly status: ImportStatus;
  readonly handle: ImportPreviewHandle | null;
  readonly plan: ImportPlanForm;
  readonly receipt: ImportReceipt | null;
  readonly error: string | null;
  readonly planValidation: ReadonlyArray<string>;
}

export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = "fail";

export const INITIAL_PLAN: ImportPlanForm = Object.freeze({
  mode: "selective",
  conflict: DEFAULT_CONFLICT_POLICY,
  include_workspaces: Object.freeze([]) as ReadonlyArray<string>,
  include_history: true,
  include_assets: true,
  include_relations: true,
  include_objects: Object.freeze([]) as ReadonlyArray<`${string}/${string}`>,
  workspace_id_map: Object.freeze({}) as Readonly<Record<string, string>>,
  target_workspace: null,
});

export const INITIAL_IMPORT_STATE: ImportState = Object.freeze({
  status: "idle",
  handle: null,
  plan: INITIAL_PLAN,
  receipt: null,
  error: null,
  planValidation: Object.freeze([]) as ReadonlyArray<string>,
});

export type ImportEvent =
  | { type: "preview-started" }
  | { type: "preview-succeeded"; handle: ImportPreviewHandle; preferredTargetWorkspaceId?: string | null }
  | { type: "preview-failed"; error: string }
  | { type: "set-plan"; plan: Partial<ImportPlanForm> }
  | { type: "validate-plan"; localWorkspaceIds?: ReadonlyArray<string> }
  | { type: "commit-started" }
  | { type: "commit-succeeded"; receipt: ImportReceipt }
  | { type: "commit-incomplete"; receipt: ImportReceipt; error: string }
  | { type: "commit-unconfirmed"; receipt: ImportReceipt; error: string }
  | { type: "commit-retryable"; error: string }
  | { type: "commit-invalid"; error: string }
  | { type: "commit-failed"; error: string }
  | { type: "cancel"; reason: "explicit" | "new-file" | "unmount" | "session-change" }
  | { type: "cancel-failed"; error: string }
  | { type: "expire" }
  | { type: "reset" };

function previewObjectKeysFromHandle(
  handle: ImportPreviewHandle,
): ReadonlyArray<string> {
  const objects = handle.preview.objects ?? [];
  return objects.map((o) => `${o.workspace_id}/${o.object_id}`);
}

/**
 * Local shape check for an ImportPlan (§12, PROMPT 32 §2).
 * Returns a list of human-readable issue messages. Empty = valid.
 */
export function validateImportPlan(
  plan: ImportPlanForm,
  allowedModes: ReadonlyArray<ImportMode>,
  previewWorkspaces: ReadonlyArray<string>,
  previewObjectKeys: ReadonlyArray<string>,
  localWorkspaceIds: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const issues: string[] = [];
  if (!allowedModes.includes(plan.mode)) {
    issues.push(`mode "${plan.mode}" не входит в allowed_modes ядра`);
  }
  if (plan.mode === "selective") {
    if (plan.include_workspaces.length === 0) {
      issues.push("selective mode требует минимум одну рабочую область");
    }
    const known = new Set(previewWorkspaces);
    for (const w of plan.include_workspaces) {
      if (!known.has(w)) issues.push(`workspace ${w} отсутствует в предпросмотре пакета`);
    }
    const knownObjects = new Set(previewObjectKeys);
    for (const key of plan.include_objects ?? []) {
      if (!knownObjects.has(key)) {
        issues.push(`объект ${key} отсутствует в предпросмотре пакета`);
        continue;
      }
      const slash = key.indexOf("/");
      const workspaceId = slash > 0 ? key.slice(0, slash) : "";
      if (!workspaceId || !plan.include_workspaces.includes(workspaceId)) {
        issues.push(`объект ${key} вне выбранных рабочих областей`);
      }
    }
  }
  if (plan.mode === "new-workspace") {
    const map = plan.workspace_id_map ?? {};
    const seen = new Set<string>();
    for (const src of previewWorkspaces) {
      const dst = map[src];
      if (!dst || dst.trim() === "") {
        issues.push(`new-workspace: не задан целевой workspace_id для "${src}"`);
        continue;
      }
      if (seen.has(dst)) {
        issues.push(`new-workspace: целевой workspace_id "${dst}" встречается дважды`);
      }
      seen.add(dst);
    }
    const localIds = new Set(localWorkspaceIds);
    for (const dst of Object.values(map)) {
      // Workspace ids share the Kernel 0.3.6 grammar (including ":"), not an unrelated UI subset.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(dst)) {
        issues.push(`некорректный целевой workspace_id "${dst}"`);
      }
      if (localIds.has(dst)) {
        issues.push(`workspace_id "${dst}" уже существует локально`);
      }
    }
  }
  if (plan.mode === "merge") {
    if (!plan.target_workspace || plan.target_workspace.trim() === "") {
      issues.push("merge mode требует локальный target_workspace");
    }
  }
  if (plan.mode === "cancel") {
    issues.push("mode 'cancel' обрабатывается через importCancel, а не importCommit");
  }
  if (!["overwrite", "skip", "fail"].includes(plan.conflict)) {
    issues.push(`conflict policy "${plan.conflict}" неизвестна`);
  }
  return Object.freeze(issues);
}


/**
 * Runtime 1.3.0 reports both package inventory and what this service can
 * actually import. The preview exposes aggregate allowed counts, NOT an
 * allowlist of workspace IDs. When scopes differ, guessing which IDs are
 * permitted can cause PLAN_NOT_IN_PREVIEW or silent partial recovery.
 * Fail closed and tell the user to use an appropriately scoped service.
 */
export function validateImportScope(
  preview: ImportPreview,
  plan: ImportPlanForm,
): ReadonlyArray<string> {
  // Older UI test fixtures may omit these fields; a qualified Runtime
  // preview includes both according to the canonical ImportPreview contract.
  const allowed = preview.included;
  const denied = preview.excluded_by_permission;
  // The Runtime 1.3.0 scope_mode requires authoritative included/excluded
  // counts. Legacy unit fixtures omit both, but a real scoped preview must
  // never be allowed through without those counters.
  if (!allowed || !denied) {
    return preview.scope_mode
      ? ["Kernel не вернул обязательный состав разрешённых данных для импорта."]
      : [];
  }
  const issues: string[] = [];
  // A new/full Workspace is a backup restoration, not a data-only transfer.
  // Silently omitting archived domain events can make valid Results
  // invisible to their editors after import (D06 PD.01 is one example).
  // Data-only transfers remain available through explicit selective/merge.
  if (plan.mode === "new-workspace" || plan.mode === "full") {
    if (preview.totals.events > 0 && !plan.include_history) {
      issues.push(
        "Полное восстановление рабочей области требует историю событий. " +
        "Включите «История событий»; для переноса без истории используйте выборочный импорт.",
      );
    }
    if (preview.totals.relations > 0 && !plan.include_relations) {
      issues.push(
        "Полное восстановление рабочей области требует связи объектов. " +
        "Включите «Связи»; для переноса без связей используйте выборочный импорт.",
      );
    }
    if (preview.totals.assets > 0 && !plan.include_assets) {
      issues.push(
        "Полное восстановление рабочей области требует вложения. " +
        "Включите «Ассеты»; для переноса без них используйте выборочный импорт.",
      );
    }
  }
  const inPackage = preview.workspaces.length;
  if (allowed.workspaces !== inPackage || denied.workspaces > 0) {
    issues.push(
      `Доступны для восстановления ${allowed.workspaces} из ${inPackage} рабочих областей. ` +
      "Kernel не сообщает разрешённые ID по отдельности; импорт всей выборки заблокирован.",
    );
  }
  if (denied.objects > 0) {
    issues.push(`${denied.objects} объектов недоступны для записи с действующими полномочиями.`);
  }
  if (denied.schemas > 0) {
    issues.push(`${denied.schemas} схемы недоступны для импорта.`);
  }
  if (plan.include_history && denied.events > 0) {
    issues.push(`${denied.events} событий истории недоступны для импорта.`);
  }
  if (plan.include_relations && denied.relations > 0) {
    issues.push(`${denied.relations} связей недоступны для импорта.`);
  }
  if (plan.include_assets && denied.assets > 0) {
    issues.push(`${denied.assets} вложений недоступны для импорта.`);
  }
  if (preview.totals.objects > 0 && allowed.objects === 0) {
    issues.push("Ни один объект из пакета не разрешён для восстановления.");
  }
  // A permission summary is not a validation report: damaged records or
  // unsupported schemas must not silently disappear from a backup restore.
  if (preview.invalid && Object.values(preview.invalid).some((count) => count > 0)) {
    issues.push("Kernel обнаружил недопустимые записи или зависимости в пакете.");
  }
  if (preview.unsupported?.some((row) => row.kind !== "extension_field")) {
    issues.push("В пакете есть объекты с неподдерживаемыми схемами или правами.");
  }
  // Include/exclude counters must account for the entire requested archive.
  // Otherwise an apparently clean permission check may conceal missing data.
  for (const [kind, required] of [
    ["workspaces", true],
    ["objects", true],
    ["events", plan.include_history],
    ["relations", plan.include_relations],
    ["assets", plan.include_assets],
  ] as const) {
    if (required && allowed[kind] + denied[kind] !== preview.totals[kind]) {
      issues.push(`Kernel не подтвердил полный состав ${kind} для восстановления.`);
    }
  }
  return Object.freeze(issues);
}

/**
 * A committed receipt proves a transaction, not necessarily that the
 * requested backup was recovered. In particular, skipped conflicts and
 * zero writes must never be reported as a complete restore.
 */
export function validateRestorationReceipt(
  preview: ImportPreview,
  plan: ImportPlanForm,
  receipt: ImportReceipt,
): ReadonlyArray<string> {
  const issues: string[] = [];
  if (receipt.cancelled) {
    issues.push("Kernel отменил импорт; восстановление не выполнено.");
    return issues;
  }
  const writtenObjects = receipt.applied.objects_inserted + receipt.applied.objects_updated;
  const allowed = preview.included;
  if (allowed?.objects && writtenObjects === 0) {
    issues.push("Квитанция не подтверждает запись ни одного объекта из пакета.");
  }
  const selectedAllWorkspaces =
    plan.include_workspaces.length === preview.workspaces.length &&
    preview.workspaces.every((w) => plan.include_workspaces.includes(w.workspace_id));
  const completeRestore =
    plan.mode === "new-workspace" || plan.mode === "full" || plan.mode === "merge" ||
    (plan.mode === "selective" && selectedAllWorkspaces && !(plan.include_objects?.length));
  if (allowed && completeRestore) {
    if (writtenObjects < allowed.objects) {
      issues.push(`Объекты восстановлены не полностью: ${writtenObjects} из ${allowed.objects}.`);
    }
    if (plan.include_history && receipt.applied.events < allowed.events) {
      issues.push(`История восстановлена не полностью: ${receipt.applied.events} из ${allowed.events} событий.`);
    }
    if (plan.include_relations && receipt.applied.relations < allowed.relations) {
      issues.push(`Связи восстановлены не полностью: ${receipt.applied.relations} из ${allowed.relations}.`);
    }
    if (plan.include_assets && receipt.applied.assets < allowed.assets) {
      issues.push(`Вложения восстановлены не полностью: ${receipt.applied.assets} из ${allowed.assets}.`);
    }
  }
  return Object.freeze(issues);
}

export function toKernelImportPlan(plan: ImportPlanForm): ImportPlan {
  const out: ImportPlan = {
    mode: plan.mode,
    include_workspaces: [...plan.include_workspaces],
    include_history: plan.include_history,
    include_assets: plan.include_assets,
    include_relations: plan.include_relations,
    conflict: plan.conflict,
  };
  if (plan.mode === "selective" && plan.include_objects && plan.include_objects.length > 0) {
    (out as Record<string, unknown>).include_objects = [...plan.include_objects];
  }
  if (plan.mode === "new-workspace" && plan.workspace_id_map) {
    (out as Record<string, unknown>).workspace_id_map = { ...plan.workspace_id_map };
  }
  if (plan.mode === "merge" && plan.target_workspace) {
    (out as Record<string, unknown>).target_workspace = plan.target_workspace;
  }
  return out;
}

export function importReducer(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case "preview-started":
      return { ...INITIAL_IMPORT_STATE, status: "previewing" };
    case "preview-succeeded": {
      if (state.status !== "previewing") return state;
      // Aggregate authorization cannot identify WHICH workspace was denied.
      // Never preselect package IDs when any workspace was excluded.
      const fullyAvailable =
        !event.handle.preview.included ||
        event.handle.preview.included.workspaces === event.handle.preview.workspaces.length;
      const initialWs = fullyAvailable
        ? event.handle.preview.workspaces.map((w) => w.workspace_id)
        : [];
      const allowedModes = event.handle.allowed_modes;
      // A foreign .iwxa is transferred into the currently selected LOCAL
      // Workspace by the ORIGINAL Kernel's merge mode, not by creating
      // an unrelated workspace or silently using selective source IDs.
      // The target comes from a real local Kernel listing, never the archive.
      const target = event.preferredTargetWorkspaceId ?? null;
      const incomingFromAnotherWorkspace =
        initialWs.length === 1 && target !== null && initialWs[0] !== target;
      const preferredMode: ImportMode =
        incomingFromAnotherWorkspace && allowedModes.includes("merge") ? "merge"
        : allowedModes.includes("selective") ? "selective"
        : allowedModes.includes("merge") ? "merge"
        : allowedModes.includes("full") ? "full"
        : allowedModes[0] ?? "selective";
      // An import-preview with only new-workspace allowed starts in that
      // mode. Seed the map here too, not only on an explicit mode switch.
      const workspaceIdMap: Record<string, string> = {};
      if (preferredMode === "new-workspace") {
        for (const source of initialWs) {
          workspaceIdMap[source] = `${source}-imported`;
        }
      }
      return {
        ...state,
        status: "preview-ready",
        handle: event.handle,
        plan: { ...INITIAL_PLAN, mode: preferredMode, include_workspaces: initialWs,
          workspace_id_map: workspaceIdMap,
          target_workspace: preferredMode === "merge" ? target : null },
        receipt: null,
        error: null,
        planValidation: [],
      };
    }
    case "preview-failed":
      if (state.status !== "previewing") return state;
      return { ...INITIAL_IMPORT_STATE, status: "error", error: event.error };
    case "set-plan": {
      if (!state.handle || state.status !== "preview-ready") return state;
      let nextPlan: ImportPlanForm = { ...state.plan, ...event.plan };
      // Seed workspace_id_map when switching into new-workspace.
      if (nextPlan.mode === "new-workspace" &&
          Object.keys(nextPlan.workspace_id_map ?? {}).length === 0) {
        const seed: Record<string, string> = {};
        for (const w of state.handle.preview.workspaces) {
          if (nextPlan.include_workspaces.includes(w.workspace_id)) {
            seed[w.workspace_id] = `${w.workspace_id}-imported`;
          }
        }
        nextPlan = { ...nextPlan, workspace_id_map: seed };
      }
      const validation = validateImportPlan(
        nextPlan,
        state.handle.allowed_modes,
        state.handle.preview.workspaces.map((w) => w.workspace_id),
        previewObjectKeysFromHandle(state.handle),
        [],
      );
      return { ...state, plan: nextPlan, planValidation: validation, error: null };
    }
    case "validate-plan": {
      if (!state.handle || state.status !== "preview-ready") return state;
      const validation = validateImportPlan(
        state.plan,
        state.handle.allowed_modes,
        state.handle.preview.workspaces.map((w) => w.workspace_id),
        previewObjectKeysFromHandle(state.handle),
        event.localWorkspaceIds ?? [],
      );
      return {
        ...state,
        status: validation.length > 0 ? "preview-ready" : "validating",
        planValidation: validation,
      };
    }
    case "commit-started":
      if (!state.handle || state.status !== "validating") return state;
      if (state.planValidation.length > 0) return state;
      return { ...state, status: "committing", error: null };
    case "commit-incomplete":
    case "commit-unconfirmed":
    case "commit-succeeded":
      if (state.status !== "committing" || !state.handle) return state;
      if (
        event.receipt.package_digest !== state.handle.package_digest ||
        event.receipt.semantic_digest !== state.handle.semantic_digest ||
        event.receipt.mode !== state.plan.mode ||
        event.receipt.conflict_policy !== state.plan.conflict
      ) {
        // The original Kernel may already have committed. Keep the ACTUAL
        // receipt and never enable a second attempt with this preview token.
        return {
          ...state,
          status: "unconfirmed",
          handle: null,
          receipt: event.receipt,
          error: "IMPORT_RECEIPT_IDENTITY_MISMATCH: проверьте Workspace перед новым импортом.",
        };
      }
      // A committed partial import cannot be rolled back by the UI. Preserve
      // the genuine receipt and consume the preview token so users can inspect
      // the writes instead of accidentally retrying a non-idempotent import.
      return {
        ...state,
        status: event.type === "commit-incomplete" ? "incomplete"
          : event.type === "commit-unconfirmed" ? "unconfirmed" : "committed",
        handle: null,
        receipt: event.receipt,
        error: event.type === "commit-succeeded" ? null : event.error,
      };
    case "commit-retryable":
      if (state.status !== "committing" || !state.handle) return state;
      return { ...state, status: "preview-ready", error: event.error };
    case "commit-invalid":
      if (state.status !== "committing") return state;
      return { ...INITIAL_IMPORT_STATE, status: "error", error: event.error };
    case "commit-failed":
      if (state.status !== "committing") return state;
      // A thrown exception AFTER entry into original Kernel is not proof
      // that the write did not happen. Consume the token and require an
      // explicit fresh inspection; never offer an automatic retry.
      return { ...state, status: "unconfirmed", handle: null, receipt: null,
        error: event.error };
    case "cancel":
      if (["committed","incomplete","unconfirmed"].includes(state.status)) return state;
      return { ...INITIAL_IMPORT_STATE, status: "cancelled" };
    case "cancel-failed":
      if (["committed","incomplete","unconfirmed"].includes(state.status)) return state;
      return { ...state, error: event.error };
    case "expire":
      if (!state.handle || state.status === "committed") return state;
      return { ...INITIAL_IMPORT_STATE, status: "expired", error: "preview_token_expired" };
    case "reset":
      return INITIAL_IMPORT_STATE;
    default:
      return state;
  }
}
