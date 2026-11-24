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
test('all twenty user-facing routes and owner-only safety states are reachable',()=>{
 const component=load('../desktop/src/ActivityWorkspace.tsx');
 const inner=load('../desktop/src/ActivityInnerPage.tsx');
 const names=['Главная','Источники','Схемы A0/A1','Рабочая область',
  'Реконструкция','Группировка маршрутов','Карта процессов','Аудит A2','OCEL 2.0','Стандарты',
  'T3 D1/D2','Карта T3','Паспорт фактов','Свидетельства D05',
  'Проверка','Черновик и восстановление','Выпуск и обмен','Квалификация','Настройки','Справка'];
 for(const name of names)assert.ok(component.includes(name)||inner.includes(name),name);
 assert.match(inner,/disabled=\{!data.canStage\|\|!t3/);
 assert.match(inner,/disabled=\{!data.canRecover\|\|data.t3Review\?\.status==='RECOVERING'/);
 assert.match(inner,/HOLD · выпуск закрыт/);
 assert.doesNotMatch(inner,/new Kernel|createWorkspace\(|putObject\(|exportPackage\(/);
});

test('pinned source dashboard uses existing Actions, not stale results of a previous source',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx');
 assert.match(ui,/w\.source==='a1'\?<button onClick=\{\(\)=>choose\('a1',true\)\}/);
 assert.match(ui,/w\.source==='ocel'\?<button onClick=\{\(\)=>choose\('ocel',true\)\}/);
 assert.match(ui,/w\.source==='t3'\?<button onClick=\{\(\)=>choose\('t3',true\)\}/);
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

test('the dashboard changes an explicitly pinned source in place and bounds large previews',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx');
 assert.match(ui,/if\(!keepDashboard\)go\('Источники'\)/);
 assert.match(ui,/processes\.slice\(0,6\)/);
 assert.match(ui,/states\.slice\(0,8\)/);
 assert.match(ui,/Открыть всю карту/);
 assert.match(ui,/Все процессы/);
});

test('A4.1 is reachable inside the native shell with actual local route comparison',()=>{
 const inner=load('../desktop/src/ActivityInnerPage.tsx');
 const page=load('../desktop/src/DomainRouteComparison.tsx');
 assert.match(inner,/case 'Группировка маршрутов':return <DomainRouteComparison/);
 assert.match(page,/reviewD05RouteModels\(records\)/);
 assert.match(page,/multiple accept="\.json,application\/json"/);
 assert.match(page,/JSON.parse\(await file.text\(\)\)/);
 assert.match(page,/generation.current/);
 assert.match(page,/Выпуск \.iwxa закрыт/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|fetch\(|createWorkspace\(|putObject\(/);
});

test('A4.2 consumes original external result inside V7 and clears local state',()=>{
 const ui=load('../desktop/src/ActivityWorkspace.tsx'),inner=load('../desktop/src/ActivityInnerPage.tsx'),page=load('../desktop/src/Rust4pmResultReview.tsx');
 assert.match(ui,/'Внешний анализ'/);assert.match(inner,/case 'Внешний анализ':return <Rust4pmResultReview/);
 assert.match(page,/reviewRust4pmResult\(raw\)/);assert.match(page,/JSON.parse\(await file.text\(\)\)/);
 assert.match(page,/generation.current/);assert.match(page,/Выпуск \.iwxa закрыт/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|fetch\(|createWorkspace\(|putObject\(/);
});
