import type { ViewerProps } from "../../workspace-contract";
import { Chip, Meter, Row } from "../_shared/ui";
import type {
  CareerRoute,
  Competency,
  CompetencyGap,
  LearningGoal,
  LearningRoute,
  PracticeResult,
  Reflection,
  Task,
} from "./types";

/**
 * Learning-profile renderers. Presentation primitives (Chip/Meter/Row) live in
 * `../_shared/ui` — this file only encodes learning-domain vocabulary and
 * layout. Unknown extra keys stay in the TechnicalPanel.
 */

// ---------- individual renderers ------------------------------------------



export function LearningGoalRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as LearningGoal;
  return (
    <div className="flex flex-col gap-3" data-renderer="learning-goal">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip tone="goal">Goal</Chip>
        {d.horizon && <Chip>{d.horizon}</Chip>}
      </div>
      {d.summary && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.summary}</p>
      )}
      {typeof d.confidence === "number" && (
        <div className="flex flex-col gap-1 text-xs opacity-80">
          <span>Confidence · {(d.confidence * 100).toFixed(0)}%</span>
          <Meter value={d.confidence} />
        </div>
      )}
      {d.tags && d.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.tags.map((t) => (
            <Chip key={t}>#{t}</Chip>
          ))}
        </div>
      )}
    </div>
  );
}

export function CompetencyRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Competency;
  const level = typeof d.level === "number" ? d.level : undefined;
  const target = typeof d.target === "number" ? d.target : undefined;
  return (
    <div className="flex flex-col gap-3" data-renderer="competency">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip>Competency</Chip>
        {d.domain && <Chip>{d.domain}</Chip>}
      </div>
      {d.description && (
        <p className="text-sm opacity-90">{d.description}</p>
      )}
      {(level !== undefined || target !== undefined) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {level !== undefined && (
            <Row label="Level" value={`${level.toFixed(1)} / 5`} />
          )}
          {target !== undefined && (
            <Row label="Target" value={`${target.toFixed(1)} / 5`} />
          )}
        </dl>
      )}
      {level !== undefined && <Meter value={level} max={5} />}
    </div>
  );
}

export function CompetencyGapRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as CompetencyGap;
  return (
    <div className="flex flex-col gap-3" data-renderer="competency-gap">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip tone="gap">Gap</Chip>
        {d.source && <Chip tone="source">from {d.source}</Chip>}
      </div>
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {typeof d.delta === "number" && (
        <div className="flex flex-col gap-1 text-xs opacity-80">
          <span>Delta · {d.delta.toFixed(1)}</span>
          <Meter value={Math.abs(d.delta)} max={5} />
        </div>
      )}
      {d.competencyId && (
        <p className="text-[11px] opacity-60">
          linked competency · {d.competencyId}
        </p>
      )}
    </div>
  );
}

export function CareerRouteRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as CareerRoute;
  return (
    <div className="flex flex-col gap-3" data-renderer="career-route">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip tone="route">Career</Chip>
        {d.role && <Chip>{d.role}</Chip>}
        {d.employer && <Chip>{d.employer}</Chip>}
      </div>
      {d.description && <p className="text-sm opacity-90">{d.description}</p>}
      {d.milestones && d.milestones.length > 0 && (
        <ol className="text-sm list-decimal ml-4 space-y-1 opacity-90">
          {d.milestones.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function LearningRouteRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as LearningRoute;
  return (
    <div className="flex flex-col gap-3" data-renderer="learning-route">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip tone="route">Learning route</Chip>
        {typeof d.totalMinutes === "number" && (
          <Chip>{d.totalMinutes} min</Chip>
        )}
        {d.goalId && <Chip tone="goal">goal · {d.goalId}</Chip>}
      </div>
      {d.steps && d.steps.length > 0 && (
        <ol className="text-sm space-y-1 ml-1">
          {d.steps.map((s, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="opacity-50 text-[11px] w-4 text-right">
                {i + 1}.
              </span>
              <span className="flex-1">{s.title}</span>
              {s.kind && (
                <span className="text-[10px] opacity-60">{s.kind}</span>
              )}
              {typeof s.estimateMinutes === "number" && (
                <span className="text-[10px] opacity-60">
                  {s.estimateMinutes}m
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {d.gapIds && d.gapIds.length > 0 && (
        <p className="text-[11px] opacity-60">
          addresses gaps · {d.gapIds.join(", ")}
        </p>
      )}
    </div>
  );
}

export function TaskRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Task;
  const statusTone: Record<NonNullable<Task["status"]>, string> = {
    todo: "bg-white/10 text-white/80",
    doing: "bg-sky-500/20 text-sky-200",
    done: "bg-emerald-500/20 text-emerald-200",
    skipped: "bg-white/5 text-white/50 line-through",
  };
  return (
    <div className="flex flex-col gap-3" data-renderer="task">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip>Task</Chip>
        {d.status && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded ${statusTone[d.status]}`}
          >
            {d.status}
          </span>
        )}
        {d.dueAt && <Chip>due {d.dueAt.slice(0, 10)}</Chip>}
      </div>
      {d.notes && <p className="text-sm opacity-90">{d.notes}</p>}
      {(d.goalId || d.routeId) && (
        <p className="text-[11px] opacity-60">
          {d.goalId && <>goal · {d.goalId} </>}
          {d.routeId && <>route · {d.routeId}</>}
        </p>
      )}
    </div>
  );
}

export function PracticeResultRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as PracticeResult;
  const acc = typeof d.accuracy === "number" ? d.accuracy : undefined;
  return (
    <div className="flex flex-col gap-3" data-renderer="practice-result">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip tone="practice">Practice</Chip>
        {d.finishedAt && <Chip>{d.finishedAt.slice(0, 10)}</Chip>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {acc !== undefined && (
          <Row label="Accuracy" value={`${(acc * 100).toFixed(0)}%`} />
        )}
        {typeof d.itemsCorrect === "number" &&
          typeof d.itemsAttempted === "number" && (
            <Row
              label="Correct"
              value={`${d.itemsCorrect} / ${d.itemsAttempted}`}
            />
          )}
        {typeof d.durationSeconds === "number" && (
          <Row label="Duration" value={`${Math.round(d.durationSeconds / 60)}m`} />
        )}
      </dl>
      {acc !== undefined && <Meter value={acc} />}
      {d.targetId && (
        <p className="text-[11px] opacity-60">measures · {d.targetId}</p>
      )}
    </div>
  );
}

export function ReflectionRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Reflection;
  const moodTone: Record<NonNullable<Reflection["mood"]>, string> = {
    low: "bg-rose-500/20 text-rose-200",
    neutral: "bg-white/10 text-white/70",
    high: "bg-emerald-500/20 text-emerald-200",
  };
  return (
    <div className="flex flex-col gap-3" data-renderer="reflection">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <div className="flex flex-wrap gap-1">
        <Chip>Reflection</Chip>
        {d.mood && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded ${moodTone[d.mood]}`}
          >
            {d.mood}
          </span>
        )}
        {d.writtenAt && <Chip>{d.writtenAt.slice(0, 10)}</Chip>}
      </div>
      <p className="text-sm whitespace-pre-wrap opacity-90">{d.body}</p>
      {d.aboutId && (
        <p className="text-[11px] opacity-60">about · {d.aboutId}</p>
      )}
    </div>
  );
}
