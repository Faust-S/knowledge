/** Snapshot plain data without invoking accessors, iterators, toJSON or array hooks.
 * Typed foundation values belong to the canonical codec, not this JSON boundary.
 */
export function plainDataSnapshot(value, {errorFactory = (message) => new TypeError(message)} = {}) {
  const ancestors = new WeakSet();
  let nodes = 0;
  const fail = (reason) => { throw errorFactory(`Invalid plain data: ${reason}`); };
  function copy(input, depth) {
    if (++nodes > 100000 || depth > 128) fail('structure limit exceeded');
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null) return fail('unsupported value');
    if (ancestors.has(input)) fail('cycle');
    const array = Array.isArray(input);
    const proto = Object.getPrototypeOf(input);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('non-plain prototype');
    ancestors.add(input);
    try {
      const keys = Reflect.ownKeys(input);
      if (keys.some((key) => typeof key !== 'string')) fail('symbol property');
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (array) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 100000) fail('array length');
        if (keys.length !== length + 1) fail('sparse array or extra array properties');
        const output = [];
        for (let i = 0; i < length; i++) {
          const descriptor = descriptors[String(i)];
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('array accessor or missing element');
          output.push(copy(descriptor.value, depth + 1));
        }
        return Object.freeze(output);
      }
      const output = proto === null ? Object.create(null) : {};
      for (const key of keys.sort()) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('accessor or hidden property');
        Object.defineProperty(output, key, {
          value: copy(descriptor.value, depth + 1), enumerable: true, writable: false, configurable: false,
        });
      }
      return Object.freeze(output);
    } finally {
      ancestors.delete(input);
    }
  }
  return copy(value, 0);
}
