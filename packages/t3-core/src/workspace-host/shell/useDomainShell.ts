import { useDomainShellContextInternal, type DomainShellContextValue } from "./DomainShellProvider";

/** Read the currently mounted DomainShell context. */
export function useDomainShell(): DomainShellContextValue {
  return useDomainShellContextInternal();
}
