// An additional ORIGINAL T2 service passport for the same local Store.
// Not a new service implementation, Store, authority, or archive format.
// Only the isolated trusted Kernel realm connects it, for the six T2
// package methods after the product's signed subject/operation checks.
export const COMPANY_PRODUCT_SERVICES=Object.freeze([
  'iwxa.admin-center.workspace','iwxa.personal-agent.workspace',
]);
export const COMPANY_PACKAGE_OPERATIONS=Object.freeze([
  't2.exportPreview','t2.exportPackage','t2.confirmExport',
  't2.importPreview','t2.importCommit','t2.importCancel',
]);
export function companyExchangeServiceId(productServiceId){
  if(!COMPANY_PRODUCT_SERVICES.includes(productServiceId))return null;
  return productServiceId.slice(0,-'.workspace'.length)+'.exchange.workspace';
}
export function originalCompanyExchangePassport(productPassport){
  const id=companyExchangeServiceId(productPassport?.service_id);
  if(!id||typeof productPassport.service_version!=='string')
    throw Error('T3_CORPORATE_EXCHANGE_PRODUCT_PASSPORT_REQUIRED');
  return {
    service_id:id,service_version:productPassport.service_version,
    base_path:'/workspace/',supported_levels:['T0','T1','T2'],
    // The existing domain SchemaRegistry loads product declarations once.
    input_object_types:[],output_object_types:[],schemas:{},
    permissions:{
      // Required by the immutable original T2 trusted Workspace predicate,
      // NOT operations exposed to product UI or the native T1 relay.
      workspace:{list:true,read:true,create:false,soft_delete:false,restore:true,purge:true},
      objects:{read:['*'],write:['*'],delete:['*']},
      events:{read_scope:'workspace'},
      packages:{export:true,import:true,export_scope:'workspace',import_scope:'workspace'},
    },
  };
}
