import { useCallback, useEffect, useState } from "react";
import { connectKernel, retryConnect } from "./connect";
import type { KernelBootstrap, KernelState } from "./types";

export interface UseKernelOptions {
  serviceId?: string;
  timeoutMs?: number;
  /** Dev-only override. Ignored in production. */
  devBootstrap?: KernelBootstrap;
  /** Explicit trusted signed Control bootstrap. Production-safe, no loader fallback. */
  trustedBootstrap?: KernelBootstrap;
}

export interface UseKernelResult {
  state: KernelState;
  retry: () => void;
}

export function useKernel(opts: UseKernelOptions): UseKernelResult {
  const { serviceId, timeoutMs, devBootstrap, trustedBootstrap } = opts;
  const [state, setState] = useState<KernelState>({ status: "loading" });

  const run = useCallback(
    async (mode: "initial" | "retry") => {
      setState({ status: "loading" });
      const bootstrap = trustedBootstrap ??
        (import.meta.env.DEV ? devBootstrap : undefined);
      const next = await (mode === "retry" ? retryConnect : connectKernel)({
        serviceId: serviceId ?? "",
        timeoutMs,
        bootstrap,
      });
      setState(next);
    },
    [serviceId, timeoutMs, devBootstrap, trustedBootstrap],
  );

  useEffect(() => {
    void run("initial");
  }, [run]);

  const retry = useCallback(() => {
    void run("retry");
  }, [run]);

  return { state, retry };
}
