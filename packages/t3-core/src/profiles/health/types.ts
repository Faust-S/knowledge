/**
 * Health profile — deliberately minimal.
 *
 * There is exactly ONE object type: `sensitive-object`. It is a generic
 * sealed shell — the kernel classifies the payload with an explicit
 * `sensitivity` level, and the shell treats the `body` as opaque text with
 * strict reveal rules. The profile intentionally does not ship diagnoses,
 * medication schedules, dosage advice, symptom checkers, or any other
 * medical vocabulary. That is a policy: adding domain shapes here would
 * imply the shell can reason about them.
 */

export type IsoDate = string;

/**
 * Sensitivity levels. Consumed by the shell, the export dialog and the
 * warning banner. NEVER inferred from the payload — the kernel sets it.
 */
export const SENSITIVITY_LEVELS = [
  "public",
  "personal",
  "sensitive",
  "restricted",
] as const;

export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

export interface SensitiveObject {
  title: string;
  /** Free-form summary — always redacted in preview surfaces. */
  body?: string;
  sensitivity: Sensitivity;
  /**
   * Free-form category label (e.g. "note", "reading"). Presentation only:
   * the shell does NOT branch on this value.
   */
  category?: string;
  recordedAt?: IsoDate;
  /** Optional export warning override. The default warning always applies. */
  exportNote?: string;
}

export const HEALTH_TYPES = ["sensitive-object"] as const;
export type HealthType = (typeof HEALTH_TYPES)[number];

export const HEALTH_LABELS: Record<HealthType, string> = {
  "sensitive-object": "Чувствительная запись",
};

/**
 * The single, always-attached export warning. Shown in the export dialog
 * whenever a sensitive-object is included in the selection, regardless of
 * the specific sensitivity level.
 */
export const HEALTH_EXPORT_WARNING =
  "Пакет содержит чувствительные записи. Архивы .iwxa не шифруются — храните и передавайте их только по каналам, которые вы полностью контролируете.";
