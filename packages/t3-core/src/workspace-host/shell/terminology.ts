/**
 * Workspace-configured terminology.
 *
 * The Host renders certain user-facing nouns based on
 * `workspace.config.json → terminology`. Keys we consistently apply:
 *   workspace, workspaces, objects, projects, history,
 *   backup, import, export, trash.
 *
 * If a key is absent the Russian fallback (built in) is used — the shell
 * NEVER falls back to English or to a synthesised phrase. Non-string values
 * are ignored (fallback wins).
 *
 * Technical identifiers MUST NOT be translated:
 *   operation IDs, schema IDs, workspace IDs, object IDs,
 *   diagnostic codes, technical details.
 */

export type TerminologyMap = Readonly<Record<string, string>>;

export const DEFAULT_TERMINOLOGY: TerminologyMap = Object.freeze({
  workspace: "Рабочая область",
  workspaces: "Рабочие области",
  objects: "Объекты",
  projects: "Проекты",
  history: "История",
  backup: "Резервная копия",
  import: "Импорт",
  export: "Экспорт",
  trash: "Корзина",
  "base.nav.home": "Обзор",
  "base.nav.activity": "Активность",
  "base.nav.diagnostics": "Диагностика",
  "exchange.nav.home": "Перенос данных",
});

export const REQUIRED_TERMINOLOGY_KEYS: readonly string[] = Object.freeze([
  "workspace",
  "workspaces",
  "objects",
  "projects",
  "history",
  "backup",
  "import",
  "export",
  "trash",
]);

export function term(
  configured: TerminologyMap | null | undefined,
  key: string,
  fallback?: string,
): string {
  if (configured && typeof configured[key] === "string" && configured[key].length > 0) {
    return configured[key];
  }
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return DEFAULT_TERMINOLOGY[key] ?? key;
}

export function createTerm(configured: TerminologyMap | null | undefined) {
  return (key: string, fallback?: string) => term(configured, key, fallback);
}
