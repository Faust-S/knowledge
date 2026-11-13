/**
 * T3 D1 onboarding: only the ORIGINAL signed Host KernelFacade may confirm
 * that the selected corporate Workspace is actually present. Do not attempt
 * unsigned first-run provisioning or infer readiness from Control metadata.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { KernelFacade } from "@/workspace-contract";

type Phase = "checking" | "ready" | "missing" | "denied";
interface Inspection {
  kernel: KernelFacade | null;
  phase: Phase;
}

export function SignedSelectedWorkspaceGate({
  required, kernel, children,
}: {
  required: boolean;
  kernel: KernelFacade | null;
  children: ReactNode;
}) {
  const [inspection, setInspection] = useState<Inspection>({
    kernel: null, phase: "checking",
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!required || !kernel) return;
    let stale = false;
    setInspection({ kernel, phase: "checking" });
    // listWorkspaces on the signed ModuleContext performs getWorkspace JIT
    // for exactly the Control-selected subject. The raw Kernel session's
    // unscoped listWorkspaces is forbidden here.
    void kernel.listWorkspaces({ include_deleted: false }).then(rows => {
      if (stale) return;
      if (!Array.isArray(rows) || rows.length > 1 ||
          rows.some(row => !row || typeof row.workspace_id !== "string")) {
        setInspection({ kernel, phase: "denied" });
        return;
      }
      setInspection({ kernel, phase: rows.length === 1 && !rows[0].deleted_at
        ? "ready" : "missing" });
    }).catch(() => {
      if (!stale) setInspection({ kernel, phase: "denied" });
    });
    return () => { stale = true; };
  }, [required, kernel, retry]);

  if (!required) return <>{children}</>;
  const phase = kernel && inspection.kernel === kernel
    ? inspection.phase : "checking";
  if (phase === "ready") return <>{children}</>;
  return (
    <section aria-live="polite" data-testid="t3-d1-selected-workspace-gate"
      className="mx-auto max-w-xl p-6 space-y-3">
      {phase === "checking" ? (
        <p role="status">Проверяем выбранную подписанную Workspace через Control…</p>
      ) : (
        <>
          <h2 className="font-semibold">Подписанная Workspace недоступна</h2>
          <p role="alert" data-testid="t3-d1-selected-workspace-message">
            {phase === "missing"
              ? "Для выбранной организации ещё нет рабочей области в исходном Kernel. Откройте Control и выполните её разрешённую подготовку. Неподписанное создание T2 здесь не применяется."
              : "Control не подтвердил чтение выбранной Workspace. Проверьте организацию и её полномочия в локальном Control."}
          </p>
          <button type="button" onClick={() => setRetry(value => value + 1)}
            className="rounded border px-3 py-2 text-sm">
            Проверить повторно
          </button>
        </>
      )}
    </section>
  );
}
