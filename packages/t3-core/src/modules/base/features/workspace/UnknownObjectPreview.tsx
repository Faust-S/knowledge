/**
 * Preview surface for objects whose (profile, schema_id) has no
 * registered renderer. NEVER prints the payload — shell has no way to
 * decide what is safe to reveal.
 */
import type { ObjectRecord } from "../../../../kernel-client";
import { formatWorkspaceDate } from "../workspaces/workspace-format";

export interface UnknownObjectPreviewProps {
  object: ObjectRecord;
}

export function UnknownObjectPreview({ object }: UnknownObjectPreviewProps) {
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="unknown-object-preview"
      data-schema-id={object.schema_id}
    >
      <p className="text-sm font-semibold text-slate-100">
        Неизвестный тип объекта
      </p>
      <p className="text-xs text-slate-300 break-all">
        <code>{object.schema_id}</code>
      </p>
      <p className="text-xs text-slate-400">
        Специализированное представление для этого типа не зарегистрировано.
      </p>
      <dl className="mt-1 text-[11px] text-slate-500 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>Обновлено</dt>
        <dd className="text-slate-300">{formatWorkspaceDate(object.updated_at)}</dd>
        <dt>Ревизия</dt>
        <dd className="text-slate-300">{object.revision}</dd>
        <dt>Объект</dt>
        <dd className="text-slate-300 break-all"><code>{object.object_id}</code></dd>
      </dl>
    </div>
  );
}
