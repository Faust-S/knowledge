/**
 * Learning profile (pilot for learn.iwxa.ru).
 *
 * Object types and their kernel-side `data` shape. The shell must not add
 * fields not listed here — any extra key stays inside the TechnicalPanel.
 *
 * These types are intentionally narrow: the domain is "learning goals,
 * competencies, deficits, routes and results", not a general LMS. There is
 * no notion of accounts, cohorts, teachers, grading policies or server-side
 * history — those belong to /career/, /lad/, /study/, /practice/.
 */

/** ISO-8601 date-time. Kernel-provided. */
export type IsoDate = string;

export interface LearningGoal {
  title: string;
  summary?: string;
  /** 0..1 confidence the user placed on this goal. */
  confidence?: number;
  /** Free-form target horizon (e.g. "3 months"). */
  horizon?: string;
  tags?: string[];
}

export interface Competency {
  title: string;
  domain?: string;
  /** 0..5 self-assessed mastery. */
  level?: number;
  /** 0..5 required mastery (from a career/learning route). */
  target?: number;
  description?: string;
}

export interface CompetencyGap {
  title: string;
  /** Human summary — kernel derives this, shell displays as-is. */
  summary?: string;
  /** 0..5 delta = target - level. */
  delta?: number;
  /** ID of the linked competency object. */
  competencyId?: string;
  /** Where the gap came from — informational only. */
  source?: "career" | "lad" | "study" | "practice" | "calculators";
}

export interface CareerRoute {
  title: string;
  role?: string;
  employer?: string;
  /** Ordered milestones — plain strings; no calendar logic in shell. */
  milestones?: string[];
  description?: string;
}

export interface LearningRoute {
  title: string;
  /** Kernel-provided ordered steps. */
  steps?: Array<{ title: string; kind?: string; estimateMinutes?: number }>;
  /** Linked goal object. */
  goalId?: string;
  /** Linked competency-gap objects. */
  gapIds?: string[];
  totalMinutes?: number;
}

export interface Task {
  title: string;
  status?: "todo" | "doing" | "done" | "skipped";
  /** Owning route id — used only for grouping. */
  routeId?: string;
  /** Owning goal id — used only for grouping. */
  goalId?: string;
  dueAt?: IsoDate;
  notes?: string;
}

export interface PracticeResult {
  title: string;
  /** 0..1 accuracy over the practice session. */
  accuracy?: number;
  itemsAttempted?: number;
  itemsCorrect?: number;
  durationSeconds?: number;
  finishedAt?: IsoDate;
  /** Linked competency or gap the practice measured. */
  targetId?: string;
}

export interface Reflection {
  title?: string;
  body: string;
  mood?: "low" | "neutral" | "high";
  writtenAt?: IsoDate;
  /** What triggered the reflection. */
  aboutId?: string;
}

/** Union of all learning object type identifiers. */
export const LEARNING_TYPES = [
  "learning-goal",
  "competency",
  "competency-gap",
  "career-route",
  "learning-route",
  "task",
  "practice-result",
  "reflection",
] as const;

export type LearningType = (typeof LEARNING_TYPES)[number];

/** Human labels — used by the object viewer chips. */
export const LEARNING_LABELS: Record<LearningType, string> = {
  "learning-goal": "Учебная цель",
  competency: "Компетенция",
  "competency-gap": "Дефицит",
  "career-route": "Карьерный маршрут",
  "learning-route": "Учебный маршрут",
  task: "Задание",
  "practice-result": "Результат практики",
  reflection: "Рефлексия",
};

/**
 * Shell-side view of a learning object. This is a UI descriptor for
 * renderers/grouping — NOT a kernel contract type. Real kernel objects
 * come back as `ObjectRecord` from the frozen contract; renderers map
 * them into this shape before grouping.
 */
export interface LearningObject {
  id: string;
  type: LearningType | string;
  data: Record<string, unknown>;
}

/** @deprecated retained for tests written against the old shell type. */
export type KernelObject = LearningObject;
