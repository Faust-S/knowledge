// A4.2: local OC-DFG comparison with an independently invoked Rust4PM.
// A matching DFG is not proof of causal equivalence or safe disclosure.
import {ActivityHold} from './engine.mjs';

export const R4PM_VERSION = '0.7.1';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const count = value => Number.isSafeInteger(value) && value > 0;
const require = (ok, code) => { if (!ok) throw new ActivityHold(code); };
const edgeKey = (from, to) => JSON.stringify([from, to]);
function add(map, key, n) { map.set(key, (map.get(key) ?? 0) + n); }
function equalMap(a, b) {
  return a.size === b.size && [...a].every(([key, n]) => b.get(key) === n);
}
function equalSet(a, b) {
  return a.size === b.size && [...a].every(value => b.has(value));
}

function expected(view) {
  const activities = new Map(), edges = new Map(), starts = new Set(), ends = new Set();
  for (const variant of view.trace_variants) {
    const sequence = variant.sequence.map(event => event.activity_alias);
    starts.add(sequence[0]); ends.add(sequence.at(-1));
    for (const activity of sequence) add(activities, activity, variant.object_trace_count);
    for (let i = 1; i < sequence.length; i++)
      add(edges, edgeKey(sequence[i - 1], sequence[i]), variant.object_trace_count);
  }
  return {activities, edges, starts, ends};
}
function readGraph(graph) {
  require(graph && typeof graph === 'object' && !Array.isArray(graph),
    'OCEL_R4PM_GRAPH_INVALID');
  const {activities, directly_follows_relations: transitions,
    start_activities: starts, end_activities: ends} = graph;
  require(activities && typeof activities === 'object' && !Array.isArray(activities) &&
    Object.keys(activities).length <= 256 && Array.isArray(transitions) &&
    transitions.length <= 65536 && Array.isArray(starts) && starts.length <= 256 &&
    Array.isArray(ends) && ends.length <= 256, 'OCEL_R4PM_GRAPH_INVALID');
  const nodes = new Map(Object.entries(activities));
  for (const [name, n] of nodes)
    require(/^activity_[0-9]{3}$/.test(name) && count(n), 'OCEL_R4PM_ACTIVITY_INVALID');
  const edges = new Map();
  for (const row of transitions) {
    require(Array.isArray(row) && row.length === 2 && Array.isArray(row[0]) &&
      row[0].length === 2 && nodes.has(row[0][0]) && nodes.has(row[0][1]) && count(row[1]),
      'OCEL_R4PM_TRANSITION_INVALID');
    const key = edgeKey(...row[0]);
    require(!edges.has(key), 'OCEL_R4PM_DUPLICATE_TRANSITION');
    edges.set(key, row[1]);
  }
  for (const boundary of [starts, ends])
    require(boundary.every(name => nodes.has(name)) && new Set(boundary).size === boundary.length,
      'OCEL_R4PM_BOUNDARY_INVALID');
  return {activities: nodes, edges, starts: new Set(starts), ends: new Set(ends)};
}

export function compareRust4pmDiscovery(prepared, external) {
  require(external?.engine === 'r4pm' && external.version === R4PM_VERSION &&
    external.operation === 'discover_dfg_from_ocel', 'OCEL_R4PM_ENGINE_PROFILE_INVALID');
  const graphs = external.object_type_to_dfg;
  require(graphs && typeof graphs === 'object' && !Array.isArray(graphs) &&
    Object.keys(graphs).length <= 256, 'OCEL_R4PM_GRAPH_INVALID');
  const expectedTypes = new Set(prepared.object_views.map(v => v.object_type_alias));
  require(Object.keys(graphs).length === expectedTypes.size &&
    Object.keys(graphs).every(type => expectedTypes.has(type)), 'OCEL_R4PM_OBJECT_TYPE_MISMATCH');
  const views = prepared.object_views.map(view => {
    const actual = readGraph(graphs[view.object_type_alias]);
    const reference = expected(view);
    require(equalMap(actual.activities, reference.activities) &&
      equalMap(actual.edges, reference.edges) && equalSet(actual.starts, reference.starts) &&
      equalSet(actual.ends, reference.ends), 'OCEL_R4PM_DFG_MISMATCH');
    return {
      object_type_alias: view.object_type_alias,
      object_trace_count: view.observed_object_count,
      trace_variants: view.trace_variants,
      activities: [...actual.activities].sort((a, b) => cmp(a[0], b[0]))
        .map(([activity_alias, object_event_occurrences]) => ({activity_alias, object_event_occurrences})),
      directly_follows: [...actual.edges].sort((a, b) => cmp(a[0], b[0])).map(([key, n]) => {
        const [from, to] = JSON.parse(key);
        return {from, to, object_trace_occurrences: n};
      }),
      start_activities: [...actual.starts].sort(cmp),
      end_activities: [...actual.ends].sort(cmp),
    };
  });
  return {
    status: 'LOCAL_DFG_MATCH', engine: 'r4pm', version: R4PM_VERSION,
    operation: 'discover_dfg_from_ocel',
    source_authority: 'UNVERIFIED_LOCAL_COPY',
    epistemic_status: 'RECORDS_NOT_INDEPENDENTLY_OBSERVED_EXECUTION',
    source_sha256: prepared.source_sha256, projected_sha256: prepared.projected_sha256,
    time_basis: 'ORDINAL_ORDER_ONLY_NO_DURATION',
    comparison_scope: 'OBJECT_LOCAL_ACTIVITY_FREQUENCIES_ADJACENCIES_AND_BOUNDARIES',
    object_views: views, shared_event_count: prepared.shared_event_count,
    declared_object_link_count: prepared.declared_object_link_count,
    risk_screen_status: prepared.risk_screen_status,
    reason_codes: prepared.reason_codes,
    technology_equivalence: 'NOT_ESTABLISHED', anonymity: 'NOT_ESTABLISHED',
    export_allowed: false, iwxa_package: null,
  };
}
