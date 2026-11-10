/**
 * Personal profile — scaffold for "myself as a workspace".
 *
 * Deliberately narrow: no cross-user model, no calendar system, no goals
 * hierarchy. Enough vocabulary for one person to record roles they play,
 * goals they set, projects they run, evidence they collected and events
 * they lived through — nothing more. Business logic (planning, reminders,
 * scoring) belongs to specialized services, not to this profile.
 */

export type IsoDate = string;

export interface Role {
  title: string;
  /** Free-form scope description (e.g. "parent", "engineer at X"). */
  scope?: string;
  active?: boolean;
  since?: IsoDate;
}

export interface Goal {
  title: string;
  summary?: string;
  /** Optional link to the role this goal belongs to. */
  roleId?: string;
  /** Free-form target horizon; NO deadline arithmetic in the shell. */
  horizon?: string;
  status?: "active" | "paused" | "done" | "dropped";
}

export interface Project {
  title: string;
  summary?: string;
  goalId?: string;
  status?: "planning" | "running" | "paused" | "shipped" | "archived";
  updatedAt?: IsoDate;
}

export interface Evidence {
  title: string;
  /** Human-readable note about what the evidence shows. */
  summary?: string;
  /** What the evidence supports — id of a goal / project / role. */
  aboutId?: string;
  /** Free-form source (URL, filename, "photo", ...). Never rendered as link. */
  source?: string;
  capturedAt?: IsoDate;
}

export interface ActivityEvent {
  title: string;
  /** Free-form category, e.g. "workout", "call", "note". */
  kind?: string;
  occurredAt?: IsoDate;
  durationMinutes?: number;
  /** id of a project / goal / role this activity relates to. */
  aboutId?: string;
  notes?: string;
}

export const PERSONAL_TYPES = [
  "role",
  "goal",
  "project",
  "evidence",
  "activity-event",
] as const;

export type PersonalType = (typeof PERSONAL_TYPES)[number];

export const PERSONAL_LABELS: Record<PersonalType, string> = {
  role: "Роль",
  goal: "Цель",
  project: "Проект",
  evidence: "Доказательство",
  "activity-event": "Событие деятельности",
};
