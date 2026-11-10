import { registerProfileDefinition } from "../definition-registry";
import { LEARNING_PROFILE_DEFINITION } from "./definition";
/**
 * Learning profile entrypoint. Importing this module registers all learning
 * renderers into the global renderer registry and the profile definition
 * into the definition registry.
 */
import { LEARNING_LABELS } from "./types";

registerProfileDefinition(LEARNING_PROFILE_DEFINITION);


export { LEARNING_TYPES, LEARNING_LABELS } from "./types";
export type {
  LearningType,
  LearningGoal,
  Competency,
  CompetencyGap,
  CareerRoute,
  LearningRoute,
  Task,
  PracticeResult,
  Reflection,
} from "./types";
export {
  groupLearningObjects,
  type GoalGroup,
  type RouteGroup,
  type LearningGrouping,
} from "./grouping";
export * from "./renderers";
