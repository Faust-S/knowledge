export const FACTORY2_COMMON_MODULES = Object.freeze({
  schema:'IWXA_T2_FACTORY2_COMMON_MODULES_PRODUCT_V1',
  productId:'common-modules',
  generation:2,
  predecessor:Object.freeze({version:'0.4.1',sha256:'ac6c2121c1e527a9a38d2772006138de24befd7f0ad6b3b90f56e74d63c3d51c'}),
  currentBoundary:Object.freeze({
    foundation:'src/foundation/',
    workspaceContract:'src/workspace-contract/',
    sharedHostContracts:'src/workspace-host/context/',
  }),
  successorMapping:'product/FACTORY2_COMMON_MODULES_SUCCESSOR_MAPPING_2026-09-24.json',
  deterministicSealGenerator:'scripts/factory2-product-seal.mjs',
  sharedSemantics:Object.freeze([
    'exact quantity/money/time foundations',
    'provenance/bitemporal/causal/checkpoint foundations',
    'plain-data snapshots',
    'workspace module contracts',
    'scoped Host facades',
  ]),
  genericWriteAuthority:false,
  productionActivation:false,
  completeness:'PARTIAL',
});
export function factory2CommonModulesDescriptor(){ return FACTORY2_COMMON_MODULES; }
