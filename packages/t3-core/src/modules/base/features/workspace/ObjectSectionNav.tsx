/**
 * Tablist for switching between profile-declared object sections. State
 * is not persisted to URL or storage — it lives only for the mount.
 */
import type { WorkspaceObjectSectionResult } from "./object-sections";

export interface ObjectSectionNavProps {
  sections: readonly WorkspaceObjectSectionResult[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function ObjectSectionNav(props: ObjectSectionNavProps) {
  const { sections, activeId, onSelect } = props;
  if (sections.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Разделы рабочей области"
      className="flex flex-wrap gap-1 border-b border-slate-800"
      data-testid="object-section-nav"
    >
      {sections.map((s) => {
        const isActive = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`section-panel-${s.id}`}
            id={`section-tab-${s.id}`}
            data-testid={`section-tab-${s.id}`}
            onClick={() => onSelect(s.id)}
            className={
              "px-3 py-1.5 text-xs rounded-t min-h-[44px] " +
              (isActive
                ? "bg-slate-800 text-slate-100 border border-b-0 border-slate-800"
                : "text-slate-400 hover:text-slate-200")
            }
          >
            <span>{s.title}</span>
            <span className="ml-1.5 text-slate-500">({s.objects.length})</span>
          </button>
        );
      })}
    </div>
  );
}
