/**
 * Shared UI primitives for domain profile renderers.
 *
 * Every profile (learning / personal / organization / health) reuses these
 * building blocks. Do NOT copy Chip/Meter/Row/DomainCard into another file:
 * the single-source-of-truth is here, and this is what makes new profiles
 * cheap and visually consistent.
 *
 * Nothing here contains domain vocabulary — it is pure presentation.
 */
import type { ReactNode } from "react";

export type ChipTone =
  | "neutral"
  | "goal"
  | "route"
  | "gap"
  | "practice"
  | "source"
  | "risk"
  | "action"
  | "evidence"
  | "role"
  | "process"
  | "finding"
  | "warning"
  | "sensitive";

const CHIP_STYLES: Record<ChipTone, string> = {
  neutral: "bg-white/10 text-white/80",
  goal: "bg-indigo-500/20 text-indigo-200",
  route: "bg-sky-500/20 text-sky-200",
  gap: "bg-rose-500/20 text-rose-200",
  practice: "bg-emerald-500/20 text-emerald-200",
  source: "bg-amber-500/20 text-amber-200",
  risk: "bg-orange-500/20 text-orange-200",
  action: "bg-teal-500/20 text-teal-200",
  evidence: "bg-lime-500/20 text-lime-200",
  role: "bg-violet-500/20 text-violet-200",
  process: "bg-cyan-500/20 text-cyan-200",
  finding: "bg-fuchsia-500/20 text-fuchsia-200",
  warning: "bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/40",
  sensitive: "bg-rose-500/30 text-rose-100 ring-1 ring-rose-400/50",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`text-[10px] px-2 py-0.5 rounded ${CHIP_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  max = 1,
  tone = "indigo",
}: {
  value: number;
  max?: number;
  tone?: "indigo" | "rose" | "emerald" | "amber";
}) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  const bar: Record<string, string> = {
    indigo: "bg-indigo-400",
    rose: "bg-rose-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
  };
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-1.5 w-full rounded bg-white/10 overflow-hidden"
    >
      <div
        className={`h-full ${bar[tone]}`}
        style={{ width: `${pct.toFixed(1)}%` }}
      />
    </div>
  );
}

export function Row({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <>
      <dt className="opacity-60">{label}</dt>
      <dd className="text-right">{value}</dd>
    </>
  );
}

/**
 * Standard domain card layout. Profiles compose it around the fields their
 * types declare — the wrapper handles title + chip row + data-renderer marker
 * so tests and screenshots stay stable across profiles.
 */
export function DomainCard({
  rendererType,
  title,
  chips,
  children,
}: {
  rendererType: string;
  title?: string;
  chips?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3" data-renderer={rendererType}>
      {title && <h4 className="text-lg font-semibold">{title}</h4>}
      {chips && <div className="flex flex-wrap gap-1">{chips}</div>}
      {children}
    </div>
  );
}
