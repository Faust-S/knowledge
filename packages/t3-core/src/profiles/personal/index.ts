import { registerProfileDefinition } from "../definition-registry";
import { PERSONAL_PROFILE_DEFINITION } from "./definition";
/**
 * Personal profile entrypoint. Import for its side effects to enable the
 * profile's renderers in the shared registry.
 */
import { PERSONAL_LABELS } from "./types";

registerProfileDefinition(PERSONAL_PROFILE_DEFINITION);


export { PERSONAL_LABELS, PERSONAL_TYPES } from "./types";
export type {
  PersonalType,
  Role,
  Goal,
  Project,
  Evidence,
  ActivityEvent,
} from "./types";
export * from "./renderers";
