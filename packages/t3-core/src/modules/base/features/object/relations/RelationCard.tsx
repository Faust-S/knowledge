/**
 * A single relation entry.
 *
 * - When `previewsEnabled` and the relation is valid, delegates to the
 *   profile renderer with `mode="preview"` inside a RendererBoundary.
 *   Never leaks payload on failure.
 * - Opens the related object ONLY if it has a safe opaque ID and the
 *   relation refers to the same workspace.
 */
import type {
  ObjectRecord,
  RelationRecord,
} from "../../../../../kernel-client";
import type { WorkspaceProfileId } from "../../../../../config/domain-config";
import type { ViewerRegistry } from "../../../../../workspace-host/registries/ViewerRegistry";
import type { OperationId } from "../../../../../kernel-client";
import { HostViewer } from "../../../../../workspace-host/rendering/HostViewer";
import { formatWorkspaceDate } from "../../workspaces/workspace-format";
import type {
  DecoratedRelation,
  RelatedPreview,
} from "./relation-types";

export interface RelationCardProps {
  entry: DecoratedRelation;
  preview: RelatedPreview;
  profileId: WorkspaceProfileId;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  previewsEnabled: boolean;
  workspaceId: string;
  onOpen: (workspaceId: string, objectId: string) => void;
}

function ValidityBadge({ entry }: { entry: DecoratedRelation }) {
  if (entry.validity === "valid") return null;
  let label: string;
  switch (entry.validity) {
    case "cross-workspace":
      label = "Связь ссылается на другую рабочую область";
      break;
    case "endpoint-mismatch":
      label = "Связь не относится к текущему объекту";
      break;
    case "unsafe-id":
    default:
      label = "Небезопасный идентификатор";
      break;
  }
  return (
    <span
      data-testid="relation-invalid-badge"
      className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-rose-950/60 text-rose-200"
    >
      {label}
    </span>
  );
}

function PreviewBody(props: {
  entry: DecoratedRelation;
  preview: RelatedPreview;
  profileId: WorkspaceProfileId;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  previewsEnabled: boolean;
}) {
  const { entry, preview, profileId, previewsEnabled } = props;

  if (entry.validity !== "valid" || !previewsEnabled) {
    return (
      <p
        className="text-xs text-slate-500"
        data-testid="relation-preview-unavailable"
      >
        Предпросмотр не предоставлен ядром.
      </p>
    );
  }
  if (preview.state === "loading" || preview.state === "idle") {
    return (
      <p className="text-xs text-slate-500" data-testid="relation-preview-loading">
        Загрузка предпросмотра…
      </p>
    );
  }
  if (preview.state === "preview-unavailable") {
    return (
      <p className="text-xs text-slate-500" data-testid="relation-preview-unavailable">
        Предпросмотр не предоставлен ядром.
      </p>
    );
  }
  if (preview.state === "preview-failed") {
    return (
      <p className="text-xs text-amber-200" data-testid="relation-preview-failed">
        Не удалось загрузить предпросмотр.
      </p>
    );
  }
  if (preview.state === "preview-integrity-failed") {
    return (
      <p className="text-xs text-rose-200" data-testid="relation-preview-integrity-failed">
        Предпросмотр отклонён: ядро вернуло другую запись.
      </p>
    );
  }
  if (preview.state === "related-object-missing") {
    return (
      <p className="text-xs text-amber-200" data-testid="relation-preview-missing">
        Связанный объект не найден.
      </p>
    );
  }
  const related: ObjectRecord | null = preview.object;
  if (!related) {
    return (
      <p className="text-xs text-slate-500" data-testid="relation-preview-unavailable">
        Предпросмотр не предоставлен ядром.
      </p>
    );
  }
  return props.viewerRegistry ? <HostViewer registry={props.viewerRegistry} profileId={profileId} schemaId={related.schema_id} schemaVersion={related.schema_version} surface="preview" data={related.data} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities} fallback={<p data-testid="relation-preview-no-renderer">Исходные данные доступны при открытии объекта.</p>}/> : <p data-testid="relation-preview-no-renderer">Исходные данные доступны при открытии объекта.</p>;

}

export function RelationCard(props: RelationCardProps) {
  const {
    entry,
    preview,
    profileId,
    previewsEnabled,
    workspaceId,
    onOpen,
  } = props;
  const r = entry.relation;
  const canOpen = entry.validity === "valid";

  return (
    <article
      className="border border-slate-800 rounded p-3 flex flex-col gap-2 bg-slate-950/40"
      data-testid="relation-card"
      data-direction={entry.direction}
      data-validity={entry.validity}
      data-relation-id={r.relation_id}
    >
      <header className="flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
        <span className="uppercase tracking-wide text-slate-300">{r.kind}</span>
        <span aria-hidden="true">
          {entry.direction === "outgoing" ? "→" : "←"}
        </span>
        <span className="break-all">
          <code>{entry.relatedObjectId}</code>
        </span>
        <ValidityBadge entry={entry} />
      </header>

      <PreviewBody
        viewerRegistry={props.viewerRegistry} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities}
        entry={entry}
        preview={preview}
        profileId={profileId}
        previewsEnabled={previewsEnabled}
      />

      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span>Создано {formatWorkspaceDate(r.created_at)}</span>
        <button
          type="button"
          onClick={() => onOpen(workspaceId, entry.relatedObjectId)}
          disabled={!canOpen}
          className="ml-auto px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]"
          data-testid="relation-open-button"
        >
          Открыть связанный объект
        </button>
      </div>

      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer min-h-[24px]">
          Технические сведения
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt>relation_id</dt>
          <dd className="text-slate-300 break-all"><code>{r.relation_id}</code></dd>
          <dt>workspace_id</dt>
          <dd className="text-slate-300 break-all"><code>{r.workspace_id}</code></dd>
          <dt>from_object_id</dt>
          <dd className="text-slate-300 break-all"><code>{r.from_object_id}</code></dd>
          <dt>to_object_id</dt>
          <dd className="text-slate-300 break-all"><code>{r.to_object_id}</code></dd>
          <dt>created_at</dt>
          <dd className="text-slate-300">{r.created_at}</dd>
          <dt>created_by_service</dt>
          <dd className="text-slate-300 break-all">{r.created_by_service}</dd>
        </dl>
      </details>
    </article>
  );
}

export type { RelationRecord };
