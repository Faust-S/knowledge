import {createHash} from 'node:crypto';
import { buildProjectProcessBridgePreview } from './project-process-bridge-preview.mjs';
import {
  createProjectProcessMigrationPreview,
  planProjectProcessMigrationCommit,
  recordProjectProcessMigrationCommit,
  recordProjectProcessMigrationRecovery,
} from './project-process-migration.mjs';
import { qualifyProjectProcessSameWorkspaceHistory } from './project-process-history.mjs';
import {
  createProjectProcessSourceOwnerQualificationHarness,
  createProjectProcessSourceOwnerPostBindingQualificationHarness,
} from './project-process-source-owner.mjs';

const SOURCE_KINDS=Object.freeze([
  'project','work','processDefinition','processRun','case','decision','activity','event',
]);

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys=Object.keys(value).sort();
  return `{${keys.map((key)=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

async function rejectsWithCode(action,code) {
  try {
    await action();
    return false;
  } catch (error) {
    return error?.code===code;
  }
}

async function qualifyProjectProcessSourceOwnerWithHarness(harness) {
  const workspaceId='ws-c3-qualification';
  const owner=harness.owner;

  const project1=await owner.create('project',{
    workspaceId,projectId:'project-1',name:'C3 qualification',domainApplicability:['shared'],
    recordId:'project-1@1',knowledgeAt:'2026-09-18T00:00:00Z',
  });
  const project2=await owner.revise('project',{
    workspaceId,projectId:'project-1',name:'C3 qualification',status:'active',domainApplicability:['shared'],
    recordId:'project-1@2',baseRevisionId:project1.recordId,knowledgeAt:'2026-09-18T00:01:00Z',
  });

  const work1=await owner.create('work',{
    workspaceId,workId:'work-1',projectId:'project-1',name:'Qualification work',dependencies:[],
    recordId:'work-1@1',knowledgeAt:'2026-09-18T00:02:00Z',
  });
  const work2=await owner.revise('work',{
    workspaceId,workId:'work-1',projectId:'project-1',name:'Qualification work',status:'active',dependencies:[],
    recordId:'work-1@2',baseRevisionId:work1.recordId,knowledgeAt:'2026-09-18T00:03:00Z',
  });

  const definition1=await owner.create('processDefinition',{
    workspaceId,definitionId:'definition-1',versionId:'v1',name:'Qualification process',
    domainApplicability:['shared'],activityIds:['inspect'],
    recordId:'definition-1@1',knowledgeAt:'2026-09-18T00:04:00Z',
  });
  const definition2=await owner.revise('processDefinition',{
    workspaceId,definitionId:'definition-1',versionId:'v2',name:'Qualification process',
    domainApplicability:['shared'],activityIds:['inspect'],
    recordId:'definition-1@2',baseRevisionId:definition1.recordId,knowledgeAt:'2026-09-18T00:05:00Z',
  });

  const run1=await owner.create('processRun',{
    workspaceId,runId:'run-1',definitionId:'definition-1',projectId:'project-1',workId:'work-1',status:'running',
    recordId:'run-1@1',knowledgeAt:'2026-09-18T00:06:00Z',
  });
  const run2=await owner.revise('processRun',{
    workspaceId,runId:'run-1',definitionId:'definition-1',projectId:'project-1',workId:'work-1',status:'completed',
    recordId:'run-1@2',baseRevisionId:run1.recordId,knowledgeAt:'2026-09-18T00:07:00Z',
  });

  const case1=await owner.create('case',{
    workspaceId,caseId:'case-1',projectId:'project-1',runId:'run-1',
    recordId:'case-1@1',knowledgeAt:'2026-09-18T00:08:00Z',
  });
  const case2=await owner.revise('case',{
    workspaceId,caseId:'case-1',projectId:'project-1',runId:'run-1',status:'closed',
    recordId:'case-1@2',baseRevisionId:case1.recordId,knowledgeAt:'2026-09-18T00:09:00Z',
  });

  const activity1=await owner.create('activity',{
    workspaceId,activityId:'activity-1',runId:'run-1',caseId:'case-1',definitionActivityId:'inspect',
    recordId:'activity-1@1',knowledgeAt:'2026-09-18T00:10:00Z',
  });
  const activity2=await owner.revise('activity',{
    workspaceId,activityId:'activity-1',runId:'run-1',caseId:'case-1',definitionActivityId:'inspect',status:'completed',
    recordId:'activity-1@2',baseRevisionId:activity1.recordId,knowledgeAt:'2026-09-18T00:11:00Z',
  });

  const event1=await owner.create('event',{
    workspaceId,eventId:'event-1',runId:'run-1',caseId:'case-1',activityId:'activity-1',
    eventType:'observed',occurredAt:'2026-09-18T00:12:00Z',evidenceRefs:['evidence:event-1'],
    recordId:'event-1@1',knowledgeAt:'2026-09-18T00:12:30Z',
  });
  const event2=await owner.revise('event',{
    workspaceId,eventId:'event-1',runId:'run-1',caseId:'case-1',activityId:'activity-1',
    eventType:'verified',occurredAt:'2026-09-18T00:13:00Z',evidenceRefs:['evidence:event-1'],
    recordId:'event-1@2',baseRevisionId:event1.recordId,knowledgeAt:'2026-09-18T00:13:30Z',
  });

  const decision1=await owner.create('decision',{
    workspaceId,decisionId:'decision-1',runId:'run-1',caseId:'case-1',decisionType:'gate',
    outcome:{pass:true},evidenceRefs:['evidence:decision-1'],decidedAt:'2026-09-18T00:14:00Z',
    recordId:'decision-1@1',knowledgeAt:'2026-09-18T00:14:30Z',
  });
  const decision2=await owner.revise('decision',{
    workspaceId,decisionId:'decision-1',runId:'run-1',caseId:'case-1',decisionType:'gate',
    outcome:{pass:true,qualified:true},evidenceRefs:['evidence:decision-1'],decidedAt:'2026-09-18T00:15:00Z',
    recordId:'decision-1@2',baseRevisionId:decision1.recordId,knowledgeAt:'2026-09-18T00:15:30Z',
  });

  const revisionConflictQualified=await rejectsWithCode(
    ()=>owner.revise('project',{
      workspaceId,projectId:'project-1',name:'stale revision',status:'active',domainApplicability:['shared'],
      recordId:'project-1@stale',baseRevisionId:project1.recordId,knowledgeAt:'2026-09-18T00:16:00Z',
    }),
    'REVISION_CONFLICT',
  );

  const latestByKind=Object.freeze({
    project:project2,work:work2,processDefinition:definition2,processRun:run2,
    case:case2,decision:decision2,activity:activity2,event:event2,
  });
  const ids=Object.freeze({
    project:'project-1',work:'work-1',processDefinition:'definition-1',processRun:'run-1',
    case:'case-1',decision:'decision-1',activity:'activity-1',event:'event-1',
  });
  const loadQualified={};
  for(const kind of SOURCE_KINDS){
    const loaded=await owner.load(kind,workspaceId,ids[kind]);
    loadQualified[kind]=loaded?.baseRevisionId===latestByKind[kind].recordId;
  }

  const resultScopeRejected=await rejectsWithCode(
    ()=>owner.create('result',{
      workspaceId,resultId:'result-1',projectId:'project-1',workId:'work-1',resultType:'artifact',
      evidenceRefs:['evidence:result-1'],recordId:'result-1@1',knowledgeAt:'2026-09-18T00:17:00Z',
    }),
    'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
  );
  const acceptanceScopeRejected=await rejectsWithCode(
    ()=>owner.create('acceptance',{
      workspaceId,acceptanceId:'acceptance-1',projectId:'project-1',resultId:'result-1',
      criteria:[{criterionId:'current',required:true,satisfied:true,evidenceRefs:['evidence:acceptance-1']}],
      recordId:'acceptance-1@1',knowledgeAt:'2026-09-18T00:17:30Z',
    }),
    'PROJECT_PROCESS_FAMILY_OUTSIDE_APPROVED_SCOPE',
  );

  const releases=[];
  let minute=18;
  for(const kind of ['event','decision','activity','case','processRun','processDefinition','work','project']){
    releases.push(await owner.release(kind,{
      workspaceId,
      objectId:ids[kind],
      recordId:`${ids[kind]}@3`,
      baseRevisionId:latestByKind[kind].recordId,
      knowledgeAt:`2026-09-18T00:${String(minute).padStart(2,'0')}:00Z`,
    }));
    minute+=1;
  }

  const records=Object.freeze([
    project1,project2,work1,work2,definition1,definition2,run1,run2,
    case1,case2,activity1,activity2,event1,event2,decision1,decision2,...releases,
  ]);
  const history=qualifyProjectProcessSameWorkspaceHistory({workspaceId,records});

  const loadAfterReleaseQualified={};
  for(const kind of SOURCE_KINDS){
    loadAfterReleaseQualified[kind]=(await owner.load(kind,workspaceId,ids[kind]))===null;
  }

  const audit=await owner.audit();
  const auditIdentityQualified=audit.length===records.length
    && audit.every((entry)=>entry.ownerId==='iwxa.project-process.owner');

  const bridge=buildProjectProcessBridgePreview({
    bridgeId:'c3-project-process-d1-qualification',
    affectedKinds:SOURCE_KINDS,
    semanticSourceIds:['T2.5:0.20.0','Project/Process:0.8-0.9'],
    changeSpecRef:'change-spec:c3-project-process',
    behavioralSpecRef:'behavioral-spec:c3-project-process',
    strongContractRef:'strong-contract:c3-project-process',
    harnessOracleRef:'harness:c3-project-process',
    boundedRequirements:['REQ-T25-020-006','REQ-T25-020-007','REQ-T25-020-016','REQ-T25-020-018','REQ-T25-020-029'],
    adoptionTopologyDeltaRef:'adoption-topology:c3-project-process',
    sourceBaselineEligibility:true,
    conflicts:[],
    openQuestions:[],
  });

  const migrationPreview=createProjectProcessMigrationPreview({
    migrationId:'c3-project-process-migration-qualification',
    workspaceId,
    predecessorSnapshotRef:'snapshot:c3-predecessor',
    bridgePreview:bridge,
    objects:[
      {kind:'project',sourceRecordId:'legacy:project-1',targetObjectId:'project-1'},
      {kind:'work',sourceRecordId:'legacy:work-1',targetObjectId:'work-1'},
    ],
  });
  const commitPlan=planProjectProcessMigrationCommit(migrationPreview,{commitId:'c3-commit-plan'});
  const commitReceipt=recordProjectProcessMigrationCommit(commitPlan,{
    commitReceiptRef:'receipt:c3-commit',
    committedRecordRefs:['project-1@1','work-1@1'],
  });
  const recoveryReceipt=recordProjectProcessMigrationRecovery(commitReceipt,{
    recoveryProofRef:'proof:c3-recovery',
    rollbackPolicy:'rollback',
  });

  const relationChecks=Object.freeze({
    workToProject:work2.refs.canonicalHeads.project.recordId===project2.recordId,
    runToDefinition:run2.refs.canonicalHeads.definition.recordId===definition2.recordId,
    runToWork:run2.refs.canonicalHeads.work.recordId===work2.recordId,
    caseToRun:case2.refs.canonicalHeads.run.recordId===run2.recordId,
    activityToCase:activity2.refs.canonicalHeads.case.recordId===case2.recordId,
    eventToActivity:event2.refs.canonicalHeads.activity.recordId===activity2.recordId,
    decisionToCase:decision2.refs.canonicalHeads.case.recordId===case2.recordId,
  });

  const pass=history.families.length===8
    && Object.values(relationChecks).every(Boolean)
    && Object.values(loadQualified).every(Boolean)
    && Object.values(loadAfterReleaseQualified).every(Boolean)
    && releases.every((record)=>record.operation==='tombstone'&&record.payload===null)
    && revisionConflictQualified
    && resultScopeRejected
    && acceptanceScopeRejected
    && auditIdentityQualified
    && recoveryReceipt.recoveryProven;

  return Object.freeze({
    schema:'IWXA_T2_C3_PROJECT_PROCESS_QUALIFICATION_RESULT_V2',
    status:pass?'PASS':'FAIL',
    exactCurrentSubject:true,
    historicalRecoveryRequired:false,
    productionWriteActivation:false,
    commonResultAcceptanceWrites:'FORBIDDEN',
    qualificationHarnessPersistent:harness.persistent,
    workspaceId,
    ownerId:'iwxa.project-process.owner',
    sourceFamiliesQualified:history.families,
    recordCount:history.recordCount,
    objectCount:history.objectCount,
    commandsQualified:Object.freeze({create:8,revise:8,load:8,release:8}),
    relationChecks,
    loadQualified:Object.freeze(loadQualified),
    loadAfterReleaseQualified:Object.freeze(loadAfterReleaseQualified),
    revisionConflictQualified,
    resultAcceptanceScopeRejection:Object.freeze({result:resultScopeRejected,acceptance:acceptanceScopeRejected}),
    auditIdentityQualified,
    auditCount:audit.length,
    releaseQualified:releases.every((record)=>record.operation==='tombstone'&&record.payload===null),
    migrationRecoveryProven:recoveryReceipt.recoveryProven,
    predecessorArchiveAllowedAfterRecovery:recoveryReceipt.predecessorArchiveAllowed,
    rollbackPolicy:recoveryReceipt.rollbackPolicy,
    d4ExactRelease:'PENDING',
  });
}

export async function qualifyProjectProcessSourceOwner() {
  const harness=await createProjectProcessSourceOwnerQualificationHarness();
  return qualifyProjectProcessSourceOwnerWithHarness(harness);
}

export async function qualifyProjectProcessPostBinding({activationReceipt,config}={}) {
  const harness=await createProjectProcessSourceOwnerPostBindingQualificationHarness({
    activationReceipt,
    config,
  });
  const base=await qualifyProjectProcessSourceOwnerWithHarness(harness);
  const result={
    ...base,
    schema:'IWXA_T2_C3_PROJECT_PROCESS_POST_BINDING_QUALIFICATION_RESULT_V1',
    postBindingSimulation:true,
    activationGateQualified:true,
    activationGateSha256:harness.gate.gateSha256,
    activationReceiptSha256:harness.gate.expectedActivationReceiptSha256,
    productionWriteActivation:false,
    qualificationHarnessPersistent:false,
  };
  return Object.freeze({
    ...result,
    qualificationSha256:createHash('sha256').update(stableJson(result)).digest('hex'),
  });
}
