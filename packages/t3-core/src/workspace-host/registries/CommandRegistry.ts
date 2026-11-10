/**
 * CommandRegistry (PROMPT 17 §5, extended in PROMPT 29).
 *
 * Cross-module command dispatch with:
 *   - Owner-scoped context (§3): the handler ALWAYS runs against the
 *     WorkspaceModuleContext of the module that OWNS the command, not
 *     the caller's context. This is required for lifecycle commands
 *     which need a lifecycle-scoped KernelFacade regardless of who
 *     invoked them.
 *   - Cycle & depth guard (§4): a per-invocation stack tracks the
 *     chain of active command ids and blocks re-entry with
 *     `command-cycle`; a hard depth limit blocks runaway chains with
 *     `command-depth-exceeded`.
 *   - Typed result (§2): the value returned by `handler.run(ctx, args)`
 *     is returned verbatim to the caller.
 *   - Capability re-check (§12): required operations are validated
 *     both before the loader runs and before the handler runs.
 */

import type { CommandContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import {
  RegistryBase,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryEntryInput,
} from "./RegistryBase";

export type CommandInvokeErrorCode =
  | "unknown-command"
  | "operation-not-granted"
  | "capability-not-granted"
  | "loader-failed"
  | "handler-invalid"
  | "handler-threw"
  | "command-cycle"
  | "command-depth-exceeded"
  | "owner-context-unavailable";

export class CommandInvocationError extends Error {
  constructor(
    public readonly code: CommandInvokeErrorCode,
    public readonly commandId: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CommandInvocationError";
  }
}

/**
 * Maximum synchronous nesting depth of command invocations. Well
 * beyond any realistic orchestration (typical: 1–2) but low enough to
 * fail fast on runaway chains.
 */
export const MAX_COMMAND_INVOCATION_DEPTH = 16;

/**
 * Resolver that hands the Host-scoped context of the OWNING module
 * back to the registry. `invocationStack` MUST be forwarded into the
 * commands facade of the returned context so that nested invocations
 * inherit the cycle guard (see `createCommandsFacade`).
 */
export type CommandContextResolver = (
  ownerModuleId: string,
  invocationStack: readonly string[],
) => unknown;

type CapabilityAwareOwnerContext = {
  currentWorkspace?: { get(): { workspace_id?: string } | null };
  kernel?: { hasCapability(workspaceId: string, capabilityId: string): Promise<boolean> };
};

async function ownerContextCapabilitiesSatisfied(
  ctx: unknown,
  requiredAll: readonly string[],
  requiredAny: readonly string[],
): Promise<boolean> {
  if (requiredAll.length === 0 && requiredAny.length === 0) return true;
  const owner = ctx as CapabilityAwareOwnerContext;
  const workspaceId = owner.currentWorkspace?.get()?.workspace_id;
  const hasCapability = owner.kernel?.hasCapability;
  if (!workspaceId || typeof hasCapability !== "function") return false;
  for (const capability of requiredAll) {
    if (!(await hasCapability.call(owner.kernel, workspaceId, capability))) return false;
  }
  if (requiredAny.length > 0) {
    let any = false;
    for (const capability of requiredAny) {
      if (await hasCapability.call(owner.kernel, workspaceId, capability)) { any = true; break; }
    }
    if (!any) return false;
  }
  return true;
}

export class CommandRegistry extends RegistryBase<CommandContribution> {
  constructor() {
    super("commands");
  }

  protected override additionalValidate(
    entry: RegistryEntryInput<CommandContribution>,
  ): RegistryDiagnostic[] {
    const diags: RegistryDiagnostic[] = [];
    const c = entry.contribution;
    if (c.kind !== "command") {
      diags.push({
        code: "invalid-contribution",
        message: `commands: "${entry.contributionId}" kind is "${c.kind}", expected "command".`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "commands",
      });
    }
    if (typeof c.loader !== "function") {
      diags.push({
        code: "invalid-contribution",
        message: `commands: "${entry.contributionId}" loader must be a function.`,
        contributionId: entry.contributionId,
        ownerModuleId: entry.ownerModuleId,
        group: "commands",
      });
    }
    return diags;
  }

  /**
   * Capability-aware lookup for `CommandsFacade.has()` (PROMPT 29 §12).
   * Returns true iff the command is registered AND every required
   * operation is present in `grantedOperations`.
   */
  isInvocable(
    commandId: string,
    grantedOperations: readonly OperationId[],
    activeCapabilities: readonly string[] = [],
  ): boolean {
    const entry = this.get(commandId);
    if (!entry) return false;
    const granted = new Set<string>(grantedOperations as readonly string[]);
    for (const op of entry.requiredOperations) {
      if (!granted.has(op)) return false;
    }
    const active = new Set<string>(activeCapabilities);
    if (entry.requiredCapabilitiesAll.some((capability) => !active.has(capability))) return false;
    if (entry.requiredCapabilitiesAny.length > 0 && !entry.requiredCapabilitiesAny.some((capability) => active.has(capability))) return false;
    return true;
  }

  /**
   * Host-side invocation. The caller passes the current
   * `invocationStack` — normally empty from top-level UI, non-empty
   * from a command handler that re-invokes through the CommandsFacade
   * of an owner context.
   *
   * Returns the value produced by `handler.run(ownerCtx, args)`.
   */
  async invoke<TResult = unknown>(
    commandId: string,
    args: unknown,
    grantedOperations: readonly OperationId[],
    contextResolver: CommandContextResolver,
    invocationStack: readonly string[] = [],
    activeCapabilities: readonly string[] = [],
  ): Promise<TResult> {
    // Cycle & depth guards run BEFORE the capability check so that a
    // runaway chain fails fast with a stable diagnostic even when
    // capabilities happen to be missing.
    if (invocationStack.includes(commandId)) {
      throw new CommandInvocationError(
        "command-cycle",
        commandId,
        `command cycle detected: ${[...invocationStack, commandId].join(" → ")}`,
      );
    }
    if (invocationStack.length >= MAX_COMMAND_INVOCATION_DEPTH) {
      throw new CommandInvocationError(
        "command-depth-exceeded",
        commandId,
        `command invocation depth exceeded ${MAX_COMMAND_INVOCATION_DEPTH}: ${[
          ...invocationStack,
          commandId,
        ].join(" → ")}`,
      );
    }

    const entry = this.get(commandId);
    if (!entry) {
      throw new CommandInvocationError(
        "unknown-command",
        commandId,
        `command "${commandId}" is not registered`,
      );
    }
    // Capability gate #1 — refuse the loader if any op is missing.
    const granted = new Set<string>(grantedOperations as readonly string[]);
    for (const op of entry.requiredOperations) {
      if (!granted.has(op)) {
        throw new CommandInvocationError(
          "operation-not-granted",
          commandId,
          `command "${commandId}" requires ungranted operation "${op}"`,
        );
      }
    }
    const active = new Set<string>(activeCapabilities);
    const missingAll = entry.requiredCapabilitiesAll.find((capability) => !active.has(capability));
    if (missingAll || (entry.requiredCapabilitiesAny.length > 0 && !entry.requiredCapabilitiesAny.some((capability) => active.has(capability)))) {
      throw new CommandInvocationError(
        "capability-not-granted",
        commandId,
        `command "${commandId}" requires an inactive capability`,
      );
    }
    let mod: {
      run(ctx: unknown, args?: unknown): Promise<unknown> | unknown;
    };
    try {
      mod = (await entry.contribution.loader()) as typeof mod;
    } catch (err) {
      throw new CommandInvocationError(
        "loader-failed",
        commandId,
        `loader for command "${commandId}" threw`,
        err,
      );
    }
    if (!mod || typeof mod.run !== "function") {
      throw new CommandInvocationError(
        "handler-invalid",
        commandId,
        `command "${commandId}" loader must export { run(ctx, args?) }`,
      );
    }
    // Capability gate #2 — re-verify AFTER the async loader, in case
    // the granted set was narrowed while the loader was pending.
    for (const op of entry.requiredOperations) {
      if (!granted.has(op)) {
        throw new CommandInvocationError(
          "operation-not-granted",
          commandId,
          `command "${commandId}" requires ungranted operation "${op}"`,
        );
      }
    }
    // Resolve the OWNER's context — never the caller's. The stack
    // passed to the resolver is the stack that the owner's own
    // `commands` facade will inherit for nested invocations.
    const nextStack = Object.freeze([...invocationStack, commandId]);
    let ownerCtx: unknown;
    try {
      ownerCtx = contextResolver(entry.ownerModuleId, nextStack);
    } catch (err) {
      throw new CommandInvocationError(
        "owner-context-unavailable",
        commandId,
        `owner context for module "${entry.ownerModuleId}" is unavailable`,
        err,
      );
    }
    if (ownerCtx === null || ownerCtx === undefined) {
      throw new CommandInvocationError(
        "owner-context-unavailable",
        commandId,
        `owner context for module "${entry.ownerModuleId}" is unavailable`,
      );
    }
    // Frozen Capability Guard Contract 0.3.1: after the async loader,
    // re-check against the live Kernel authorization view for the current
    // workspace. The pre-loader snapshot is only a visibility/early-deny
    // guard; this live check prevents a stale UI snapshot from authorizing
    // command execution. Kernel primitive guards remain authoritative.
    if (!(await ownerContextCapabilitiesSatisfied(
      ownerCtx,
      entry.requiredCapabilitiesAll,
      entry.requiredCapabilitiesAny,
    ))) {
      throw new CommandInvocationError(
        "capability-not-granted",
        commandId,
        `command "${commandId}" capability requirement is no longer ACTIVE for the current workspace`,
      );
    }
    try {
      const outcome = mod.run(ownerCtx, args);
      const value = (outcome && typeof (outcome as Promise<unknown>).then === "function")
        ? await (outcome as Promise<unknown>)
        : outcome;
      return value as TResult;
    } catch (err) {
      if (err instanceof CommandInvocationError) {
        // Nested invocation surfaced its own typed error — propagate
        // unwrapped so callers can classify cycles / permissions
        // deterministically.
        throw err;
      }
      throw new CommandInvocationError(
        "handler-threw",
        commandId,
        `handler for command "${commandId}" threw`,
        err,
      );
    }
  }

  entries(): readonly RegistryEntry<CommandContribution>[] {
    return this.snapshot();
  }
}
