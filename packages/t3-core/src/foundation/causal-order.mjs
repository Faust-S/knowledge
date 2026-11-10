function requireId(value, label = 'id') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CausalSemanticError(`${label} must be a non-empty string`, 'INVALID_CAUSAL_ID');
  }
  return value.trim();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cloneFrozen(value) {
  return deepFreeze(structuredClone(value));
}

export class CausalSemanticError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CausalSemanticError';
    this.code = code;
  }
}

export class CausalEvent {
  constructor({ id, effectiveTimeRef, knowledgeTimeRef, metadata = {} }) {
    this.id = requireId(id, 'event id');
    this.effectiveTimeRef = requireId(effectiveTimeRef, 'effectiveTimeRef');
    this.knowledgeTimeRef = requireId(knowledgeTimeRef, 'knowledgeTimeRef');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.getPrototypeOf(metadata) !== Object.prototype) {
      throw new CausalSemanticError('metadata must be a plain object', 'INVALID_CAUSAL_METADATA');
    }
    this.metadata = cloneFrozen(metadata);
    Object.freeze(this);
  }
}

export class CausalLink {
  constructor({ id, causeId, effectId, evidenceRef }) {
    this.id = requireId(id, 'link id');
    this.causeId = requireId(causeId, 'causeId');
    this.effectId = requireId(effectId, 'effectId');
    this.evidenceRef = requireId(evidenceRef, 'evidenceRef');
    if (this.causeId === this.effectId) {
      throw new CausalSemanticError('self-causation is not allowed', 'CAUSAL_CYCLE');
    }
    Object.freeze(this);
  }
}

export class CausalPartialOrder {
  #events = new Map();
  #links = new Map();
  #outgoing = new Map();
  #incoming = new Map();

  recordEvent(input) {
    const event = input instanceof CausalEvent ? input : new CausalEvent(input);
    if (this.#events.has(event.id)) {
      throw new CausalSemanticError(`duplicate causal event ${event.id}`, 'DUPLICATE_CAUSAL_EVENT');
    }
    this.#events.set(event.id, event);
    this.#outgoing.set(event.id, new Set());
    this.#incoming.set(event.id, new Set());
    return event;
  }

  recordLink(input) {
    const link = input instanceof CausalLink ? input : new CausalLink(input);
    if (this.#links.has(link.id)) {
      throw new CausalSemanticError(`duplicate causal link ${link.id}`, 'DUPLICATE_CAUSAL_LINK');
    }
    if (!this.#events.has(link.causeId) || !this.#events.has(link.effectId)) {
      throw new CausalSemanticError('both causal endpoints must already exist', 'UNKNOWN_CAUSAL_EVENT');
    }
    if (this.precedes(link.effectId, link.causeId)) {
      throw new CausalSemanticError('causal link would create a cycle', 'CAUSAL_CYCLE');
    }
    this.#links.set(link.id, link);
    this.#outgoing.get(link.causeId).add(link.effectId);
    this.#incoming.get(link.effectId).add(link.causeId);
    return link;
  }

  getEvent(id) {
    return this.#events.get(requireId(id, 'event id')) ?? null;
  }

  getLink(id) {
    return this.#links.get(requireId(id, 'link id')) ?? null;
  }

  precedes(beforeId, afterId) {
    const before = requireId(beforeId, 'beforeId');
    const after = requireId(afterId, 'afterId');
    if (!this.#events.has(before) || !this.#events.has(after)) {
      throw new CausalSemanticError('causal relation query references an unknown event', 'UNKNOWN_CAUSAL_EVENT');
    }
    if (before === after) return false;
    const visited = new Set([before]);
    const queue = [...this.#outgoing.get(before)];
    while (queue.length) {
      const current = queue.shift();
      if (current === after) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...this.#outgoing.get(current));
    }
    return false;
  }

  relation(leftId, rightId) {
    const left = requireId(leftId, 'leftId');
    const right = requireId(rightId, 'rightId');
    if (!this.#events.has(left) || !this.#events.has(right)) {
      throw new CausalSemanticError('causal relation query references an unknown event', 'UNKNOWN_CAUSAL_EVENT');
    }
    if (left === right) return 'SAME';
    if (this.precedes(left, right)) return 'BEFORE';
    if (this.precedes(right, left)) return 'AFTER';
    return 'UNORDERED';
  }

  ancestors(id) {
    return this.#walk(id, this.#incoming);
  }

  descendants(id) {
    return this.#walk(id, this.#outgoing);
  }

  #walk(id, adjacency) {
    const start = requireId(id, 'event id');
    if (!this.#events.has(start)) {
      throw new CausalSemanticError(`unknown causal event ${start}`, 'UNKNOWN_CAUSAL_EVENT');
    }
    const visited = new Set();
    const queue = [...adjacency.get(start)];
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      queue.push(...adjacency.get(current));
    }
    return Object.freeze([...visited].sort());
  }

  snapshot() {
    return deepFreeze({
      events: [...this.#events.values()],
      links: [...this.#links.values()],
      orderingSemantics: 'PARTIAL_ORDER_ONLY',
      arrayOrderAuthoritative: false,
    });
  }
}
