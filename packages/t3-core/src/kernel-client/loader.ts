import type { KernelBootstrap } from "./types";
import { KernelError } from "./types";

const LOADER_URL = "/_iwxa/loader.js";
const DEFAULT_TIMEOUT_MS = 5000;

let pending: Promise<KernelBootstrap> | null = null;

export function resetLoaderCache(): void {
  pending = null;
}

/**
 * Dynamically inject /_iwxa/loader.js and resolve with the bootstrap object
 * exposed on window.IWXA. Never falls back to any local storage — a failure
 * bubbles as a typed KernelError.
 */
export function loadBootstrap(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<KernelBootstrap> {
  if (pending) return pending;

  pending = new Promise<KernelBootstrap>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(
        new KernelError(
          "loader_unreachable",
          "Kernel client requires a browser environment",
        ),
      );
      return;
    }

    const check = () => {
      const b = window.IWXA;
      if (!b || typeof b.connect !== "function") return false;
      resolve(b);
      return true;
    };

    if (check()) return;

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-iwxa-loader="1"]`,
    );
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = LOADER_URL;
      script.async = true;
      script.dataset.iwxaLoader = "1";
      document.head.appendChild(script);
    }

    const timer = window.setTimeout(() => {
      if (!check()) {
        reject(
          new KernelError(
            "loader_timeout",
            `Kernel loader did not attach window.IWXA within ${timeoutMs}ms`,
          ),
        );
      }
    }, timeoutMs);

    script.addEventListener("load", () => {
      window.clearTimeout(timer);
      if (!check()) {
        reject(
          new KernelError(
            "kernel_missing",
            "Loader executed but window.IWXA is missing",
          ),
        );
      }
    });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(
        new KernelError("loader_unreachable", `Failed to load ${LOADER_URL}`),
      );
    });
  }).catch((err) => {
    pending = null;
    throw err;
  });

  return pending;
}
