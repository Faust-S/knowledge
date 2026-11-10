import type { ViewerProps } from "../workspace-contract";

interface ProjectData {
  title?: string;
  status?: string;
  owner?: string;
  milestones?: number;
}

export function ProjectRenderer({ data }: ViewerProps) {
  const d = (data ?? {}) as ProjectData;
  return (
    <div className="flex flex-col gap-3">
      {d.title && <h4 className="text-lg font-semibold">{d.title}</h4>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {d.status && (
          <>
            <dt className="opacity-60">Status</dt>
            <dd className="text-right">{d.status}</dd>
          </>
        )}
        {d.owner && (
          <>
            <dt className="opacity-60">Owner</dt>
            <dd className="text-right">{d.owner}</dd>
          </>
        )}
        {typeof d.milestones === "number" && (
          <>
            <dt className="opacity-60">Milestones</dt>
            <dd className="text-right">{d.milestones}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
