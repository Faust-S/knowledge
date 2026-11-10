import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/workspace-host/runtime/WorkspaceHostRuntimeProvider.tsx',import.meta.url),'utf8');

test('Host runtime invalidates the active session handle immediately when session disappears',()=>{
  const branch=source.slice(source.indexOf('if (!session || !sessionKey)'),source.indexOf('const myGen = ++generationRef.current'));
  assert.match(branch,/\+\+generationRef\.current/);
  assert.match(branch,/const prev = activeHandleRef\.current/);
  assert.match(branch,/activeHandleRef\.current = null/);
  assert.match(branch,/setState\(\{ status: "idle" \}\)/);
});

test('Host runtime serializes teardown and startup through one transition barrier',()=>{
  assert.match(source,/const transitionRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(source,/const transition = transitionRef\.current[\s\S]*?await prev\.dispose\(\)[\s\S]*?await createWorkspaceHostRuntime/);
  assert.match(source,/transitionRef\.current = transition\.catch\(\(\) => \{\}\)/);
});

test('session loss and unmount enqueue disposal behind any in-flight transition',()=>{
  const occurrences=[...source.matchAll(/const teardown = transitionRef\.current/g)];
  assert.ok(occurrences.length >= 2);
  assert.match(source,/\+\+generationRef\.current;[\s\S]*?const teardown = transitionRef\.current/);
});
