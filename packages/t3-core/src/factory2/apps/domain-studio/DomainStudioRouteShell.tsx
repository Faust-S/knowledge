import { useState } from "react";
import {
  DomainStudioSurface,
  type Factory2StudioModel,
} from "../../products/domain-studio/DomainStudioSurface";
import { buildFactory2StudioModel } from "../../products/domain-studio/domain-studio.mjs";

export interface DomainStudioRouteShellProps {
  model?: Factory2StudioModel | null;
  onOpenHumanReview?: () => void;
}

export function DomainStudioRouteShell({
  model = null,
  onOpenHumanReview,
}: DomainStudioRouteShellProps) {
  const [loadedModel, setLoadedModel] = useState<Factory2StudioModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const effectiveModel = model ?? loadedModel;
  const loadEngineeringSession = async (file: File) => {
    setLoadError(null); setReviewOpen(false);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Ожидается ENGINEERING_SESSION.json");
      if (file.size > 5 * 1024 * 1024) throw new Error("Engineering session превышает 5 МиБ");
      const parsed = JSON.parse(await file.text());
      setLoadedModel(buildFactory2StudioModel(parsed) as Factory2StudioModel);
    } catch (error) {
      setLoadedModel(null);
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };
  const openHumanReview = onOpenHumanReview ?? (() => setReviewOpen(true));
  return (
    <div
      className="min-h-dvh bg-slate-950 text-slate-100"
      data-testid="factory2-domain-studio-app"
      data-factory-generation="2"
      data-kernel-target="0.3.5"
    >
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              IWXA T2 · Factory Generation 2
            </p>
            <h1 className="text-2xl font-semibold">Domain Studio</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Отдельное инженерное приложение для просмотра состояния Domain Engineering и явного перехода
              к human review. Оно не является обычным доменным Workspace и не выдаёт write/deploy authority.
            </p>
          </div>
          <div className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
            <div>Kernel target: 0.3.5</div>
            <div>Mode: review-only</div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-4">
        <section className="rounded border border-slate-800 bg-slate-900/30 p-4" aria-labelledby="factory2-studio-loader-title">
          <h2 id="factory2-studio-loader-title" className="text-sm font-medium text-slate-100">Загрузить Engineering session</h2>
          <p className="mt-1 text-xs text-slate-400">Выберите ENGINEERING_SESSION.json, созданный Domain Engineering для текущего owner-supplied source. Studio проверяет и отображает session; запись и production activation не выполняются.</p>
          <input data-testid="factory2-studio-session-file" className="mt-3 text-xs" type="file" accept="application/json,.json" onChange={(event) => { const file=event.target.files?.[0]; if(file) void loadEngineeringSession(file); }} />
          {loadError ? <p role="alert" className="mt-2 text-xs text-rose-200">{loadError}</p> : null}
        </section>
        {effectiveModel ? (
          <>
            <DomainStudioSurface model={effectiveModel} onOpenHumanReview={openHumanReview} />
            {reviewOpen ? (
              <section className="rounded border border-emerald-900/60 bg-emerald-950/20 p-4" data-testid="factory2-studio-human-review">
                <h2 className="text-sm font-medium text-emerald-100">Human review открыт</h2>
                <p className="mt-1 text-xs text-slate-300">Сверьте source SHA-256, карты, evidence refs и rollback. Решение оформляется отдельным HUMAN_EXPLICIT decision record; эта поверхность не создаёт Owner approval и не активирует production.</p>
              </section>
            ) : null}
          </>
        ) : (
          <section
            className="rounded border border-slate-800 bg-slate-900/40 p-6"
            aria-labelledby="factory2-studio-empty-title"
            data-testid="factory2-domain-studio-empty"
          >
            <h2 id="factory2-studio-empty-title" className="text-lg font-medium">
              Engineering session не загружена
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Studio ожидает explicit Factory 2 Domain Engineering session, построенную только из
              owner-supplied current domain source. Исторические D01/D10 runs не подставляются автоматически.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <Boundary label="Direct execution" value="forbidden" />
              <Boundary label="Generic writes" value="forbidden" />
              <Boundary label="Owner approval" value="human only" />
              <Boundary label="Production activation" value="forbidden" />
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function Boundary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium text-slate-200">{value}</dd>
    </div>
  );
}
