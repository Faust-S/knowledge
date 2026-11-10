import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runRealKernelRoundtrip } from "./real-kernel-e2e.mjs";

const [artifactDirArg, outputPathArg] = process.argv.slice(2);

if (!artifactDirArg || !outputPathArg) {
  console.error(
    "usage: node scripts/run-real-kernel-qualification.mjs <kernel-artifact-dir> <result-json>",
  );
  process.exit(64);
}

const artifactDir = resolve(artifactDirArg);
const outputPath = resolve(outputPathArg);
const timeoutMs = Number.parseInt(
  process.env.IWXA_REAL_KERNEL_TIMEOUT_MS ?? "240000",
  10,
);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("IWXA_REAL_KERNEL_TIMEOUT_MS must be a positive integer");
  process.exit(64);
}

const evidence = {
  schemaVersion: "iwxa.t2.windows-k035-runtime.v2",
  status: "FAIL",
  artifactDir,
  timeoutMs,
  command:
    "node scripts/run-real-kernel-qualification.mjs <kernel-artifact-dir> <result-json>",
  checks: {},
  result: null,
  error: null,
};

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return { name: "Error", message: String(error), stack: null };
}

const requiredOperations = [
  "t1.createWorkspace",
  "t1.listWorkspaces",
  "t1.getWorkspace",
  "t1.putObject",
  "t1.listObjects",
  "t1.getObject",
  "t1.softDeleteWorkspace",
  "t1.restoreWorkspace",
  "t1.purgePreview",
  "t1.purgeCommit",
  "t1.purgeCancel",
  "t2.exportPreview",
  "t2.exportPackage",
  "t2.confirmExport",
  "t2.importPreview",
  "t2.importCommit",
  "t2.importCancel",
];

let timeoutHandle = null;
let timeoutFired = false;

try {
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timeoutFired = true;
      reject(new Error(`REAL_KERNEL_QUALIFICATION_TIMEOUT:${timeoutMs}`));
    }, timeoutMs);
  });

  const result = await Promise.race([
    runRealKernelRoundtrip({ artifactDir }),
    timeout,
  ]);

  if (timeoutHandle) clearTimeout(timeoutHandle);

  const grantedLevels = Array.isArray(result?.envelope?.granted_levels)
    ? result.envelope.granted_levels
    : [];
  const grantedOperations = Array.isArray(result?.envelope?.granted_operations)
    ? result.envelope.granted_operations
    : [];
  const expectedRoute = `#/workspace/${result?.main_workspace_id}/object/${result?.object_id}`;

  const checks = {
    sourceRealKernel: result?.source === "real-kernel",
    contractVersion12: result?.envelope?.contract_version === "1.2.0",
    runtimeVersion035: result?.envelope?.runtime_version === "0.3.5",
    t1Granted: grantedLevels.includes("T1"),
    t2Granted: grantedLevels.includes("T2"),
    requiredOperationsGranted: requiredOperations.every((operation) =>
      grantedOperations.includes(operation),
    ),
    controlPlaneEndpoint:
      result?.control_plane_probe?.ok === true &&
      result?.control_plane_probe?.schema_version === "0.3.1",
    exportConfirmed: result?.export_confirmed === true,
    importCommitted: result?.import_committed === true,
    importCancelled: result?.import_cancelled === true,
    restoreAsserted: result?.restore_asserted === true,
    purgeCancelled: result?.purge_cancelled === true,
    purgeAsserted: result?.purge_asserted === true,
    staticRoutesAsserted: result?.static_routes_asserted === true,
    domRouteCanonical: result?.dom?.route === expectedRoute,
    domObjectViewVisible: result?.dom?.object_view_visible === true,
    domContainsObjectId: result?.dom?.dom_contains_object_id === true,
    overviewVisible: result?.ui?.overview_visible === true,
    dashboardCardVisible: result?.ui?.dashboard_card_visible === true,
    workspaceDetailVisible: result?.ui?.workspace_detail_visible === true,
    richWorkspaceVisible: result?.ui?.rich_workspace_visible === true,
    objectsModeVisible: result?.ui?.objects_mode_visible === true,
    queuesModeVisible: result?.ui?.queues_mode_visible === true,
    compareModeVisible: result?.ui?.compare_mode_visible === true,
    receiptsModeVisible: result?.ui?.receipts_mode_visible === true,
    savedViewsVisible: result?.ui?.saved_views_visible === true,
    pageErrorsEmpty:
      Array.isArray(result?.page_errors) && result.page_errors.length === 0,
    consoleErrorsEmpty:
      Array.isArray(result?.console_errors) && result.console_errors.length === 0,
    requestFailuresEmpty:
      Array.isArray(result?.request_failures) && result.request_failures.length === 0,
    badResponsesEmpty:
      Array.isArray(result?.bad_responses) && result.bad_responses.length === 0,
  };

  evidence.result = result;
  evidence.checks = checks;
  evidence.status = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
} catch (error) {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  evidence.error = serializeError(error);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    { status: evidence.status, timeoutMs: evidence.timeoutMs, checks: evidence.checks, error: evidence.error },
    null,
    2,
  ),
);

if (evidence.status !== "PASS") {
  if (timeoutFired) process.exit(1);
  process.exitCode = 1;
}
