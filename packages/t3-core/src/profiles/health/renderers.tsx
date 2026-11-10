import type { ViewerProps } from "../../workspace-contract";
import { Chip, DomainCard } from "../_shared/ui";
import { HEALTH_EXPORT_WARNING, type SensitiveObject } from "./types";

/**
 * Renderer for the health profile's single generic object type.
 *
 * Behaviour is asymmetric by design:
 *
 *   - preview mode (default) — reveals ONLY the title and a sealed indicator.
 *     Body, category and any other fields are hidden. Used by workspace lists,
 *     relation previews, export receipts.
 *   - detail mode — reveals body/category behind a warning banner.
 *
 * The shell makes no medical, legal or clinical claims. The kernel classifies
 * the sensitivity level; the renderer never infers it from the payload.
 */
export function SensitiveObjectRenderer({
  data,
  mode = "preview",
}: ViewerProps) {
  const d = (data ?? {}) as Partial<SensitiveObject>;
  const sensitivity = d.sensitivity ?? "sensitive";

  if (mode !== "detail") {
    return (
      <DomainCard
        rendererType="sensitive-object"
        title={d.title ? "🔒 " + d.title : "🔒 Запечатанная запись"}
        chips={
          <>
            <Chip tone="sensitive">ЗАПЕЧАТАНО · {sensitivity}</Chip>
            <Chip tone="warning">содержимое скрыто</Chip>
          </>
        }
      >
        <p
          className="text-xs opacity-70"
          data-health-preview="sealed"
        >
          Содержимое скрыто в предпросмотре. Откройте запись, чтобы просмотреть.
        </p>
      </DomainCard>
    );
  }

  return (
    <DomainCard
      rendererType="sensitive-object"
      title={d.title}
      chips={
        <>
          <Chip tone="sensitive">Чувствительно · {sensitivity}</Chip>
          {d.category && <Chip>{d.category}</Chip>}
          {d.recordedAt && <Chip>{d.recordedAt.slice(0, 10)}</Chip>}
        </>
      }
    >
      <div
        role="alert"
        aria-live="polite"
        data-health-warning="reveal"
        className="rounded border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-100"
      >
        <strong className="block mb-1">Вы просматриваете чувствительную запись.</strong>
        <span className="opacity-90">
          {HEALTH_EXPORT_WARNING} Оболочка не интерпретирует содержимое и не
          даёт медицинских, юридических или клинических рекомендаций.
        </span>
        {d.exportNote && (
          <p className="mt-1 opacity-90">Примечание: {d.exportNote}</p>
        )}
      </div>
      {d.body && (
        <p className="text-sm whitespace-pre-wrap opacity-90">{d.body}</p>
      )}
    </DomainCard>
  );
}
