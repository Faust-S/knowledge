import {plainDataSnapshot} from '../../../../foundation/plain-data-snapshot.mjs';

export function transformationData(value, ErrorType, code) {
  const snapshot=plainDataSnapshot(value, {errorFactory: (message) => new ErrorType(message, code)});
  if(!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new ErrorType('transformation input must be a plain record', code);
  }
  return snapshot;
}

// Negative inspection observations are legal receipt data, never binding refs.
export function assertConcreteRefs(values, ErrorType, code) {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || /^(?:NONE_PROVEN|UNPROVEN|UNBOUND|OWNER_DECISION_REQUIRED|NO_NEW_ROOT_AUTHORITY|NATIVE_RESULT_USE_CASE_NOT_PROVEN)(?:$|[_:\s])/i.test(value.trim())) {
      throw new ErrorType('unproven observation cannot be used as a binding reference', code);
    }
  }
}

export function denyFlags(input, names, ErrorType, code) {
  for (const name of names) {
    if (Object.hasOwn(input, name) && input[name] !== false) {
      throw new ErrorType(`${name} must be explicitly false when supplied`, code);
    }
  }
}
