/**
 * Search + sort controls for the object catalog. Both bits of state are
 * held by the parent and never persisted anywhere.
 */
import {
  OBJECT_CATALOG_SORTS,
  type ObjectCatalogSortId,
} from "./workspace-catalog-model";

export interface ObjectCatalogToolbarProps {
  query: string;
  onQueryChange: (v: string) => void;
  sort: ObjectCatalogSortId;
  onSortChange: (v: ObjectCatalogSortId) => void;
}

export function ObjectCatalogToolbar(props: ObjectCatalogToolbarProps) {
  const { query, onQueryChange, sort, onSortChange } = props;
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="object-catalog-toolbar"
    >
      <label className="sr-only" htmlFor="ws-object-search">
        Найти по идентификатору или типу
      </label>
      <input
        id="ws-object-search"
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Найти по идентификатору или типу"
        className="flex-1 min-w-[12rem] px-2 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded min-h-[44px]"
      />
      <label className="sr-only" htmlFor="ws-object-sort">Сортировка</label>
      <select
        id="ws-object-sort"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as ObjectCatalogSortId)}
        className="px-2 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded min-h-[44px]"
      >
        {OBJECT_CATALOG_SORTS.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}
