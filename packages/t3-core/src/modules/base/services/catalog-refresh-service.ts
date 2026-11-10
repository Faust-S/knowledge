/**
 * Module-local catalog-refresh service (PROMPT 33 §1).
 *
 * Owned exclusively by `iwxa.workspace.base`. Lifecycle is bound to
 * the module: `activate()` on module activation, `dispose()` on
 * deactivation. Subscribers may only register while the service is
 * active — subscribing before activation throws so that stale
 * listeners cannot survive across module restarts.
 */
export type CatalogRefreshReason = string;
type Listener = (reason: CatalogRefreshReason) => void;

const listeners = new Set<Listener>();
let active = false;

export const catalogRefreshService = Object.freeze({
  activate(): void {
    listeners.clear();
    active = true;
  },

  dispose(): void {
    listeners.clear();
    active = false;
  },

  notify(reason: CatalogRefreshReason = "unspecified"): void {
    if (!active) return;

    for (const listener of [...listeners]) {
      try {
        listener(reason);
      } catch {
        // Один listener не ломает остальные.
      }
    }
  },

  subscribe(listener: Listener): () => void {
    if (!active) {
      throw new Error(
        "catalogRefreshService is not active",
      );
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
});
