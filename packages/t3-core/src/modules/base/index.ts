/**
 * iwxa.workspace.base — public barrel.
 *
 * Loaded EXCLUSIVELY through the compile-time loader table in
 * `src/composition/available-modules.ts`. Nothing else imports this
 * module directly.
 */

export { default } from "./module";
export { MODULE_ID } from "./module-id";
export { BASE_ROUTE_INVENTORY } from "./routes";
export { BASE_NAVIGATION_INVENTORY } from "./navigation";
