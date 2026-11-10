/**
 * Test helpers for ModuleRegistry — PROMPT 13 §11.
 *
 * The helpers assemble minimal-but-real inputs (declarations, loader
 * table entries, contexts) so registry tests can focus on behaviour
 * without duplicating boilerplate.
 */

import {
  createRouteRef,
  defineWorkspaceModule,
  type WorkspaceModuleContext,
  type WorkspaceModuleDefinition,
  type WorkspaceModuleManifest,
  type WorkspaceModuleActivationResult,
} from "@/workspace-contract";
import { ALL_OPERATIONS } from "@/kernel-client";
import type {
  ModuleContextProvider,
  ModuleDeclaration,
} from "@/workspace-host/modules";
import type { RuntimeCompatibilityView } from "@/workspace-contract";

// --- Manifest / definition -------------------------------------------------

export function makeManifest(
  moduleId: string,
  over: Partial<WorkspaceModuleManifest> = {},
): WorkspaceModuleManifest {
  return {
    module_manifest_version: "1.0.0",
    module_id: moduleId,
    module_version: "0.1.0",
    title: `Module ${moduleId}`,
    compatibility: {
      workspace_contract: "0.1.0",
      runtime_contract: "1.3.0",
    },
    contributions: {
      routes: [{ id: `${moduleId}-root` }],
      navigation: [],
      editors: [],
      viewers: [],
      commands: [],
      panels: [],
      dashboard_cards: [],
      validators: [],
      migrations: [],
      legacy_importers: [],
    },
    security: {
      direct_indexeddb: false,
      remote_code: false,
      iwxa_executable_payload: false,
    },
    ...over,
  } as WorkspaceModuleManifest;
}

export function makeModule(
  moduleId: string,
  options: {
    activation?: WorkspaceModuleActivationResult | void;
    activate?: (ctx: WorkspaceModuleContext) => WorkspaceModuleActivationResult | void | Promise<WorkspaceModuleActivationResult | void>;
    deactivate?: () => void | Promise<void>;
    manifestOverrides?: Partial<WorkspaceModuleManifest>;
  } = {},
): WorkspaceModuleDefinition {
  const manifest = makeManifest(moduleId, options.manifestOverrides);
  const defaultActivation: WorkspaceModuleActivationResult = {
    contributions: {
      routes: [
        {
          kind: "route",
          id: `${moduleId}-root`,
          moduleId,
          requiredOperations: [],
          routeRef: createRouteRef(`${moduleId}-root`),
          loader: async () => ({ default: () => null }),
        },
      ],
    },
  };
  return defineWorkspaceModule({
    manifest,
    activate: options.activate ?? (() => options.activation ?? defaultActivation),
    deactivate: options.deactivate,
  });
}

// --- Declarations ----------------------------------------------------------

export function buildDeclarations(
  spec: readonly {
    id: string;
    state?: ModuleDeclaration["state"];
    requiredLevels?: ModuleDeclaration["requiredLevels"];
    requiredOperations?: ModuleDeclaration["requiredOperations"];
    dependencies?: string[];
  }[],
): ModuleDeclaration[] {
  return spec.map((s) => ({
    moduleId: s.id,
    state: s.state ?? "active",
    requiredLevels: s.requiredLevels ?? [],
    requiredOperations: s.requiredOperations ?? [],
    dependencies: s.dependencies ?? [],
  }));
}

// --- Runtime view ----------------------------------------------------------

export function buildRuntimeView(
  over: Partial<RuntimeCompatibilityView> = {},
): RuntimeCompatibilityView {
  return {
    contractVersion: "1.3.0",
    grantedLevels: ["T0", "T1", "T2"],
    grantedOperations: [...ALL_OPERATIONS],
    ...over,
  };
}

// --- Context provider ------------------------------------------------------

/**
 * Minimal fake context. Modules in tests only need the SHAPE of the
 * facades — the registry never inspects or invokes them itself.
 */
export function fakeContextProvider(): ModuleContextProvider {
  return {
    createContext(): WorkspaceModuleContext {
      const noop = () => {};
      const asyncNoop = async () => {
        throw new Error("test context: kernel not wired");
      };
      const ctx: WorkspaceModuleContext = {
        kernel: {
          hasOperation: () => true,
          grantedOperations: [...ALL_OPERATIONS],
          grantedLevels: ["T0", "T1", "T2"],
          listWorkspaces: asyncNoop as never,
          getWorkspace: asyncNoop as never,
          createWorkspace: asyncNoop as never,
          listObjects: asyncNoop as never,
          getObject: asyncNoop as never,
          listEventsSince: asyncNoop as never,
          putObject: asyncNoop as never,
          deleteObject: asyncNoop as never,
          putRelation: asyncNoop as never,
          deleteRelation: asyncNoop as never,
          listAssets: asyncNoop as never,
          getAsset: asyncNoop as never,
          putAsset: asyncNoop as never,
          deleteAsset: asyncNoop as never,
          softDeleteWorkspace: asyncNoop as never,
          restoreWorkspace: asyncNoop as never,
          purgePreview: asyncNoop as never,
          purgeCommit: asyncNoop as never,
          purgeCancel: asyncNoop as never,
          exportPreview: asyncNoop as never,
          exportPackage: asyncNoop as never,
          confirmExport: asyncNoop as never,
          importPreview: asyncNoop as never,
          importCommit: asyncNoop as never,
          importCancel: asyncNoop as never,
        },
        router: { navigate: noop, current: () => null },
        commands: { invoke: async () => {} },
        views: { resolve: () => false },
        panels: { open: noop, close: noop },
        dashboard: { refresh: noop },
        terminology: { term: (_k, f) => f ?? "" },
        diagnostics: { report: noop },
        currentWorkspace: { get: () => null, subscribe: () => () => {} },
        profile: {
          id: "generic",
          definition: { id: "generic", label: "Generic", description: "", accent: "#64748b" },
          fallback: false,
        },
      };
      return ctx;
    },
  };
}
