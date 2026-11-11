import type {KernelFacade} from "../workspace-contract/module-context";
export interface SubjectAccessHostOwner {
  currentContext: () => unknown;
  actionFor: (operation: string) => unknown;
  operationDigest: (input: {operation: string; input: unknown; context: unknown}) => unknown;
  authorize: (request: unknown) => unknown;
  verifyDecisionBinding: (request: unknown, decision: unknown) => unknown;
}
export declare function createSubjectScopedModuleKernelFacade(input: {
  kernel: KernelFacade;
  access: SubjectAccessHostOwner;
  clock?: () => number;
}): KernelFacade;
