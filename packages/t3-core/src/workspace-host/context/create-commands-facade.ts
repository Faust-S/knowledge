/**
 * createCommandsFacade (PROMPT 17 §10, rewired in PROMPT 29 §§1-4, 12).
 *
 * The facade never reveals other modules' handlers, loaders, or the
 * registry itself. Every invocation flows through the registry, which:
 *   - re-verifies capabilities (§12);
 *   - resolves the OWNER module's context (§3);
 *   - tracks the invocation stack for cycle/depth protection (§4);
 *   - returns the handler's typed result (§2).
 *
 * The `hostContext` seat that the older facade carried is gone: the
 * caller can no longer inject a substitute context.
 */

import type { CommandsFacade } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type {
  CommandContextResolver,
  CommandRegistry,
} from "../registries/CommandRegistry";

export interface CommandsFacadeInput {
  /** Identifier of the module that owns THIS facade (the caller). */
  moduleId: string;
  registry: CommandRegistry;
  grantedOperations: readonly OperationId[];
  activeCapabilities?: readonly string[];
  /**
   * Registry-owned resolver that produces the OWNER module's context
   * for a given command. See `CommandRegistry.invoke`.
   */
  contextResolver: CommandContextResolver;
  /**
   * The invocation stack this facade participates in. Empty for
   * top-level (UI, activation); non-empty for facades handed to a
   * command handler as `ownerCtx.commands`, so that nested invokes
   * inherit the cycle guard.
   */
  invocationStack?: readonly string[];
}

export function createCommandsFacade(input: CommandsFacadeInput): CommandsFacade {
  const stack = Object.freeze([...(input.invocationStack ?? [])]);
  const activeCapabilities = Object.freeze([...(input.activeCapabilities ?? [])]);
  const facade: CommandsFacade = {
    has(commandId) {
      if (typeof commandId !== "string" || commandId.length === 0) return false;
      return input.registry.isInvocable(commandId, input.grantedOperations, activeCapabilities);
    },
    async invoke(commandId, args) {
      return input.registry.invoke(
        commandId,
        args,
        input.grantedOperations,
        input.contextResolver,
        stack,
        activeCapabilities,
      );
    },
  };
  return Object.freeze(facade);
}
