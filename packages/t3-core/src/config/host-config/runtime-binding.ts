/** Active T2 Host: only qualified Kernel 0.3.6.
 * Historic donor versions remain in frozen qualification records, not runtime selection.
 */
export const SUPPORTED_HOST_RUNTIME_VERSIONS = ["0.3.6"] as const;
export type SupportedHostRuntimeVersion = typeof SUPPORTED_HOST_RUNTIME_VERSIONS[number];
export function isSupportedHostRuntimeVersion(value: unknown): value is SupportedHostRuntimeVersion {
  return value === "0.3.6";
}
