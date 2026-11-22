import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('native V7 wraps the actual Activity controller without replacing A1 A2 OCEL D2',()=>{
 const app=load('../desktop/src/App.tsx');
 const workspace=load('../desktop/src/ActivityWorkspace.tsx');
 assert.match(app,/return <ActivityWorkspace brandSrc=\{brandSrc\}/);
 assert.match(app,/legacy=\{legacy\}/);
 assert.match(app,/loadExample,loadOcelExample,readT3:loadSelectedT3/);
 assert.match(app,/stageT3:stageSelectedT3,recoverT3:recoverSelectedT3/);
 assert.match(workspace,/buildT3TransitionMap\(selectedCandidate\)/);
 assert.match(workspace,/buildT3EvidencePassport\(t3\)/);
 assert.doesNotMatch(workspace,/createKernel|new Store|signedAccess|privateKey|fetch\(/);
});
test('V7 ships installed and host surface with original purple brand asset',()=>{
 const main=load('../desktop/src/main.tsx'),host=load('../desktop/src/host-surface.tsx');
 const css=load('../desktop/src/activity-v7.css');
 const component=load('../desktop/src/ActivityWorkspace.tsx');
 assert.match(main,/import '\.\/activity-v7.css'/);
 assert.match(host,/import '\.\/activity-v7.css'/);
 assert.match(component,/img src=\{brandSrc\}/);
 assert.match(css,/height:49px/);
 assert.match(css,/width:60px;flex:0 0 60px/);
 assert.match(css,/width:247px;min-width:247px/);
 assert.match(component,/ACTIVITY_BOARD_STORAGE/);
 assert.match(component,/moveActivityWidget/);
});
test('all nineteen user-facing routes and owner-only safety states are reachable',()=>{
 const component=load('../desktop/src/ActivityWorkspace.tsx');
 const inner=load('../desktop/src/ActivityInnerPage.tsx');
 const names=['Главная','Источники','Схемы A0/A1','Рабочая область',
  'Реконструкция','Карта процессов','Аудит A2','OCEL 2.0','Стандарты',
  'T3 D1/D2','Карта T3','Паспорт фактов','Свидетельства D05',
  'Проверка','Черновик и восстановление','Выпуск и обмен','Квалификация','Настройки','Справка'];
 for(const name of names)assert.ok(component.includes(name)||inner.includes(name),name);
 assert.match(inner,/disabled=\{!data.canStage\|\|!t3/);
 assert.match(inner,/disabled=\{!data.canRecover\}/);
 assert.match(inner,/HOLD · выпуск закрыт/);
 assert.doesNotMatch(inner,/new Kernel|createWorkspace\(|putObject\(|exportPackage\(/);
});

test('pinned source dashboard uses existing Actions, not stale results of a previous source',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx');
 assert.match(ui,/w\.source==='a1'\?<button onClick=\{\(\)=>choose\('a1'\)\}/);
 assert.match(ui,/w\.source==='ocel'\?<button onClick=\{\(\)=>choose\('ocel'\)\}/);
 assert.match(ui,/w\.source==='t3'\?<button onClick=\{\(\)=>choose\('t3'\)\}/);
 assert.match(ui,/w\.source==='current'\?current:w\.source===current\?w\.source:'none'/);
 assert.match(ui,/sourceHeading/);
 assert.match(ui,/sourceDetail/);
 assert.match(ui,/reviewStatus==='HOLD'/);
});
test('saved and recovered D2 drafts stay separate from an export permission',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx');
 const details=load('../desktop/src/ActivityInnerPage.tsx');
 assert.match(ui,/data\.t3Review\?\.recovered/);
 assert.match(details,/Восстановление подтверждено/);
 assert.match(details,/Сохранение не подтверждено/);
 assert.match(details,/data\.t3Review\?\.stageBlocked/);
 assert.match(details,/data\.t3Review\?\.status==='STAGED'/);
 assert.match(details,/Выпуск \.iwxa и передача результата остаются закрыты/);
 assert.doesNotMatch(details,/createWorkspace\(|putObject\(|new Kernel/);
});
test('widget controls expose exact UI Automation names for installed Windows user flow',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx');
 const witness=load('../desktop/tests/installed-windows-ui.ps1');
 assert.match(ui,/Перетащить блок: /);
 assert.match(ui,/Добавить: /);
 assert.match(witness,/IWXA_ACTIVITY_V7_NATIVE_WIDGET_ADDED_PASS/);
 assert.match(witness,/IWXA_ACTIVITY_V7_NATIVE_REORDER_PASS/);
 assert.match(witness,/IWXA_ACTIVITY_V7_NATIVE_COLD_LAYOUT_PASS/);
});
