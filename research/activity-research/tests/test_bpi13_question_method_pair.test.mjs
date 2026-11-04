import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compare,rank,readCatalog} from '../bpi13_question_method_pair.mjs';
const r={schema:'IWXA_BPI13_OFFICIAL_INCIDENTS_APPLICABILITY/0.1',
 source:{file_sha256:'6ec2136c607648608655802486df97a866f351668751b7ecbca51e1f8715d522',sha_pinned_before_this_run:true},
 population:{recorded_cases:7554,registered_events:65533,catalogue_counts_match:true},
 u1_sample:{native_owner_git_blob:'eb15aec5ba1a749c29d7c40a868127e1a384b6bf',engine_accepted:false,accepted_tasktypes:0},
 qualification:{accepted_user_tasks:0,independent_task_gold:'NOT_MEASURED'},
 field_applicability:{wait_user_label_events:4217,wait_user_label_cases:2495},
 questions:['INCIDENT_ESCALATION_TIMING','TEAM_PING_PONG','WAIT_USER_STATUS_ABUSE','ORGANIZATION_PROCESS_CONFORMITY'].map(id=>({id,source_fit:'PARTIAL',missing_evidence:['independent evidence']}))};
const cat=readCatalog([Buffer.from('@C06|Service|Role|test\n01|VERIFY|Проверить сроки поддержки|срок;поддержка|Проверен срок\n02|PLAN|Подготовить эскалацию обращения|обращение;передача|Правило соблюдено\n')]);
test('source-first neither accepts tasks nor misuses requester organization',()=>{
 const x=compare(r);assert.equal(x.source_first.question_count,4);assert.equal(x.qualification.accepted_tasks,0);
 assert.equal(x.questions[3].source_first.source_fit,'REQUESTER_ORG_NOT_SUPPORT_ORG');
 assert.equal(x.catalogue_prior.status,'NOT_RUN_OWNER_LOCAL_CATALOGUE_ABSENT');
});
test('catalogue lexical suggestions do not become gold',()=>{
 const x=compare(r,cat);assert.equal(x.catalogue_prior.denominator,2);
 assert.ok(x.catalogue_prior.candidate_count>0);
 assert.ok(x.questions.every(q=>q.catalogue_prior.accepted_tasktypes===0));
 assert.equal(rank(cat.entries,'INCIDENT_ESCALATION_TIMING')[0].id,'C06-01');
});
test('reject source drift, U1 authority escalation, invented E5',()=>{
 const a=structuredClone(r);a.source.sha_pinned_before_this_run=false;assert.throws(()=>compare(a),/SOURCE_PIN_HOLD/);
 const b=structuredClone(r);b.u1_sample.engine_accepted=true;assert.throws(()=>compare(b),/U1_AUTHORITY_HOLD/);
 const c=structuredClone(r);c.qualification.independent_task_gold='PASS';assert.throws(()=>compare(c),/GOLD_HOLD/);
});
test('reject invalid prior rows and unknown questions',()=>{
 assert.throws(()=>readCatalog([Buffer.from('01|PLAN|A|a|b')]),/CATALOGUE_ROW_INVALID/);
 assert.throws(()=>rank(cat.entries,'unknown'),/UNKNOWN_QUESTION/);
});
