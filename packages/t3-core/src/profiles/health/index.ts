/**
 * Health profile entrypoint.
 *
 * Registration is guarded by `isHealthProfileEnabled()` — the module can be
 * imported unconditionally (e.g. by the profile-loader), but it will no-op
 * if the build did not opt in via VITE_ENABLE_HEALTH_PROFILE=true.
 */
import { registerProfileDefinition } from "../definition-registry";
import { HEALTH_PROFILE_DEFINITION } from "./definition";
import { HEALTH_LABELS } from "./types";

let registered = false;

export function registerHealthProfile(): boolean {
  if (registered) return true;
  registerProfileDefinition(HEALTH_PROFILE_DEFINITION);
  registered = true;
  return true;
}

export {
  HEALTH_LABELS,
  HEALTH_TYPES,
  HEALTH_EXPORT_WARNING,
  SENSITIVITY_LEVELS,
} from "./types";
export type { HealthType, Sensitivity, SensitiveObject } from "./types";
export { SensitiveObjectRenderer } from "./renderers";
