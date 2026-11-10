/**
 * CurrentWorkspaceStore (PROMPT 17 §10).
 *
 * Host-owned in-memory store for the workspace the shell is currently
 * focused on. NEVER persisted — always reset on reload.
 */

import type { WorkspaceRecord } from "@/kernel-client/contracts/runtime-1.3.0";

export class CurrentWorkspaceStore {
  private current: WorkspaceRecord | null = null;
  private readonly listeners = new Set<(w: WorkspaceRecord | null) => void>();

  get(): WorkspaceRecord | null {
    return this.current;
  }

  set(next: WorkspaceRecord | null): void {
    if (this.current === next) return;
    this.current = next;
    for (const l of this.listeners) l(next);
  }

  subscribe(listener: (w: WorkspaceRecord | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.current = null;
    this.listeners.clear();
  }
}
