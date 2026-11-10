import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const source = readFileSync(
  new URL('../src/modules/base/features/workspace/project-process-connectivity.ts', import.meta.url),
  'utf8',
);
const product = JSON.parse(readFileSync(
  new URL('../../product/P4_7_PROJECT_PROCESS_CONNECTIVITY_2026-09-13.json', import.meta.url),
  'utf8',
));
const encodedPatch = readFileSync(
  new URL('../../product/patches/P4_7_PROJECT_PROCESS_CONNECTIVITY.patch.gz.b64', import.meta.url),
  'utf8',
).trim();
const patch = gunzipSync(Buffer.from(encodedPatch, 'base64')).toString('utf8');

test('P4.7 recovery artifact keeps its recorded hash chain', () => {
  assert.equal(sha256(encodedPatch), product.sha256.patch_gzip_base64);
  assert.equal(sha256(patch), product.sha256.uncompressed_patch);
});

test('materialized P4.7 connectivity preserves exact safe opaque id admission', () => {
  assert.match(patch, /isSafeOpaqueId\(object\.object_id\)/);
  const admission = source.slice(source.indexOf('function isAdmittedObject'), source.indexOf('/**'));
  assert.match(admission, /isSafeOpaqueId\(object\.object_id\)/);
  assert.doesNotMatch(admission, /object_id\.length\s*>\s*0/);
});

test('materialized P4.7 isolation remains adjacency-based and structural-only', () => {
  assert.match(patch, /adjacency\.get\(objectId\)\?\.size \?\? 0\) === 0/);
  const isolation = source.slice(
    source.indexOf('const isolatedObjectCount'),
    source.indexOf('const connectedObjectCount'),
  );
  assert.match(isolation, /adjacency\.get\(objectId\)\?\.size \?\? 0\) === 0/);
  assert.doesNotMatch(isolation, /component\.objectIds\.length === 1/);
  assert.match(
    source,
    /They are not\s*\n \* process stages, dependency groups, execution order, causality or workflow state\./,
  );
});
