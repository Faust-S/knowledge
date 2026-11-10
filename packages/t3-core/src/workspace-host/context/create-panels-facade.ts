/**
 * Host-owned state for registered panels. A module can only request opening
 * a permitted contribution through its scoped PanelsFacade.
 * Panel code is loaded and rendered by HostPanelSurface, never by the module.
 */
import type { OperationId } from "@/kernel-client";
import type { PanelsFacade } from "@/workspace-contract";
import type { PanelRegistry } from "../registries/PanelRegistry";

export interface PanelsState {
  request(panelId: string, mode: "open" | "close"): void;
}

const EMPTY_OPEN_PANELS = Object.freeze([] as string[]);

export class HostPanelsState implements PanelsState {
  private opened: readonly string[] = EMPTY_OPEN_PANELS;
  private readonly listeners = new Set<() => void>();

  request(panelId: string, mode: "open" | "close"): void {
    if (!panelId) return;
    const next = mode === "open"
      ? this.opened.includes(panelId) ? this.opened : [...this.opened, panelId]
      : this.opened.includes(panelId) ? this.opened.filter((id) => id !== panelId) : this.opened;
    if (next === this.opened) return;
    this.opened = Object.freeze([...next]);
    for (const listener of this.listeners) listener();
  }

  openIds(): readonly string[] {
    return this.opened;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    this.opened = EMPTY_OPEN_PANELS;
    this.listeners.clear();
  }
}

export interface PanelsFacadeInput {
  registry: PanelRegistry;
  state: PanelsState;
  grantedOperations?: readonly OperationId[];
  activeCapabilities?: readonly string[];
}

function panelAllowed(input: PanelsFacadeInput, panelId: string): boolean {
  const entry = input.registry.get(panelId);
  if (!entry) return false;
  const granted = new Set<string>(input.grantedOperations ?? []);
  const active = new Set<string>(input.activeCapabilities ?? []);
  return entry.requiredOperations.every((operation) => granted.has(operation))
    && entry.requiredCapabilitiesAll.every((capability) => active.has(capability))
    && (entry.requiredCapabilitiesAny.length === 0 ||
      entry.requiredCapabilitiesAny.some((capability) => active.has(capability)));
}

export function createPanelsFacade(input: PanelsFacadeInput): PanelsFacade {
  return Object.freeze({
    open(panelId: string) {
      if (!panelAllowed(input, panelId)) return;
      input.state.request(panelId, "open");
    },
    close(panelId: string) {
      if (!panelAllowed(input, panelId)) return;
      input.state.request(panelId, "close");
    },
  });
}
