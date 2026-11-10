import type { ViewerProps } from "../../workspace-contract";
import { Chip, DomainCard, Meter, Row } from "../_shared/ui";
import type {
  Action,
  AnalyticalResult,
  DiagnosticCase,
  Finding,
  Process,
  Risk,
  Route,
} from "./types";

export function DiagnosticCaseRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as DiagnosticCase;
  return (
    <DomainCard
      rendererType="diagnostic-case"
      title={d.title}
      chips={
        <>
          <Chip tone="process">Case</Chip>
          {d.status && <Chip>{d.status}</Chip>}
          {d.subject && <Chip>{d.subject}</Chip>}
          {d.openedAt && <Chip>opened {d.openedAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.summary && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.summary}</p>
      )}
    </DomainCard>
  );
}

export function AnalyticalResultRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as AnalyticalResult;
  const conf = typeof d.confidence === "number" ? d.confidence : undefined;
  return (
    <DomainCard
      rendererType="analytical-result"
      title={d.title}
      chips={
        <>
          <Chip tone="finding">Result</Chip>
          {d.method && <Chip>{d.method}</Chip>}
          {d.producedAt && <Chip>{d.producedAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {conf !== undefined && (
        <div className="flex flex-col gap-1 text-xs opacity-80">
          <span>Confidence · {(conf * 100).toFixed(0)}%</span>
          <Meter value={conf} />
        </div>
      )}
      {d.caseId && (
        <p className="text-[11px] opacity-60">case · {d.caseId}</p>
      )}
    </DomainCard>
  );
}

export function FindingRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Finding;
  return (
    <DomainCard
      rendererType="finding"
      title={d.title}
      chips={
        <>
          <Chip tone="finding">Finding</Chip>
          {d.severity && (
            <Chip tone={d.severity === "high" ? "risk" : "neutral"}>
              {d.severity}
            </Chip>
          )}
        </>
      }
    >
      {d.body && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.body}</p>
      )}
      {d.caseId && (
        <p className="text-[11px] opacity-60">case · {d.caseId}</p>
      )}
    </DomainCard>
  );
}

export function RiskRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Risk;
  const l = typeof d.likelihood === "number" ? d.likelihood : undefined;
  const i = typeof d.impact === "number" ? d.impact : undefined;
  return (
    <DomainCard
      rendererType="risk"
      title={d.title}
      chips={
        <>
          <Chip tone="risk">Risk</Chip>
          {d.status && <Chip>{d.status}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {(l !== undefined || i !== undefined) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {l !== undefined && (
            <Row label="Likelihood" value={`${(l * 100).toFixed(0)}%`} />
          )}
          {i !== undefined && (
            <Row label="Impact" value={`${(i * 100).toFixed(0)}%`} />
          )}
        </dl>
      )}
      {i !== undefined && <Meter value={i} tone="rose" />}
      {d.caseId && (
        <p className="text-[11px] opacity-60">case · {d.caseId}</p>
      )}
    </DomainCard>
  );
}

export function ActionRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Action;
  return (
    <DomainCard
      rendererType="action"
      title={d.title}
      chips={
        <>
          <Chip tone="action">Action</Chip>
          {d.status && <Chip>{d.status}</Chip>}
          {d.owner && <Chip>@{d.owner}</Chip>}
          {d.dueAt && <Chip>due {d.dueAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {d.caseId && (
        <p className="text-[11px] opacity-60">case · {d.caseId}</p>
      )}
    </DomainCard>
  );
}

export function ProcessRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Process;
  return (
    <DomainCard
      rendererType="process"
      title={d.title}
      chips={<Chip tone="process">Process</Chip>}
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {d.stages && d.stages.length > 0 && (
        <ol className="text-sm list-decimal ml-4 space-y-1 opacity-90">
          {d.stages.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </DomainCard>
  );
}

export function RouteRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as Route;
  return (
    <DomainCard
      rendererType="route"
      title={d.title}
      chips={
        <>
          <Chip tone="route">Route</Chip>
          {d.processId && <Chip>proc · {d.processId}</Chip>}
        </>
      }
    >
      {d.summary && <p className="text-sm opacity-90">{d.summary}</p>}
      {d.stops && d.stops.length > 0 && (
        <ol className="text-sm ml-4 space-y-1 opacity-90 list-decimal">
          {d.stops.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </DomainCard>
  );
}
