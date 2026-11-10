export const FACTORY2_DOMAIN_KEYS_SCHEMA_INVENTORY=Object.freeze([
  'domain-config.schema.json',
  'domain-key.schema.json',
  'domain-shell.schema.json',
  'workspace-config.schema.json',
  'workspace-module-manifest.schema.json',
]);
export const FACTORY2_DOMAIN_KEYS = Object.freeze({
  schema:'IWXA_T2_FACTORY2_DOMAIN_KEYS_PRODUCT_V1',
  productId:'domain-keys',
  generation:2,
  predecessor:Object.freeze({version:'2.4.5',sha256:'89329a34e581a37da30bc1d27da789d654f647c3d6ed9f313dd8e3bfc8167c87'}),
  currentSnapshot:Object.freeze({
    schemaFamily:'keys-2.0',
    path:'src/config/schemas/keys-2.0/',
    verifier:'scripts/verify-domain-keys-snapshot.mjs',
    schemaCount:5,
  }),
  successorMapping:'product/FACTORY2_DOMAIN_KEYS_SUCCESSOR_MAPPING_2026-09-24.json',
  deterministicSealGenerator:'scripts/factory2-product-seal.mjs',
  schemaInventory:FACTORY2_DOMAIN_KEYS_SCHEMA_INVENTORY,
  genericWriteAuthority:false,
  productionActivation:false,
  completeness:'PARTIAL',
});
export function factory2DomainKeysDescriptor(){ return FACTORY2_DOMAIN_KEYS; }
