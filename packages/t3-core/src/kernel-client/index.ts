export { loadBootstrap, resetLoaderCache } from "./loader";
export { connectKernel, retryConnect, sessionToState, errorToState } from "./connect";
export { useKernel } from "./useKernel";
export { capabilities, type Capabilities } from "./capabilities";
export { adapter, type WorkspaceAdapter } from "./adapter";
export type {
  KernelBootstrap,
  KernelSession,
  KernelState,
  KernelStatus,
  KernelErrorCode,
  IWXAClient,
  ConnectMode,
  Level,
  ServicePassport,
  GrantedOperation,
  OperationId,
  WorkspaceRecord,
  ObjectRecord,
  EventRecord,
  RelationRecord,
  ObjectWithRelations,
} from "./types";
export { KernelError } from "./types";
// Only the qualified Runtime Contract 1.3.0 is exported from the active API.
export { CONTRACT_VERSION, ALL_OPERATIONS } from "./contracts/runtime-1.3.0";
export { CONTRACT_VERSION as SUPPORTED_CONTRACT_VERSION } from "./contracts/runtime-1.3.0";
import currentContractManifest from "./contracts/runtime-1.3.0/contract-manifest.json";
export const CONTRACT_MANIFEST = currentContractManifest;
// window.IWXA Bootstrap protocol version, distinct from the Runtime contract.
export const LOADER_VERSION = 1 as const;

export { PackageCorruptedError, PreviewTokenInvalidError } from "./errors";
