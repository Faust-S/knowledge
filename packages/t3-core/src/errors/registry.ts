/**
 * Registry mapping every WorkspaceErrorCode to its safe descriptor.
 *
 * Invariants (enforced at module load and by tests):
 *   1. Every code in ALL_ERROR_CODES has an entry.
 *   2. `safeMessage` contains no template slots and no user content —
 *      it is a static string safe for production display.
 *   3. `actions` never contains a destructive action *before* `export_iwxa`.
 *   4. `dataStatus` is always set (no implicit "unknown" fallback).
 */
import {
  ALL_ERROR_CODES,
  DESTRUCTIVE_ACTIONS,
  type DataStatus,
  type ErrorActionId,
  type WorkspaceErrorCode,
} from "./codes";

export interface ErrorDescriptor {
  readonly code: WorkspaceErrorCode;
  readonly title: string;
  readonly safeMessage: string;
  readonly dataStatus: DataStatus;
  readonly actions: readonly ErrorActionId[];
}

const REGISTRY: Record<WorkspaceErrorCode, ErrorDescriptor> = {
  config_invalid: {
    code: "config_invalid",
    title: "Настройки рабочей области недоступны",
    safeMessage:
      "Файл настроек не прошёл проверку. Данные не изменялись — рабочая область не открывалась.",
    dataStatus: "unchanged",
    actions: ["reload", "view_dev_details", "contact_support"],
  },
  kernel_unavailable: {
    code: "kernel_unavailable",
    title: "Ядро недоступно",
    safeMessage:
      "Оболочка не смогла соединиться с ядром. Данные сейчас не читаются, " +
      "экспорт .iwxa сейчас невозможен. Не очищайте данные браузера — это " +
      "может привести к безвозвратной потере локальных рабочих областей.",
    dataStatus: "unchanged",
    // Deliberately no `export_iwxa` action: with no session there is no
    // T2 surface to run the export against, so offering it would be a lie.
    actions: ["retry", "reload", "view_dev_details", "contact_support"],
  },

  migration_required: {
    code: "migration_required",
    title: "Требуется обновление формата данных",
    safeMessage:
      "Хранилище использует более новую или более старую схему. До запуска миграции данные не изменяются. Рекомендуем сначала выгрузить .iwxa.",
    dataStatus: "preserved",
    // export first, then migration; destructive actions are absent by design
    actions: ["export_iwxa", "run_migration", "view_dev_details", "contact_support"],
  },
  quota_exceeded: {
    code: "quota_exceeded",
    title: "Недостаточно места в локальном хранилище",
    safeMessage:
      "Операция была отменена ядром — уже сохранённые данные не пострадали. Освободите место, предварительно выгрузив .iwxa.",
    dataStatus: "preserved",
    actions: [
      "export_iwxa",
      "open_readonly",
      "clear_workspace", // allowed only AFTER export_iwxa
      "view_dev_details",
      "contact_support",
    ],
  },
  conflict: {
    code: "conflict",
    title: "Обнаружен конфликт версий",
    safeMessage:
      "Другая вкладка или устройство изменили эти данные. Ваша версия не перезаписана.",
    dataStatus: "preserved",
    actions: ["resolve_conflict", "reload", "view_dev_details"],
  },
  unsupported_schema: {
    code: "unsupported_schema",
    title: "Схема объекта не поддерживается",
    safeMessage:
      "Оболочка не умеет отображать этот тип объекта. Данные остались нетронутыми в хранилище.",
    dataStatus: "preserved",
    actions: ["export_iwxa", "open_readonly", "view_dev_details"],
  },
  package_corrupted: {
    code: "package_corrupted",
    title: "Пакет .iwxa повреждён",
    safeMessage:
      "Импорт был остановлен до записи. Ни одна рабочая область не изменилась.",
    dataStatus: "unchanged",
    actions: ["pick_other_package", "view_dev_details", "contact_support"],
  },
  health_build_required: {
    code: "health_build_required",
    title: "Требуется health-сборка Workspace",
    safeMessage:
      "Конфигурация домена требует профиль «health», но эта сборка Workspace скомпилирована без флага VITE_ENABLE_HEALTH_PROFILE. Оболочка не подменяет профиль автоматически и не открывает хранилище.",
    dataStatus: "unchanged",
    actions: ["view_dev_details", "contact_support"],
  },
  unknown: {
    code: "unknown",
    title: "Неизвестная ошибка",
    safeMessage:
      "Произошёл технический сбой. Мы не можем автоматически подтвердить состояние данных — прежде чем повторять действие, выгрузите .iwxa.",
    dataStatus: "unknown",
    actions: ["export_iwxa", "reload", "view_dev_details", "contact_support"],
  },
};

/** Validate ordering constraint: no destructive action before export_iwxa. */
function assertSafeOrdering(desc: ErrorDescriptor): void {
  const exportIdx = desc.actions.indexOf("export_iwxa");
  for (let i = 0; i < desc.actions.length; i++) {
    const a = desc.actions[i];
    if (DESTRUCTIVE_ACTIONS.has(a)) {
      if (exportIdx === -1 || i < exportIdx) {
        throw new Error(
          `[errors/registry] '${desc.code}' lists destructive action '${a}' before 'export_iwxa'`,
        );
      }
    }
  }
}

// Fail fast on module load if the registry violates its own invariants.
for (const code of ALL_ERROR_CODES) {
  const desc = REGISTRY[code];
  if (!desc) {
    throw new Error(`[errors/registry] missing descriptor for '${code}'`);
  }
  assertSafeOrdering(desc);
}

/**
 * Resolve a code to its descriptor. Unknown codes are mapped *explicitly* to
 * the `unknown` descriptor — this is not a silent fallback: the returned
 * descriptor still tells the user that data status is indeterminate and asks
 * them to export first.
 */
export function describeError(code: string | undefined | null): ErrorDescriptor {
  if (!code) return REGISTRY.unknown;
  const known = (REGISTRY as Record<string, ErrorDescriptor>)[code];
  return known ?? REGISTRY.unknown;
}

export function listErrorDescriptors(): readonly ErrorDescriptor[] {
  return ALL_ERROR_CODES.map((c) => REGISTRY[c]);
}
