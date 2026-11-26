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
 assert.match(page,/reviewD05ResultSelection\(records,\{includeTechnologyDraft:true,includeLocalContextDetails\}\)/);
 assert.match(page,/multiple accept="\.json,application\/json"/);
 assert.match(page,/JSON.parse\(await file.text\(\)\)/);
 assert.match(page,/generation.current/);
 assert.match(page,/Выпуск \.iwxa закрыт/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|fetch\(|createWorkspace\(|putObject\(/);
});

test('A4.1 domain Host is separate from generic D2 and uses an explicit original callback',()=>{
 const page=load('../desktop/src/DomainRouteComparison.tsx');
 const app=load('../desktop/src/App.tsx');
 const surface=load('../desktop/src/host-surface.tsx');
 assert.match(page,/await host\.readSelectedRoutes\(\)/);
 assert.match(page,/host\.readSelectedRoutes\(\{includeRecordedReports,includeLocalContextDetails:true\}\)/);
 assert.match(page,/onChange=\{e=>\{reset\(\);setIncludeLocalContextDetails\(e.target.checked\);\}\}/);
 assert.match(page,/host\.subscribeInvalidation/);
 assert.match(page,/ORIGINAL_SIGNED_SELECTED_READBACK/);
 assert.match(page,/hostConnected\?<><button/);
 assert.match(app,/d05RouteHost/);
 assert.match(surface,/readSelectedRoutes,subscribeInvalidation/);
 assert.match(surface,/IWXA_ACTIVITY_NARROW_D05_HOST_REQUIRED/);
});

test('A4.2 local result route and native comparison witness use existing shell',()=>{
 const workspace=load('../desktop/src/ActivityWorkspace.tsx'),inner=load('../desktop/src/ActivityInnerPage.tsx');
 const page=load('../desktop/src/ProcessToolReview.tsx'),witness=load('../desktop/tests/installed-windows-ui.ps1');
 assert.match(workspace,/Результаты Process Mining/);assert.match(inner,/<ProcessToolReview/);
 assert.match(page,/readR4pmResultBytes\(new Uint8Array\(await file.arrayBuffer\(\)\)\)/);
 assert.match(page,/compareR4pmReviews\(review,next\)/);
 assert.match(page,/adjacent.slice\(edgePage\*LIMIT/);
 assert.match(page,/differences.slice\(diffPage\*LIMIT/);
 assert.match(page,/условный пример/);assert.match(witness,/IWXA_ACTIVITY_A42_NATIVE_COMPARISON_PASS/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|fetch\(|createWorkspace\(|putObject\(/);
});

test('A4.1-IV shows declared quality differences in the existing route review',()=>{
 const page=load('../desktop/src/DomainRouteComparison.tsx');
 assert.match(page,/buildD05RouteQualityComparisonExample/);
 assert.match(page,/Карты качества и критерии приёмки/);
 assert.match(page,/Различаются заявленные требования качества/);
 assert.match(page,/QUALITY_COMPARISON\[quality.comparison\]/);
});

test('A4.3 private technology draft preserves source variant selection in the existing UI',()=>{
 const page=load('../desktop/src/DomainRouteComparison.tsx');
 const panel=load('../desktop/src/TechnologyDraftPanel.tsx');
 assert.match(page,/<TechnologyDraftPanel/);
 assert.match(page,/generation.current/);
 assert.match(panel,/draft.profiles.find/);
 assert.match(panel,/profile.conditions/);
 assert.match(panel,/profile.checks/);
 assert.match(panel,/Технологический кандидат/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|fetch\(|putObject\(|download=/);
});

test('A4.3 user proposal stays tied to selected source model and preserves the original conditions',()=>{
 const panel=load('../desktop/src/TechnologyDraftPanel.tsx'),editor=load('../desktop/src/TechnologyProposalEditor.tsx');
 assert.match(panel,/forms\[profile.model_number\]/);
 assert.match(editor,/prepareD05TechnologyProposal\(review,groupId,profile.model_number,form\)/);
 assert.match(editor,/Предложение технологии/);
 assert.match(editor,/Незаполненных полей/);
 assert.match(editor,/setPreview\(null\)/);
 assert.doesNotMatch(editor,/localStorage|sessionStorage|fetch\(|putObject\(|download=/);
});

test('A4.3 parameterization decisions and candidate review remain in the current source variant',()=>{
 const panel=load('../desktop/src/TechnologyDraftPanel.tsx');
 const disclosure=load('../desktop/src/TechnologyDisclosurePanel.tsx');
 assert.match(panel,/decisions\[profile.model_number\]/);
 assert.match(disclosure,/prepareD05DisclosureCandidate\(review,groupId,profile.model_number,form,decisions\)/);
 assert.match(disclosure,/RETAIN_DECLARATION/);
 assert.match(disclosure,/PARAMETERIZE/);
 assert.match(disclosure,/computed\?\.form===form&&computed.decisions===decisions/);
 assert.match(disclosure,/Сформировать кандидат для проверки раскрытия/);
 assert.doesNotMatch(disclosure,/localStorage|sessionStorage|fetch\(|putObject\(|download=/);
});

test('A4.4 reads actual candidate-bound local Presidio result without automatic disclosure',()=>{
 const panel=load('../desktop/src/PresidioReviewPanel.tsx'),disclosure=load('../desktop/src/TechnologyDisclosurePanel.tsx');
 assert.match(disclosure,/<PresidioReviewPanel candidate=\{candidate\}/);
 assert.match(panel,/await reviewPresidioTextScreening\(candidate,raw\)/);
 assert.match(panel,/generation.current/);
 assert.match(panel,/Это не подтверждает анонимность/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|fetch\(|putObject\(|download=/);
});

test('D05 proposal UI prepares a local model request, validates exact returned fields and does not overwrite user corrections',()=>{
 const panel=load('../desktop/src/D05ExtractionPanel.tsx'),editor=load('../desktop/src/TechnologyProposalEditor.tsx');
 assert.match(editor,/<D05ExtractionPanel/);assert.match(editor,/<D05PracticalLessonsPanel/);
 assert.match(panel,/prepareD05ExtractionRequest\(review,groupId,modelNumber,\{includeCompatibleDeclarations,includeRecordedReports\}\)/);
 assert.match(panel,/reviewD05ExtractionProposal\(review,groupId,modelNumber,raw,\{includeCompatibleDeclarations,includeRecordedReports\}\)/);
 assert.match(panel,/useState\(true\)/);assert.match(panel,/family.member_count/);assert.match(panel,/setCompatible/);
 assert.match(panel,/\.\.\.result.decisions,\.\.\.decisions/);
 assert.match(panel,/!next\[k\]\?\.trim\(\)/);
 assert.doesNotMatch(panel,/fetch\(|XMLHttpRequest|WebSocket|exportPackage|putObject/);
});

test('complete product screening offers batch functional corrections, resetting all reports when the product changes',()=>{
 const panel=load('../desktop/src/ProductPresidioReviewPanel.tsx'),general=load('../desktop/src/ProductGeneralizationPanel.tsx');
 assert.match(panel,/setRawReports\(\{\}\)/);
 assert.match(panel,/ProductGeneralizationPanel product=\{product\} reports=\{rawReports\} sourceReferences=\{sourceReferences\}/);
 assert.match(general,/prepareProductGeneralization\(product,Object.values\(reports\),language,references\)/);
 assert.match(general,/applyProductGeneralization\(product,Object.values\(reports\)/);
 assert.match(general,/onRevision\(value.preview\)/);
 assert.doesNotMatch(general,/fetch\(|putObject|exportPackage|localStorage/);
});
