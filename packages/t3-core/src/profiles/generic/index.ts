/**
 * Generic profile entrypoint. Registration is idempotent — importing this
 * module ensures the generic definition is present in the registry.
 *
 * Generic renderers (note / deck / project) are registered under the
 * profile id "generic" so they can be resolved as the safe fallback for
 * any non-health profile.
 */
import { registerProfileDefinition } from "../definition-registry";
import { GENERIC_PROFILE_DEFINITION } from "./definition";

registerProfileDefinition(GENERIC_PROFILE_DEFINITION);


export { GENERIC_PROFILE_DEFINITION } from "./definition";
