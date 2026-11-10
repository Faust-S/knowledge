/**
 * Module-local trash-refresh service (PROMPT 33 §1).
 *
 * Owned exclusively by `iwxa.workspace.lifecycle`. Bound to module
 * activation lifecycle; subscribing before `activate()` throws so no
 * listener survives a module restart.
 */
export type LifecycleRefreshReason = string;
type Listener = (reason: LifecycleRefreshReason) => void;

const listeners = new Set<Listener>();
let active = false;

export const trashRefreshService = Object.freeze({
  activate(): void {
    listeners.clear();
    active = true;
  },

  dispose(): void {
    listeners.clear();
    active = false;
  },

  notify(reason: LifecycleRefreshReason = "unspecified"): void {
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
        "trashRefreshService is not active",
      );
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
});
