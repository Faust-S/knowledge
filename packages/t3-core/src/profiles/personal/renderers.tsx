import type { ViewerProps } from "../../workspace-contract";
import { Chip, DomainCard, Row } from "../_shared/ui";
import type {
  ActivityEvent,
  Evidence,
  Goal,
  Project,
  Role,
} from "./types";

export function RoleRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Role;
  return (
    <DomainCard
      rendererType="role"
      title={d.title}
      chips={
        <>
          <Chip tone="role">Role</Chip>
          {d.active !== false && <Chip tone="practice">active</Chip>}
          {d.since && <Chip>since {d.since.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.scope && <p className="text-sm opacity-90">{d.scope}</p>}
    </DomainCard>
  );
}

export function GoalRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Goal;
  return (
    <DomainCard
      rendererType="goal"
      title={d.title}
      chips={
        <>
          <Chip tone="goal">Goal</Chip>
          {d.status && <Chip>{d.status}</Chip>}
          {d.horizon && <Chip>{d.horizon}</Chip>}
        </>
      }
    >
      {d.summary && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.summary}</p>
      )}
      {d.roleId && (
        <p className="text-[11px] opacity-60">role · {d.roleId}</p>
      )}
    </DomainCard>
  );
}

export function ProjectRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Project;
  return (
    <DomainCard
      rendererType="project"
      title={d.title}
      chips={
        <>
          <Chip tone="route">Project</Chip>
          {d.status && <Chip>{d.status}</Chip>}
          {d.updatedAt && <Chip>upd {d.updatedAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {d.goalId && (
        <p className="text-[11px] opacity-60">goal · {d.goalId}</p>
      )}
    </DomainCard>
  );
}

export function EvidenceRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Evidence;
  return (
    <DomainCard
      rendererType="evidence"
      title={d.title}
      chips={
        <>
          <Chip tone="evidence">Evidence</Chip>
          {d.source && <Chip tone="source">{d.source}</Chip>}
          {d.capturedAt && <Chip>{d.capturedAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {d.aboutId && (
        <p className="text-[11px] opacity-60">about · {d.aboutId}</p>
      )}
    </DomainCard>
  );
}

export function ActivityEventRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as ActivityEvent;
  return (
    <DomainCard
      rendererType="activity-event"
      title={d.title}
      chips={
        <>
          <Chip tone="practice">Activity</Chip>
          {d.kind && <Chip>{d.kind}</Chip>}
          {d.occurredAt && <Chip>{d.occurredAt.slice(0, 10)}</Chip>}
          {typeof d.durationMinutes === "number" && (
            <Chip>{d.durationMinutes}m</Chip>
          )}
        </>
      }
    >
      {d.notes && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.notes}</p>
      )}
      {d.aboutId && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Row label="about" value={d.aboutId} />
        </dl>
      )}
    </DomainCard>
  );
}
