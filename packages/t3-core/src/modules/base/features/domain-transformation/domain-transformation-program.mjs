export const DOMAIN_TRANSFORMATION_PROGRAM_PROFILES=Object.freeze({
  D01:Object.freeze({
    programRole:'PRIMARY_T2_TRANSFORMATION_PILOT',
    transformationMode:'FULL_DOMAIN_TRANSFORMATION',
    productMaturity:'MATURE_TEST_DOMAIN',
    rationale:'ORIGINAL_T2_TEST_DOMAIN',
    serviceRootAuthorityStatus:'RESOLVED_BY_OD_W07_LEARN',
    persistentResultPolicy:'OWNER_DECISION_REQUIRED',
  }),
  D10:Object.freeze({
    programRole:'SECONDARY_COMPLEX_TRANSFORMATION_PILOT',
    transformationMode:'FULL_DOMAIN_TRANSFORMATION',
    productMaturity:'MATURE_DIAGNOSTIC_COMMERCE_DOMAIN',
    rationale:'TECHNICALLY_DEVELOPED_DIAGNOSTIC_AND_SALE_FLOW',
    serviceRootAuthorityStatus:'OWNER_APPROVED_D10_CANONICAL_AUTHORITY_CORE',
    persistentResultPolicy:'AUTHORITY_BOUND_PRODUCT_LOGIC',
  }),
  D12:Object.freeze({
    programRole:'PUBLIC_INFORMATION_SURFACE',
    transformationMode:'PUBLIC_SURFACE_ASSESSMENT_ONLY',
    productMaturity:'INFORMATION_SITE',
    rationale:'CURRENT_PRODUCT_IS_PUBLIC_INFORMATION_ONLY',
    serviceRootAuthorityStatus:'OUTSIDE_THIS_PROGRAM_PROFILE',
    persistentResultPolicy:'NATIVE_RESULT_USE_CASE_NOT_PROVEN',
  }),
});

export function domainTransformationProgramProfile(domainId){
  const id=typeof domainId==='string'?domainId.trim().toUpperCase():'';
  const special=DOMAIN_TRANSFORMATION_PROGRAM_PROFILES[id];
  if(special) return special;
  return Object.freeze({
    programRole:'STANDARD_DOMAIN_TRANSFORMATION',
    transformationMode:'FULL_DOMAIN_TRANSFORMATION',
    productMaturity:'CURRENT_DOMAIN',
    rationale:'STANDARD_DOMAIN_PROGRAM',
    serviceRootAuthorityStatus:'OUTSIDE_THIS_PROGRAM_PROFILE',
    persistentResultPolicy:'USE_DOMAIN_RESULT_AUTHORITY_REGISTRY',
  });
}
