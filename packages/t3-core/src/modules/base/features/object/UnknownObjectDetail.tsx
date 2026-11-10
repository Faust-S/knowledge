/**
 * Detail viewer for objects whose (profile, schema_id) has no registered
 * renderer. The raw JSON is kept inside a LazyJsonDetails container — it
 * is NOT serialised or mounted until the user explicitly opens it.
 *
 * MUST NOT be mounted for health-blocked workspaces.
 */
import type { ObjectRecord } from "../../../../kernel-client";
import { LazyJsonDetails } from "./LazyJsonDetails";

export interface UnknownObjectDetailProps {
  object: ObjectRecord;
  profileLabel: string;
}

export function UnknownObjectDetail(props: UnknownObjectDetailProps) {
  const { object, profileLabel } = props;
  return (
    <div
      className="space-y-3"
      data-testid="unknown-object-detail"
      data-schema-id={object.schema_id}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-100">
          Специализированное представление отсутствует
        </p>
        <p className="text-xs text-slate-300">
          Тип «<code className="break-all">{object.schema_id}</code>» не
          зарегистрирован для профиля «{profileLabel}». Исходные данные не
          изменены.
        </p>
      </div>

      <LazyJsonDetails
        summary="Показать исходные данные"
        value={object.data}
        testId="unknown-object-detail-json"
      />
    </div>
  );
}
