/**
 * A paginated list of relations in one direction (outgoing or incoming).
 *
 * T2-03D — decoration validates the FULL endpoint identity, not just the
 * far end. An outgoing relation whose `from_object_id` is not the current
 * object is `endpoint-mismatch` and its preview is never requested.
 */
import { useMemo, useState } from "react";
import type { RelationRecord } from "../../../../../kernel-client";
import type { KernelFacade } from "../../../../../workspace-contract";
import type { WorkspaceProfileId } from "../../../../../config/domain-config";
import type { OperationId } from "../../../../../kernel-client";
import type { ViewerRegistry } from "../../../../../workspace-host/registries/ViewerRegistry";
import { isSafeOpaqueId } from "../../../../../shell/routing";
import { RelationCard } from "./RelationCard";
import { useRelatedObjects } from "./useRelatedObjects";
import type {
  DecoratedRelation,
  RelationDirection,
} from "./relation-types";

export const RELATION_PAGE_SIZE = 10;

export interface RelationListProps {
  direction: RelationDirection;
  relations: readonly RelationRecord[];
  workspaceId: string;
  currentObjectId: string;
  kernel: KernelFacade | null;
  profileId: WorkspaceProfileId;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  previewsEnabled: boolean;
  onOpen: (workspaceId: string, objectId: string) => void;
}

function decorate(
  direction: RelationDirection,
  relations: readonly RelationRecord[],
  workspaceId: string,
  currentObjectId: string,
): DecoratedRelation[] {
  return relations.map((r) => {
    const relatedObjectId =
      direction === "outgoing" ? r.to_object_id : r.from_object_id;
    const nearEndpoint =
      direction === "outgoing" ? r.from_object_id : r.to_object_id;
    let validity: DecoratedRelation["validity"] = "valid";
    if (r.workspace_id !== workspaceId) {
      validity = "cross-workspace";
    } else if (nearEndpoint !== currentObjectId) {
      validity = "endpoint-mismatch";
    } else if (!isSafeOpaqueId(relatedObjectId)) {
      validity = "unsafe-id";
    }
    return { relation: r, direction, relatedObjectId, validity };
  });
}

export function RelationList(props: RelationListProps) {
  const {
    direction, relations, workspaceId, currentObjectId, kernel, profileId,
    previewsEnabled, onOpen,
  } = props;

  const decorated = useMemo(
    () => decorate(direction, relations, workspaceId, currentObjectId),
    [direction, relations, workspaceId, currentObjectId],
  );

  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(decorated.length / RELATION_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * RELATION_PAGE_SIZE;
  const pageItems = decorated.slice(start, start + RELATION_PAGE_SIZE);

  const visibleIds = useMemo(
    () =>
      pageItems
        .filter((e) => e.validity === "valid")
        .map((e) => e.relatedObjectId),
    [pageItems],
  );

  const loader = useRelatedObjects({
    kernel,
    workspaceId,
    visibleIds,
    enabled: previewsEnabled,
  });

  const title =
    direction === "outgoing" ? "Исходящие связи" : "Входящие связи";
  const emptyLabel =
    direction === "outgoing"
      ? "Исходящих связей нет."
      : "Входящих связей нет.";

  return (
    <section
      aria-labelledby={`relations-${direction}`}
      className="space-y-2"
      data-testid={`relations-${direction}`}
    >
      <h5
        id={`relations-${direction}`}
        className="text-sm font-medium text-slate-200"
      >
        {title} <span className="text-slate-500 text-xs">({decorated.length})</span>
      </h5>

      {decorated.length === 0 ? (
        <p className="text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {pageItems.map((entry) => (
              <li key={entry.relation.relation_id}>
                <RelationCard
                  viewerRegistry={props.viewerRegistry} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities}
                  entry={entry}
                  preview={loader.get(entry.relatedObjectId)}
                  profileId={profileId}
                  previewsEnabled={previewsEnabled}
                  workspaceId={workspaceId}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav
              aria-label={`Постраничная навигация: ${title}`}
              className="flex items-center gap-2 text-xs text-slate-400"
            >
              <span>
                Стр. {safePage + 1} / {totalPages}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]"
                >
                  Вперёд
                </button>
              </span>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
