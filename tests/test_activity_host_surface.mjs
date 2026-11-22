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

test('cold recovery cannot receive Kernel, target IDs or original signed rights',()=>{
  const surface=file('../desktop/src/host-surface.tsx');
  const app=file('../desktop/src/App.tsx');
  const owner=file('../modules/activity-base-anonymizer/t3-owner-review-stage.mjs');
  assert.match(surface,/const recoveryKeys = \['readSelected', 'recoverSelected', 'stageSelected', 'subscribeInvalidation'\]/);
  assert.match(surface,/typeof \(port as Record<string, unknown>\)\.recoverSelected === 'function'/);
  assert.match(app,/t3Controller\.current\.recoverSelected\(\)/);
  assert.match(app,/Проверить сохранённый черновик T3/);
  assert.match(app,/Новая запись не отправляется/);
  assert.match(owner,/export async function recoverSelectedT3ActivityReview\(/);
  assert.doesNotMatch(owner.slice(owner.indexOf('export async function recoverSelectedT3ActivityReview')),
    /scoped\.putObject|scoped\.createWorkspace|scoped\.importCommit|scoped\.exportPackage/);
});

test('recovered target review is not misrepresented as an attested link to current source',()=>{
  const app=file('../desktop/src/App.tsx');
  const recovery=file('../modules/activity-base-anonymizer/t3-owner-review-stage.mjs');
  assert.match(app,/Связь этого черновика с выбранным сейчас источником не аттестована/);
  assert.match(app,/СОБЫТИЯ ПО ДАННЫМ ИСТОЧНИКА/);
  assert.match(recovery,/sourceScoped\.getWorkspace\(sourceOwner\.workspace_id\)/);
  assert.match(recovery,/T3_ACTIVITY_RECOVERY_SOURCE_WORKSPACE_UNAVAILABLE/);
});

test('T3 evidence passport explains source gaps without displaying source rows or fake scores',()=>{
  const app=file('../desktop/src/App.tsx');
  const evidence=file('../modules/activity-base-anonymizer/t3-evidence-passport.mjs');
  const style=file('../desktop/src/styles.css');
  assert.match(app,/buildT3EvidencePassport\(review\)/);
  assert.match(app,/Паспорт достаточности фактов/);
  assert.match(app,/Остальные вопросы к исходным данным/);
  assert.match(app,/Экспорт закрыт/);
  assert.match(style,/\.evidence-audit-heading/);
  assert.match(style,/summary:focus-visible/);
  assert.doesNotMatch(evidence,/fetch\(|XMLHttpRequest|WebSocket|putObject|exportPackage|createWorkspace/);
  assert.doesNotMatch(evidence,/source_id|source_object|credential|grantId|sourceWorkspaceId/);
});

test('interactive T3 topology shows only bounded alias nodes with source-local evidence',()=>{
  const app=file('../desktop/src/App.tsx');
  const module=file('../modules/activity-base-anonymizer/t3-transition-map.mjs');
  const css=file('../desktop/src/styles.css');
  assert.match(app,/buildT3TransitionMap\(view\)/);
  assert.match(app,/Карта локальных переходов/);
  assert.match(app,/aria-pressed=\{choice\?\.id===node\.id\}/);
  assert.match(app,/T3_MAP_PAGE_SIZE=8/);
  assert.match(app,/choice\.incoming\.slice\(0,8\)/);
  assert.match(app,/choice\.outgoing\.slice\(0,8\)/);
  assert.match(app,/Нормативный маршрут не подтверждён/);
  assert.match(css,/\.t3-map-choices/);
  assert.match(css,/\.t3-map-node:focus-visible/);
  assert.match(module,/layoutObservedGraph/);
  assert.doesNotMatch(module,/fetch\(|WebSocket|XMLHttpRequest|putObject|createWorkspace|exportPackage/);
});

test('bounded multi-object D2 candidate navigation cannot mount thousands of React graph cards',()=>{
  const app=file('../desktop/src/App.tsx');
  const css=file('../desktop/src/styles.css');
  const helper=file('../modules/activity-base-anonymizer/t3-transition-map.mjs');
  assert.match(app,/T3_CANDIDATE_PAGE_SIZE=6/);
  assert.match(app,/t3Candidates\.slice\(candidatePage\*T3_CANDIDATE_PAGE_SIZE/);
  assert.match(app,/aria-label="Следующая группа типов объектов"/);
  assert.match(app,/aria-label="Предыдущая группа типов объектов"/);
  assert.match(app,/useLayoutEffect\(\(\)=>\{setT3CandidatePage\(0\);\},\[t3Review\?\.review\]\)/);
  assert.match(app,/map\.too_complex/);
  assert.match(css,/\.t3-candidate-nav/);
  assert.match(helper,/const too_complex=distinct\.size>256\|\|edges\.length>512/);
  assert.match(helper,/inferred_edges:0/);
});

test('business verification cards remain read-only, bounded and keyboard-accessible',()=>{
  const app=file('../desktop/src/App.tsx');
  const map=file('../modules/activity-base-anonymizer/t3-transition-map.mjs');
  const css=file('../desktop/src/styles.css');
  assert.match(app,/map\.review_questions\[0\]\.prompt/);
  assert.match(app,/map\.review_questions\.slice\(1\)/);
  assert.match(app,/Вопросы для проверки хозяйственного процесса/);
  assert.match(app,/Вопрос для проверки:/);
  assert.match(css,/\.t3-map-questions summary:focus-visible/);
  assert.match(map,/questions\.slice\(0,3\)/);
  assert.match(map,/не доказывает переделку/);
  assert.doesNotMatch(map,/fetch\(|XMLHttpRequest|WebSocket|putObject|exportPackage/);
});
