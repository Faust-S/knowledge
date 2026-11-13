import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file=path=>readFileSync(new URL(path, import.meta.url),'utf8');

test('Host React surface uses only the existing narrow T3 selected-read port',()=>{
  const source=file('../desktop/src/host-surface.tsx');
  const app=file('../desktop/src/App.tsx');
  assert.match(source,/Object\.keys\(port\)\.sort\(\)\.join/);
  assert.match(source,/\['readSelected', 'subscribeInvalidation'\]/);
  assert.match(source,/mounted\.has\(container\)/);
  assert.match(source,/root\.unmount\(\)/);
  assert.match(source,/createElement\(App, \{t3Host, brandSrc:/);
  assert.match(app,/brandSrc\?: string/);
  assert.match(app,/src=\{brandSrc\}/);
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|WebSocket|window\.open|Command::new/);
  assert.doesNotMatch(source,/signedAccess|grantId|credential|privateKey|accessToken/);
});

test('Host surface is an ES module and uses existing React, without a second runtime',()=>{
  const source=file('../desktop/vite.host.config.ts');
  const packageJson=JSON.parse(file('../desktop/package.json'));
  const tsconfig=JSON.parse(file('../desktop/tsconfig.json'));
  assert.match(source,/formats: \['es'\]/);
  assert.match(source,/external: \['react', 'react-dom\/client', 'react\/jsx-runtime'\]/);
  assert.match(source,/dist-host-surface/);
  assert.ok(packageJson.scripts['build:host-surface']);
  assert.ok(tsconfig.include.includes('vite.host.config.ts'));
});

test('optional signed Activity Derive command is not a raw Kernel or export port',()=>{
  const surface=file('../desktop/src/host-surface.tsx');
  const app=file('../desktop/src/App.tsx');
  assert.match(surface,/const stageKeys = \['readSelected', 'stageSelected', 'subscribeInvalidation'\]/);
  assert.match(surface,/present === keys\.join\(','\) \|\| present === stageKeys\.join\(','\)/);
  assert.match(app,/t3Host\?\.stageSelected/);
  assert.match(app,/t3Controller\.current\.stageSelected\(\)/);
  assert.match(app,/HOLD · ЭКСПОРТ ЗАКРЫТ/);
  assert.doesNotMatch(surface,/createSubjectKernelBinding|signedDeriveAccess|putObject|exportPackage/);
});
