/**
 * Organization profile — scaffold for analytical and decision workflows.
 *
 * The shell knows enough to display a case, its findings, risks, actions and
 * the process/route context around them. It does NOT perform diagnostics,
 * compute risk scores or automate approvals — those live in the analytical
 * services on the other side of a route descriptor.
 */

export type IsoDate = string;

export interface DiagnosticCase {
  title: string;
  summary?: string;
  /** Free-form subject label, e.g. "warehouse throughput". */
  subject?: string;
  openedAt?: IsoDate;
  status?: "open" | "in_review" | "resolved" | "archived";
}

export interface AnalyticalResult {
  title: string;
  summary?: string;
  caseId?: string;
  /** 0..1 confidence the service assigned to the conclusion. */
  confidence?: number;
  producedAt?: IsoDate;
  method?: string;
}

export interface Finding {
  title: string;
  body?: string;
  caseId?: string;
  severity?: "info" | "low" | "medium" | "high";
}

export interface Risk {
  title: string;
  summary?: string;
  caseId?: string;
  /** 0..1 likelihood. */
  likelihood?: number;
  /** 0..1 impact. */
  impact?: number;
  status?: "identified" | "mitigating" | "accepted" | "closed";
}

export interface Action {
  title: string;
  summary?: string;
  caseId?: string;
  owner?: string;
  status?: "todo" | "doing" | "done" | "cancelled";
  dueAt?: IsoDate;
}

export interface Process {
  title: string;
  summary?: string;
  /** Ordered stage names — presentation only. */
  stages?: string[];
}

export interface Route {
  title: string;
  summary?: string;
  processId?: string;
  /** Ordered stops through processes/services. */
  stops?: string[];
}

export const ORGANIZATION_TYPES = [
  "diagnostic-case",
  "analytical-result",
  "finding",
  "risk",
  "action",
  "process",
  "route",
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_LABELS: Record<OrganizationType, string> = {
  "diagnostic-case": "Диагностический кейс",
  "analytical-result": "Аналитический результат",
  finding: "Вывод",
  risk: "Риск",
  action: "Действие",
  process: "Процесс",
  route: "Маршрут",
};
