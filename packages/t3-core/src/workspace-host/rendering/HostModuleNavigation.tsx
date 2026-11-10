/**
 * HostModuleNavigation (PROMPT 28 §3).
 *
 * Renders all navigation entries from the HostContributionHub's
 * NavigationRegistry. Replaces the deleted shell-owned Navigation.tsx
 * and the deleted ExchangeModuleNavigation fallback branch — every
 * primary/utility item is now module-contributed.
 *
 * Thin adapter over the pre-existing `ModuleNavigation` component: the
 * Host owns the terminology resolver, `ModuleNavigation` owns the
 * router subscription + rendering.
 */

import { ModuleNavigation } from "./ModuleNavigation";

export interface HostModuleNavigationProps {
  termResolver: (key: string, fallback?: string) => string;
}

export function HostModuleNavigation(props: HostModuleNavigationProps) {
  return <ModuleNavigation termResolver={props.termResolver} />;
}
