/** A persistent object family belongs to exactly one accepted Result kind.
 * Several object families may substantiate the same accepted Result kind.
 * The two sets must be exactly covered; this is a domain-neutral Factory gate.
 */
export function resultKindsForProductParity(entries,{sourceOrigin}={}) {
  if(!Array.isArray(entries)) throw new Error('FACTORY2_PRODUCT_RESULT_FAMILY_INPUT_INVALID');
  return entries.filter(e=>e?.status==='BOUND'||(
    sourceOrigin==='CANONICAL_GIT_HEAD_TREE'&&e?.status==='PERSISTED_UNACCEPTED'&&e?.acceptanceStatus==='NOT_REQUESTED'
  )).map(e=>e.resultKind);
}
export function validateResultFamilyParity(persistentFamilies, resultBindings, acceptedResultKinds) {
  const fail = code => { throw new Error('FACTORY2_PRODUCT_' + code); };
  const uniqueTokens = values => Array.isArray(values) &&
    values.every(v => typeof v === 'string' && v.trim() === v && v.length > 0) &&
    new Set(values).size === values.length;
  if (!uniqueTokens(persistentFamilies) || !uniqueTokens(acceptedResultKinds) || !Array.isArray(resultBindings))
    fail('RESULT_FAMILY_INPUT_INVALID');
  const families = new Set(persistentFamilies);
  const kinds = new Set(acceptedResultKinds);
  const coveredFamilies = new Set();
  const coveredKinds = new Set();
  for (const binding of resultBindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) ||
        typeof binding.family !== 'string' || !families.has(binding.family) ||
        coveredFamilies.has(binding.family) || typeof binding.resultKind !== 'string' ||
        !kinds.has(binding.resultKind)) fail('RESULT_FAMILY_BINDING_INVALID');
    coveredFamilies.add(binding.family);
    coveredKinds.add(binding.resultKind);
  }
  if (coveredFamilies.size !== families.size) fail('RESULT_FAMILY_COVERAGE_MISSING');
  if (coveredKinds.size !== kinds.size) fail('RESULT_ACCEPTANCE_PARITY_MISSING');
  return Object.freeze({familiesCovered: coveredFamilies.size, resultKindsCovered: coveredKinds.size});
}
