// Shared test helper for Domain Shell UI tests (PROMPT 11).
import type { ReactNode } from "react";
import { DomainShellProvider } from "../../src/workspace-host/shell";
import genericDomainRaw from "../../fixtures/host-configs/generic/domain.json";
import genericShellRaw from "../../fixtures/host-configs/generic/domain-shell.json";
import genericWorkspaceRaw from "../../fixtures/host-configs/generic/workspace.config.json";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
} from "../../src/config/host-config";

const genericDomain = genericDomainRaw as unknown as DomainConfigDoc;
const genericShell = genericShellRaw as unknown as DomainShellDoc;
const genericWorkspace = genericWorkspaceRaw as unknown as WorkspaceConfigDoc;

export interface ShellOverrides {
  brand?: Partial<DomainShellDoc["brand"]>;
  layout?: Partial<Record<string, unknown>>;
  navigation?: Record<string, unknown>;
  workspace_entry?: Partial<DomainShellDoc["workspace_entry"]>;
}

export function makeShell(overrides: ShellOverrides = {}): DomainShellDoc {
  return {
    ...genericShell,
    brand: { ...genericShell.brand, ...(overrides.brand ?? {}) },
    layout: { ...genericShell.layout, ...(overrides.layout ?? {}) },
    navigation: overrides.navigation ?? genericShell.navigation,
    workspace_entry: { ...genericShell.workspace_entry, ...(overrides.workspace_entry ?? {}) },
  };
}

export function RenderWithShell({
  children,
  shell,
}: {
  children: ReactNode;
  shell?: DomainShellDoc;
}) {
  return (
    <DomainShellProvider
      hostDomain={genericDomain}
      hostShell={shell ?? genericShell}
      hostWorkspace={genericWorkspace}
      fixture="generic"
    >
      {children}
    </DomainShellProvider>
  );
}

export { genericDomain, genericShell, genericWorkspace };
