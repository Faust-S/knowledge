import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, '../fixtures/host-configs/learn-pilot');
const readJson = async (name) => JSON.parse(await readFile(resolve(fixtureRoot, name), 'utf8'));

const expectedServices = [
  ['ru.iwxa.learn.main', '/'],
  ['ru.iwxa.learn.workspace', '/workspace/'],
  ['ru.iwxa.learn.study', '/study/'],
  ['ru.iwxa.learn.practice', '/practice/'],
  ['ru.iwxa.learn.lad', '/lad/'],
  ['ru.iwxa.learn.career', '/career/'],
  ['ru.iwxa.learn.calculators', '/calculators/'],
];

test('Learn pilot binds exact domain, runtime, contract and seven Kernel services', async () => {
  const domain = await readJson('domain.json');
  assert.equal(domain.domain_id, 'ru.iwxa.learn');
  assert.equal(domain.origin, 'https://learn.iwxa.ru');
  assert.equal(domain.workspace_profile, 'learning');
  assert.equal(domain.runtime.runtime_version, '0.3.6');
  assert.equal(domain.runtime.package_version, '1.2.0');
  assert.deepEqual(domain.modules.map(({ service_id, base_path }) => [service_id, base_path]), expectedServices);
});

test('Learn shell and workspace keep one exact pilot identity and proven view-state owner', async () => {
  const [domain, shell, workspace] = await Promise.all([
    readJson('domain.json'),
    readJson('domain-shell.json'),
    readJson('workspace.config.json'),
  ]);
  assert.equal(shell.domain_id, domain.domain_id);
  assert.equal(shell.origin, domain.origin);
  assert.equal(workspace.domain_id, domain.domain_id);
  assert.equal(workspace.workspace_service_id, 'ru.iwxa.learn.workspace');
  assert.equal(workspace.profile, 'learning');
  assert.equal(workspace.host.required_runtime_version, '0.3.6');
  assert.equal(workspace.host.required_contract_version, '1.3.0');
  const owner = workspace.modules.find((module) => module.module_id === 'iwxa.workspace.view-state');
  assert.ok(owner);
  assert.ok(owner.object_schemas.includes('iwxa.workspace.internal.saved-view'));
});

test('Learn pilot remains fail-closed and invents no Learning business write owner', async () => {
  const [domain, shell, workspace] = await Promise.all([
    readJson('domain.json'),
    readJson('domain-shell.json'),
    readJson('workspace.config.json'),
  ]);
  assert.equal(workspace.modules.some((module) => module.module_id.includes('learning') && module.object_schemas?.length), false);
  assert.equal(workspace.module_loading.allow_remote_modules, false);
  assert.equal(workspace.security.module_direct_indexeddb, false);
  assert.equal(workspace.security.executable_code_in_iwxa, false);
  assert.equal(workspace.security.remote_module_urls, false);
  assert.equal(domain.security.allow_secrets, false);
  assert.equal(domain.security.direct_indexeddb_for_modules, false);
  assert.equal(domain.security.module_service_worker, false);
  assert.equal(shell.release.host_owned, true);
  assert.equal(shell.release.preserve_on_kernel_overlay, true);
});
