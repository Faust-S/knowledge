/**
 * A single object card in the Workspace catalog.
 *
 * Rules:
 *   - When a profile-scoped renderer is registered, delegate to it with
 *     `mode="preview"` inside a RendererBoundary.
 *   - Otherwise render the UnknownObjectPreview (never leaks payload).
 *   - The technical object_id is always accessible as a small caption,
 *     regardless of whether the renderer chose to show a title.
 */
import type { ObjectRecord } from "../../../../kernel-client";
import type { WorkspaceProfileId } from "../../../../config/domain-config";
import type { ViewerRegistry } from "../../../../workspace-host/registries/ViewerRegistry";
import type { OperationId } from "../../../../kernel-client";
import { HostViewer } from "../../../../workspace-host/rendering/HostViewer";
import { formatWorkspaceDate } from "../workspaces/workspace-format";
import { UnknownObjectPreview } from "./UnknownObjectPreview";

export interface ObjectPreviewCardProps {
  profileId: WorkspaceProfileId;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  object: ObjectRecord;
  onOpen: (workspaceId: string, objectId: string) => void;
}

export function ObjectPreviewCard(props: ObjectPreviewCardProps) {
  const { profileId, object, onOpen } = props;
  const selected=props.viewerRegistry?.resolve({profileId,schemaId:object.schema_id,schemaVersion:object.schema_version,surface:"preview"},props.grantedOperations,props.activeCapabilities);

  return (
    <article
      className="border border-slate-800 rounded p-3 flex flex-col gap-2 bg-slate-950/40"
      data-testid="object-preview-card"
      data-object-id={object.object_id}
      data-schema-id={object.schema_id}
    >
      <header className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="uppercase tracking-wide">
          {selected?.entry.contribution.label ?? "Исходные данные"}
        </span>
        <span className="ml-auto">рев. {object.revision}</span>
      </header>

      {props.viewerRegistry ? <HostViewer registry={props.viewerRegistry} profileId={profileId} schemaId={object.schema_id} schemaVersion={object.schema_version} surface="preview" data={object.data} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities} fallback={<UnknownObjectPreview object={object}/>} /> : <UnknownObjectPreview object={object}/>}


      <p className="text-[11px] text-slate-500 break-all">
        Объект · <code>{object.object_id}</code>
      </p>

      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span>Обновлено {formatWorkspaceDate(object.updated_at)}</span>
        <button
          type="button"
          onClick={() => onOpen(object.workspace_id, object.object_id)}
          className="ml-auto px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
        >
          Открыть
        </button>
      </div>

      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer min-h-[24px]">Технические сведения</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <dt>schema_id</dt><dd className="text-slate-300 break-all"><code>{object.schema_id}</code></dd>
          <dt>schema_version</dt><dd className="text-slate-300">{object.schema_version}</dd>
          <dt>created_by</dt><dd className="text-slate-300 break-all">{object.created_by_service}</dd>
          <dt>updated_by</dt><dd className="text-slate-300 break-all">{object.updated_by_service}</dd>
          <dt>created_at</dt><dd className="text-slate-300">{object.created_at}</dd>
          <dt>updated_at</dt><dd className="text-slate-300">{object.updated_at}</dd>
        </dl>
      </details>
    </article>
  );
}
