import assert from 'node:assert/strict';
import test from 'node:test';
import {layoutObservedGraph} from '../modules/activity-base-anonymizer/graph-order.mjs';
import {analyzeSnapshot, buildSyntheticExample} from '../modules/activity-base-anonymizer/engine.mjs';

test('observed linear chain displays in edge order, not alphabetical ID order', async () => {
  const {preview} = await analyzeSnapshot(await buildSyntheticExample());
  const linear = layoutObservedGraph(preview.processes[0]);
  assert.equal(linear.linear, true);
  assert.equal(linear.cyclic, false);
  assert.deepEqual([...linear.edgeLabels].sort(), ['01 → 02', '02 → 03', '03 → 04', '04 → 05']);
});

test('topological order follows every observed edge in a chain', async () => {
  const {preview} = await analyzeSnapshot(await buildSyntheticExample());
  const arranged = layoutObservedGraph(preview.processes[0]);
  const pos = new Map(arranged.ordered.map((n, i) => [n.id, i]));
  for (const edge of preview.processes[0].observed_successions) {
    assert.ok(pos.get(edge.from) < pos.get(edge.to), `${edge.from} precedes ${edge.to}`);
  }
  assert.deepEqual([...pos.values()], [0, 1, 2, 3, 4]);
});

test('branches cannot be presented as one confirmed linear process', () => {
  const process = {states: [{id:'a'}, {id:'b'}, {id:'c'}],
    observed_successions: [{from:'a',to:'b'}, {from:'a',to:'c'}]};
  const graph = layoutObservedGraph(process);
  assert.equal(graph.cyclic, false);
  assert.equal(graph.linear, false);
  assert.equal(graph.edgeLabels.length, 2);
});

test('loops are marked non-linear without inventing an order', () => {
  const process = {states:[{id:'a'}, {id:'b'}], observed_successions:[{from:'a',to:'b'}, {from:'b',to:'a'}]};
  const graph = layoutObservedGraph(process);
  assert.equal(graph.cyclic, true);
  assert.equal(graph.linear, false);
  assert.deepEqual(graph.ordered, process.states);
});

test('unknown edges cannot be invented as valid structure', () => {
  const graph = layoutObservedGraph({states:[{id:'a'}], observed_successions:[{from:'a',to:'unknown'}]});
  assert.equal(graph.cyclic, true);
  assert.deepEqual(graph.edgeLabels, []);
});