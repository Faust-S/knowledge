// Presentation-only ordering of already observed edges. Never adds a graph edge.
export function layoutObservedGraph(process) {
  const nodes = Array.isArray(process?.states) ? process.states : [];
  const edges = Array.isArray(process?.observed_successions) ? process.observed_successions : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (byId.size !== nodes.length || !edges.every((e) => byId.has(e.from) && byId.has(e.to))) {
    return {ordered: nodes, edgeLabels: [], linear: false, cyclic: true};
  }
  const indegree = new Map([...byId.keys()].map((id) => [id, 0]));
  const outgoing = new Map([...byId.keys()].map((id) => [id, []]));
  for (const edge of edges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const ready = [...byId.keys()].filter((id) => indegree.get(id) === 0).sort();
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of outgoing.get(id)) {
      const count = indegree.get(next) - 1;
      indegree.set(next, count);
      if (count === 0) { ready.push(next); ready.sort(); }
    }
  }
  const cyclic = order.length !== nodes.length;
  const ordered = cyclic ? [...nodes] : order.map((id) => byId.get(id));
  const numbers = new Map(ordered.map((item, index) => [item.id, String(index + 1).padStart(2, '0')]));
  const edgeLabels = edges.map((edge) => `${numbers.get(edge.from)} → ${numbers.get(edge.to)}`);
  const linear = !cyclic && edges.length === nodes.length - 1 &&
    edges.every((e) => e.from !== e.to) &&
    new Set(edges.map((e) => e.from)).size === edges.length &&
    new Set(edges.map((e) => e.to)).size === edges.length;
  return {ordered, edgeLabels, linear, cyclic};
}