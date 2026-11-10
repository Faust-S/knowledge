/**
 * Single presentational component that renders any WorkspaceErrorCode.
 *
 * We deliberately don't ship seven look-alike page files: the descriptor in
 * `registry.ts` fully determines the UI, so there is exactly one place to
 * change the layout for every error state.
 *
 * Per-code convenience wrappers are exported at the bottom of this file so
 * routers can still `<ConfigInvalidPage />` when that reads better.
 */
import type { ReactNode } from "react";
import { describeError, type ErrorDescriptor } from "./registry";
import type { ErrorActionId, WorkspaceErrorCode } from "./codes";
import { getDevDetails } from "./diagnostics";

const ACTION_LABELS: Record<ErrorActionId, string> = {
  retry: "Повторить",
  reload: "Перезагрузить оболочку",
  open_readonly: "Открыть в режиме чтения",
  export_iwxa: "Сначала выгрузить .iwxa",
  resolve_conflict: "Разрешить конфликт",
  run_migration: "Запустить миграцию",
  pick_other_package: "Выбрать другой пакет",
  view_dev_details: "Показать техническую информацию",
  contact_support: "Связаться с поддержкой",
  clear_workspace: "Очистить рабочую область",
  reset_kernel: "Сбросить ядро",
};

const DATA_STATUS_LABEL: Record<ErrorDescriptor["dataStatus"], string> = {
  preserved: "Ваши данные сохранены.",
  unchanged: "Данные не изменялись.",
  at_risk:
    "Мы не можем автоматически подтвердить состояние данных. Выгрузите .iwxa перед следующим действием.",
  unknown:
    "Состояние данных неизвестно. Выгрузите .iwxa перед следующим действием.",
};

export interface ErrorPageProps {
  code: WorkspaceErrorCode;
  error?: unknown;
  onAction?: (action: ErrorActionId) => void;
}

export function ErrorPage({ code, error, onAction }: ErrorPageProps): ReactNode {
  const desc = describeError(code);
  const dev = getDevDetails(error);

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto max-w-xl p-6 space-y-4"
    >
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {desc.code}
        </p>
        <h1 className="text-xl font-semibold">{desc.title}</h1>
      </header>

      <p>{desc.safeMessage}</p>
      <p className="text-sm font-medium">{DATA_STATUS_LABEL[desc.dataStatus]}</p>

      <ul className="flex flex-col gap-2">
        {desc.actions.map((action) => {
          if (action === "view_dev_details" && !dev) return null;
          return (
            <li key={action}>
              <button
                type="button"
                className="min-h-11 w-full rounded border px-3 text-left"
                onClick={() => onAction?.(action)}
              >
                {ACTION_LABELS[action]}
              </button>
            </li>
          );
        })}
      </ul>

      {dev ? (
        <details className="mt-4 text-xs">
          <summary>Dev diagnostic (скрыто в production)</summary>
          <pre className="whitespace-pre-wrap break-all">
            {dev.name}: {dev.message}
            {dev.stack ? `\n${dev.stack}` : ""}
            {dev.cause ? `\ncause: ${dev.cause}` : ""}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

/* ------- Named per-code wrappers (for routers that prefer explicit pages) - */
type WrapperProps = Omit<ErrorPageProps, "code">;
const wrap =
  (code: WorkspaceErrorCode) =>
  (props: WrapperProps): ReactNode => <ErrorPage code={code} {...props} />;

export const ConfigInvalidPage = wrap("config_invalid");
export const KernelUnavailablePage = wrap("kernel_unavailable");
export const MigrationRequiredPage = wrap("migration_required");
export const QuotaExceededPage = wrap("quota_exceeded");
export const ConflictPage = wrap("conflict");
export const UnsupportedSchemaPage = wrap("unsupported_schema");
export const PackageCorruptedPage = wrap("package_corrupted");
export const UnknownErrorPage = wrap("unknown");
