/**
 * Dependency graph analysis for ModuleRegistry (PROMPT 13 §4 / PROMPT 15 §1).
 *
 * Pure functions over `ModuleDeclaration[]`. No side-effects, no I/O.
 *
 * PROMPT 15 §1 — dependency failures propagate transitively. If A is
 * failed and B depends on A (directly or through a chain), B is also
 * quarantined with a `dependency-unavailable` diagnostic that includes
 * the dependency chain leading to the original failure.
 */

import type { ModuleDeclaration } from "./module-types";
import { registryDiagnostic, type RegistryDiagnostic } from "./module-diagnostics";

export interface DependencyAnalysis {
  order: string[];
  perModule: Map<string, RegistryDiagnostic[]>;
  failed: Set<string>;
  duplicates: string[];
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function analyzeDependencies(
  declarations: readonly ModuleDeclaration[],
): DependencyAnalysis {
  const perModule = new Map<string, RegistryDiagnostic[]>();
  const failed = new Set<string>();
  const duplicates: string[] = [];

  const push = (moduleId: string, d: RegistryDiagnostic) => {
    const arr = perModule.get(moduleId) ?? [];
    arr.push(d);
    perModule.set(moduleId, arr);
  };

  // --- Duplicate detection ------------------------------------------------
  const seen = new Set<string>();
  const uniqueDecls: ModuleDeclaration[] = [];
  for (const decl of declarations) {
    if (seen.has(decl.moduleId)) {
      duplicates.push(decl.moduleId);
      failed.add(decl.moduleId);
      push(
        decl.moduleId,
        registryDiagnostic(
          "duplicate-module-id",
          `Модуль "${decl.moduleId}" объявлен более одного раза в workspace.config.json.`,
          { moduleId: decl.moduleId },
        ),
      );
      continue;
    }
    seen.add(decl.moduleId);
    uniqueDecls.push(decl);
  }

  const byIdMap = new Map<string, ModuleDeclaration>();
  for (const d of uniqueDecls) byIdMap.set(d.moduleId, d);

  // --- Dependency shape checks --------------------------------------------
  for (const decl of uniqueDecls) {
    for (const dep of decl.dependencies) {
      if (dep === decl.moduleId) {
        failed.add(decl.moduleId);
        push(
          decl.moduleId,
          registryDiagnostic(
            "dependency-cycle",
            `Модуль "${decl.moduleId}" зависит от самого себя.`,
            { moduleId: decl.moduleId, details: { chain: [decl.moduleId, decl.moduleId] } },
          ),
        );
        continue;
      }
      const target = byIdMap.get(dep);
      if (!target) {
        failed.add(decl.moduleId);
        push(
          decl.moduleId,
          registryDiagnostic(
            "missing-dependency",
            `Зависимость "${dep}" модуля "${decl.moduleId}" не объявлена в workspace.config.json.`,
            { moduleId: decl.moduleId, details: { dependency: dep } },
          ),
        );
        continue;
      }
      if (target.state !== "active") {
        failed.add(decl.moduleId);
        push(
          decl.moduleId,
          registryDiagnostic(
            "inactive-dependency",
            `Зависимость "${dep}" модуля "${decl.moduleId}" находится в состоянии "${target.state}".`,
            { moduleId: decl.moduleId, details: { dependency: dep, dependencyState: target.state } },
          ),
        );
      }
    }
  }

  // --- Cycle detection ----------------------------------------------------
  const activeIds = uniqueDecls
    .filter((d) => d.state === "active")
    .map((d) => d.moduleId)
    .sort(byId);
  const activeSet = new Set(activeIds);

  const color = new Map<string, 0 | 1 | 2>();
  for (const id of activeIds) color.set(id, 0);

  const dfs = (start: string): string[] | null => {
    const stack: { id: string; iter: Iterator<string> }[] = [];
    const path: string[] = [];
    const pathSet = new Set<string>();

    const openFrame = (id: string) => {
      color.set(id, 1);
      path.push(id);
      pathSet.add(id);
      const decl = byIdMap.get(id)!;
      const deps = decl.dependencies
        .filter((d) => activeSet.has(d))
        .sort(byId);
      stack.push({ id, iter: deps[Symbol.iterator]() });
    };

    openFrame(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const step = frame.iter.next();
      if (step.done) {
        color.set(frame.id, 2);
        pathSet.delete(frame.id);
        path.pop();
        stack.pop();
        continue;
      }
      const next = step.value as string;
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const startIdx = path.indexOf(next);
        return [...path.slice(startIdx), next];
      }
      if (c === 0) openFrame(next);
    }
    return null;
  };

  for (const id of activeIds) {
    if (color.get(id) !== 0) continue;
    const cycle = dfs(id);
    if (cycle) {
      const label = cycle.join(" → ");
      for (let i = 0; i < cycle.length - 1; i++) {
        const m = cycle[i]!;
        failed.add(m);
        push(
          m,
          registryDiagnostic(
            "dependency-cycle",
            `Обнаружен цикл зависимостей: ${label}.`,
            { moduleId: m, details: { chain: cycle } },
          ),
        );
      }
    }
  }

  // --- PROMPT 15 §1: transitive failure propagation ----------------------
  // Build dependents index over active nodes.
  const dependents = new Map<string, string[]>();
  for (const id of activeIds) dependents.set(id, []);
  for (const decl of uniqueDecls) {
    if (decl.state !== "active") continue;
    for (const dep of decl.dependencies) {
      if (activeSet.has(dep)) dependents.get(dep)!.push(decl.moduleId);
    }
  }

  // BFS from every initially-failed active node through the dependents
  // relation. Record the shortest chain (originalFailedRoot → ... → me).
  const queue: Array<{ id: string; chain: string[] }> = [];
  const initialFailed = new Set<string>();
  for (const id of activeIds) {
    if (failed.has(id)) {
      initialFailed.add(id);
      queue.push({ id, chain: [id] });
    }
  }
  const visited = new Set<string>(initialFailed);
  while (queue.length > 0) {
    const { id, chain } = queue.shift()!;
    for (const dependent of dependents.get(id) ?? []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      failed.add(dependent);
      const nextChain = [...chain, dependent];
      push(
        dependent,
        registryDiagnostic(
          "dependency-unavailable",
          `Модуль "${dependent}" не может быть активирован: недоступна зависимость "${id}".`,
          {
            moduleId: dependent,
            details: { chain: nextChain, rootFailedDependency: chain[0] },
          },
        ),
      );
      queue.push({ id: dependent, chain: nextChain });
    }
  }

  // --- Kahn's algorithm ---------------------------------------------------
  const order: string[] = [];
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  for (const id of activeIds) {
    indegree.set(id, 0);
    graph.set(id, []);
  }
  for (const id of activeIds) {
    if (failed.has(id)) continue;
    const decl = byIdMap.get(id)!;
    for (const dep of decl.dependencies) {
      if (!activeSet.has(dep) || failed.has(dep)) continue;
      graph.get(dep)!.push(id);
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const id of activeIds) {
    if (failed.has(id)) continue;
    if ((indegree.get(id) ?? 0) === 0) ready.push(id);
  }
  ready.sort(byId);

  while (ready.length > 0) {
    ready.sort(byId);
    const next = ready.shift()!;
    if (failed.has(next)) continue;
    order.push(next);
    for (const dependent of graph.get(next) ?? []) {
      if (failed.has(dependent)) continue;
      const d = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, d);
      if (d === 0) ready.push(dependent);
    }
  }

  return { order, perModule, failed, duplicates };
}
