import type { ReactNode } from "react";

export interface Factory2StudioPanel {
  id: string;
  title: string;
  status: string;
}
export interface Factory2StudioModel {
  schema: "IWXA_T2_FACTORY2_DOMAIN_STUDIO_MODEL_V1";
  product: "domain-studio";
  generation: 2;
  domainId: string;
  sourceSha256: string;
  sourceIdentityValidationScope: string;
  status: string;
  panels: readonly Factory2StudioPanel[];
  blockers: readonly string[];
  candidateRequirements?: Record<string, readonly string[]> | null;
  availableActions: readonly string[];
  humanReviewRequired: boolean;
  ownerApprovalGranted: false;
  genericWriteAuthority: false;
  productionActivation: false;
  directExecutionAllowed: false;
  qualificationStages?: {engineering:string;studio:string;human:string;kernelIntegration:string;product:string;production:string};
  productCompletion?: {
    required: true;
    status: string;
    siteRuntimeGate: "SITE_T2_CONNECTED_AND_QUALIFIED";
    productGate: "DOMAIN_T2_PRODUCT_COMPLETE";
    productionActivation: false;
    verificationCommand: string;
    sourceRole: string;
  };
}
export interface DomainStudioSurfaceProps {
  model: Factory2StudioModel;
  onOpenHumanReview?: () => void;
}

const humanize = (value: string) => value.replaceAll("_", " ").toLowerCase();

export function DomainStudioSurface({ model, onOpenHumanReview }: DomainStudioSurfaceProps) {
  const requirements = Object.entries(model.candidateRequirements ?? {}).filter(([, items]) => items.length > 0);
  const canReview = model.availableActions.includes("OPEN_HUMAN_REVIEW") && model.humanReviewRequired;
  const gitTechnical = model.productCompletion?.sourceRole === "GIT_ENGINEERING_NO_OWNER_REVIEW";

  return (
    <main className="space-y-6" data-testid="factory2-domain-studio">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">IWXA T2 Factory 2 · Domain Studio</p>
            <h1 className="text-xl font-semibold text-slate-100">{model.domainId}</h1>
          </div>
          <StatusBadge>{humanize(model.status)}</StatusBadge>
        </div>
        <p className="max-w-3xl text-sm text-slate-300">
          Инженерная поверхность преобразования домена. Studio показывает доказанное состояние и открытые решения,
          но не выполняет записи и не выдаёт Owner approval.
        </p>
      </header>

      <section
        aria-labelledby="studio-source-identity-title"
        className="space-y-2 rounded border border-slate-800 bg-slate-900/40 p-4"
        data-testid="studio-source-identity"
      >
        <h2 id="studio-source-identity-title" className="text-sm font-medium text-slate-100">
          Exact source identity
        </h2>
        <code className="block break-all text-xs text-slate-300">{model.sourceSha256}</code>
        <p className="text-xs text-slate-500">{humanize(model.sourceIdentityValidationScope)}</p>
      </section>

      <section aria-labelledby="studio-stage-title" className="space-y-3">
        <h2 id="studio-stage-title" className="text-sm font-medium text-slate-100">Этапы преобразования</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {model.panels.map((panel) => (
            <li key={panel.id} className="rounded border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-sm font-medium text-slate-100">{panel.title}</div>
              <div className="mt-2 text-xs text-slate-400" data-testid={`studio-panel-${panel.id}`}>
                {humanize(panel.status)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="studio-blockers-title" className="space-y-2">
        <h2 id="studio-blockers-title" className="text-sm font-medium text-slate-100">Блокеры</h2>
        {model.blockers.length === 0 ? (
          <p className="text-sm text-emerald-300">Кандидат не заблокирован domain-facing картами.</p>
        ) : (
          <ul className="space-y-2">
            {model.blockers.map((blocker) => (
              <li key={blocker} className="rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
                {humanize(blocker)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {requirements.length > 0 && (
        <section aria-labelledby="studio-requirements-title" className="space-y-2">
          <h2 id="studio-requirements-title" className="text-sm font-medium text-slate-100">Что ещё требуется доказать</h2>
          <dl className="space-y-3">
            {requirements.map(([kind, items]) => (
              <div key={kind} className="rounded border border-slate-800 p-3">
                <dt className="text-xs uppercase tracking-wide text-slate-500">{humanize(kind)}</dt>
                <dd className="mt-1 text-sm text-slate-300">{items.join(", ")}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-label="Независимые проверки готовности" data-testid="studio-independent-gates" className="grid gap-3 sm:grid-cols-2">
        <Boundary label="Factory Engineering" value={humanize(model.qualificationStages?.engineering ?? model.status)} />
        <Boundary label="Studio review" value={humanize(model.qualificationStages?.studio ?? "NOT_REVIEWED")} />
        <Boundary label={gitTechnical ? "Техническое согласование" : "Решение человека"} value={humanize(model.qualificationStages?.human ?? "HUMAN_DECISION_REQUIRED")} />
        <Boundary label="Интеграция сайта с Kernel" value={humanize(model.qualificationStages?.kernelIntegration ?? "NOT_PROVEN")} />
        <Boundary label="Завершение продукта" value={humanize(model.qualificationStages?.product ?? "NOT_QUALIFIED")} />
        <Boundary label="Production deployment" value={humanize(model.qualificationStages?.production ?? "NOT_DEPLOYED")} />
      </section>

      <section aria-labelledby="studio-product-completion-title" className="space-y-2 rounded border border-amber-800/50 bg-slate-900/40 p-4" data-testid="studio-product-completion">
        <h2 id="studio-product-completion-title" className="text-sm font-medium text-slate-100">T2 Product Completion</h2>
        <p className="text-sm text-slate-300">{gitTechnical
          ? "Git Engineering проходит техническую квалификацию без обязательной ручной рецензии. Продукт готов только после реальных проверок Host, Kernel, браузера, прав и сохранения после перезапуска."
          : "Factory T2_READY подтверждает предметную квалификацию. Готовность действующего сайта требует отдельной реальной проверки Host / Kernel и пользовательских маршрутов."}</p>
        <div data-testid="studio-product-completion-status" className="text-sm font-semibold text-amber-200">{humanize(model.productCompletion?.status ?? "NOT_QUALIFIED")}</div>
        <p className="text-xs text-slate-400">Требуется SITE_T2_CONNECTED_AND_QUALIFIED и DOMAIN_T2_PRODUCT_COMPLETE. Production — только по отдельному разрешению.</p>
        <code className="block overflow-x-auto text-xs text-slate-300">{model.productCompletion?.verificationCommand ?? "node scripts/factory2-domain-run-cli.mjs qualify-product <run> <site-checkout>"}</code>
      </section>

      <section aria-labelledby="studio-authority-title" className="space-y-2">
        <h2 id="studio-authority-title" className="text-sm font-medium text-slate-100">Authority boundary</h2>
        <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <Boundary label="Прямое выполнение" value="Запрещено" />
          <Boundary label="Generic writes" value="Запрещены" />
          <Boundary label={gitTechnical ? "Предметные полномочия" : "Owner approval"} value={gitTechnical ? "Только уполномоченный субъект" : "Только человек"} />
          <Boundary label="Production activation" value="Запрещена" />
        </div>
      </section>

      {canReview && (
        <div>
          <button
            type="button"
            onClick={onOpenHumanReview}
            disabled={!onOpenHumanReview}
            className="min-h-[44px] rounded bg-emerald-800 px-4 py-2 text-sm text-white enabled:hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Открыть human review
          </button>
        </div>
      )}
    </main>
  );
}

function StatusBadge({ children }: { children: ReactNode }) {
  return <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">{children}</span>;
}
function Boundary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/30 p-3">
      <div className="text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-200">{value}</div>
    </div>
  );
}
