import type { KernelObject } from "./types";
import type { LearningRoute, Task, CompetencyGap } from "./types";

/**
 * Group learning objects for the overview panels.
 *
 * Grouping rules (kernel-agnostic — the shell only reads declared fields):
 *   - Tasks group by `goalId`, then by `routeId`.
 *   - Learning routes attach to a `goalId` and reference `gapIds[]`.
 *   - Practice results and reflections stay ungrouped in the flat feed.
 *
 * Provenance ("origin") for gaps is exposed verbatim from `data.source`
 * (`career | lad | study | practice | calculators`). The shell does not
 * infer origin — if the kernel doesn't declare it, no chip is shown.
 */

export interface GoalGroup {
  goalId: string;
  goal: KernelObject | null;
  routes: RouteGroup[];
  looseTasks: KernelObject[];
  gaps: KernelObject[];
}

export interface RouteGroup {
  routeId: string;
  route: KernelObject;
  tasks: KernelObject[];
  goalId: string | null;
  gapIds: string[];
}

export interface LearningGrouping {
  goals: GoalGroup[];
  /** Goals mentioned by tasks/routes but not present as objects. */
  orphanGoalIds: string[];
  /** Objects that don't attach to any goal or route. */
  standalone: KernelObject[];
}

function readData<T>(o: KernelObject): Partial<T> {
  return (o.data ?? {}) as Partial<T>;
}

export function groupLearningObjects(
  objects: KernelObject[],
): LearningGrouping {
  const goals: Record<string, KernelObject> = {};
  const routesByGoal: Record<string, KernelObject[]> = {};
  const looseRoutes: KernelObject[] = [];
  const tasksByRoute: Record<string, KernelObject[]> = {};
  const tasksByGoal: Record<string, KernelObject[]> = {};
  const gapsByGoal: Record<string, KernelObject[]> = {};
  const looseGaps: KernelObject[] = [];
  const standalone: KernelObject[] = [];

  const seenGoalIds = new Set<string>();

  // Pass 1 — index by declared parent references.
  for (const o of objects) {
    switch (o.type) {
      case "learning-goal":
        goals[o.id] = o;
        break;
      case "learning-route": {
        const d = readData<LearningRoute>(o);
        if (d.goalId) {
          (routesByGoal[d.goalId] ??= []).push(o);
          seenGoalIds.add(d.goalId);
        } else {
          looseRoutes.push(o);
        }
        break;
      }
      case "task": {
        const d = readData<Task>(o);
        if (d.routeId) {
          (tasksByRoute[d.routeId] ??= []).push(o);
        } else if (d.goalId) {
          (tasksByGoal[d.goalId] ??= []).push(o);
          seenGoalIds.add(d.goalId);
        } else {
          standalone.push(o);
        }
        break;
      }
      case "competency-gap": {
        const d = readData<CompetencyGap>(o);
        // Gaps aren't required to bind to a goal — many arrive from
        // /career/ or /calculators/. Bind opportunistically when a goal
        // objects references the same competency id via a route.
        const boundGoalId = findGoalForGap(o, objects);
        if (boundGoalId) {
          (gapsByGoal[boundGoalId] ??= []).push(o);
          seenGoalIds.add(boundGoalId);
        } else {
          looseGaps.push(o);
        }
        // `d` reserved for future provenance-based binding.
        void d;
        break;
      }
      default:
        standalone.push(o);
    }
  }

  // Pass 2 — assemble goal groups (including orphan goal ids we saw).
  const allGoalIds = new Set<string>([
    ...Object.keys(goals),
    ...seenGoalIds,
  ]);
  const goalGroups: GoalGroup[] = [];
  for (const gid of allGoalIds) {
    const routeGroups: RouteGroup[] = (routesByGoal[gid] ?? []).map((r) => {
      const rd = readData<LearningRoute>(r);
      return {
        routeId: r.id,
        route: r,
        tasks: tasksByRoute[r.id] ?? [],
        goalId: gid,
        gapIds: rd.gapIds ?? [],
      };
    });
    goalGroups.push({
      goalId: gid,
      goal: goals[gid] ?? null,
      routes: routeGroups,
      looseTasks: tasksByGoal[gid] ?? [],
      gaps: gapsByGoal[gid] ?? [],
    });
  }

  // Loose routes / gaps get a synthetic "unassigned" bucket.
  if (looseRoutes.length > 0 || looseGaps.length > 0) {
    const rgroups: RouteGroup[] = looseRoutes.map((r) => {
      const rd = readData<LearningRoute>(r);
      return {
        routeId: r.id,
        route: r,
        tasks: tasksByRoute[r.id] ?? [],
        goalId: null,
        gapIds: rd.gapIds ?? [],
      };
    });
    goalGroups.push({
      goalId: "__unassigned__",
      goal: null,
      routes: rgroups,
      looseTasks: [],
      gaps: looseGaps,
    });
  }

  const orphanGoalIds = [...seenGoalIds].filter((id) => !(id in goals));

  return { goals: goalGroups, orphanGoalIds, standalone };
}

/**
 * Given a competency-gap, walk learning-route objects to see if any route
 * declares this gap and is bound to a goal. Cheap O(routes × gapIds).
 */
function findGoalForGap(
  gap: KernelObject,
  all: KernelObject[],
): string | null {
  for (const o of all) {
    if (o.type !== "learning-route") continue;
    const d = (o.data ?? {}) as unknown as LearningRoute;
    if (d.gapIds?.includes(gap.id) && d.goalId) return d.goalId;
  }
  return null;
}
