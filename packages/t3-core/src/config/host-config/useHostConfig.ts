import { useEffect, useState } from "react";
import { loadHostConfig, readFixtureFromLocation } from "./load-host-config";
import type { HostConfigResult } from "./types";

const INITIAL: HostConfigResult = {
  status: "idle",
  domain: null,
  shell: null,
  workspace: null,
  diagnostics: [],
  error: null,
  fixture: null,
};

/**
 * React hook: loads /_iwxa/domain.json, /_iwxa/domain-shell.json and
 * /workspace/workspace.config.json in parallel, applies AJV + cross-file
 * validation, and exposes the tri-document HostConfigResult. Never merges
 * the three sources.
 */
export function useHostConfig(): HostConfigResult {
  const [state, setState] = useState<HostConfigResult>({
    ...INITIAL,
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const fixture = readFixtureFromLocation();
    loadHostConfig({ fixture }).then((res) => {
      if (!cancelled) setState(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
