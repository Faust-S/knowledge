/**
 * createDashboardFacade (PROMPT 17 §10).
 *
 * Modules request refresh of Host-owned dashboard cards. No render
 * access, no loader access.
 */

import type { OperationId } from "@/kernel-client";
import type { DashboardFacade } from "@/workspace-contract";
import type { DashboardRegistry } from "../registries/DashboardRegistry";

export interface DashboardState {
  refresh(cardId: string): void;
}

export class DashboardRefreshState implements DashboardState {
  #versions = new Map<string, number>();
  #listeners = new Set<(cardId: string, version: number) => void>();

  refresh(cardId: string): void {
    const version = (this.#versions.get(cardId) ?? 0) + 1;
    this.#versions.set(cardId, version);
    for (const listener of this.#listeners) listener(cardId, version);
  }

  version(cardId: string): number {
    return this.#versions.get(cardId) ?? 0;
  }

  subscribe(listener: (cardId: string, version: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear(): void {
    this.#versions.clear();
    this.#listeners.clear();
  }
}

export interface DashboardFacadeInput {
  registry: DashboardRegistry;
  state: DashboardState;
  grantedOperations?: readonly OperationId[];
  activeCapabilities?: readonly string[];
}

function dashboardAllowed(input: DashboardFacadeInput, cardId: string): boolean {
  const entry = input.registry.get(cardId);
  if (!entry) return false;
  const granted = new Set<string>(input.grantedOperations ?? []);
  const active = new Set<string>(input.activeCapabilities ?? []);
  return entry.requiredOperations.every((operation) => granted.has(operation))
    && entry.requiredCapabilitiesAll.every((capability) => active.has(capability))
    && (entry.requiredCapabilitiesAny.length === 0 ||
      entry.requiredCapabilitiesAny.some((capability) => active.has(capability)));
}

export function createDashboardFacade(
  input: DashboardFacadeInput,
): DashboardFacade {
  const facade: DashboardFacade = {
    refresh(cardId) {
      if (!dashboardAllowed(input, cardId)) return;
      input.state.refresh(cardId);
    },
  };
  return Object.freeze(facade);
}
