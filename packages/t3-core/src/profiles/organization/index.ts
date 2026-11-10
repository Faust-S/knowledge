import { registerProfileDefinition } from "../definition-registry";
import { ORGANIZATION_PROFILE_DEFINITION } from "./definition";
import { ORGANIZATION_LABELS } from "./types";

registerProfileDefinition(ORGANIZATION_PROFILE_DEFINITION);


export { ORGANIZATION_LABELS, ORGANIZATION_TYPES } from "./types";
export type {
  OrganizationType,
  DiagnosticCase,
  AnalyticalResult,
  Finding,
  Risk,
  Action,
  Process,
  Route,
} from "./types";
export * from "./renderers";
