import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectProcessHistoryError,
  qualifyProjectProcessSameWorkspaceHistory,
} from '../src/modules/base/owners/project-process-history.mjs';

function record(overrides={}) {
  return {
    family:'iwxa.project',
    objectId:'project:ws-1:p-1',
    recordId:'project:p-1@1',
    revision:1,
    previousRevisionId:null,
    ownerId:'iwxa.project-process.owner',
    headKind:'source',
    payload:{
      schema:'IWXA_T2_PROJECT_V1',
      objectKind:'project',
      sourceTruth:true,
      workspaceId:'ws-1',
      projectId:'p-1',
    },
    refs:{workspaceId:'ws-1',canonicalHeads:{}},
    ...overrides,
  };
}

test('C3 same-Workspace history qualification accepts contiguous owner-scoped source history', () => {
  const records=[
    record(),
    record({
      recordId:'project:p-1@2',
      revision:2,
      previousRevisionId:'project:p-1@1',
    }),
    record({
      family:'iwxa.work',
      objectId:'work:ws-1:w-1',
      recordId:'work:w-1@1',
      payload:{
        schema:'IWXA_T2_WORK_V1',
        objectKind:'work',
        sourceTruth:true,
        workspaceId:'ws-1',
        workId:'w-1',
        projectId:'p-1',
      },
      refs:{
        workspaceId:'ws-1',
        canonicalHeads:{
          project:{
            family:'iwxa.project',
            objectId:'project:ws-1:p-1',
            recordId:'project:p-1@2',
          },
        },
      },
    }),
  ];
  const result=qualifyProjectProcessSameWorkspaceHistory({workspaceId:'ws-1',records});
  assert.equal(result.status,'PASS');
  assert.equal(result.workspaceId,'ws-1');
  assert.equal(result.ownerId,'iwxa.project-process.owner');
  assert.equal(result.recordCount,3);
  assert.equal(result.objectCount,2);
  assert.deepEqual(result.families,['iwxa.project','iwxa.work']);
});

test('C3 history fails closed on cross-Workspace revisions', () => {
  assert.throws(
    () => qualifyProjectProcessSameWorkspaceHistory({
      workspaceId:'ws-1',
      records:[record({payload:{...record().payload,workspaceId:'ws-2'}})],
    }),
    (error) => error instanceof ProjectProcessHistoryError
      && error.code === 'PROJECT_PROCESS_HISTORY_WORKSPACE_MISMATCH',
  );
});

test('C3 history fails closed on non-contiguous revisions', () => {
  assert.throws(
    () => qualifyProjectProcessSameWorkspaceHistory({
      workspaceId:'ws-1',
      records:[
        record(),
        record({recordId:'project:p-1@3',revision:3,previousRevisionId:'project:p-1@1'}),
      ],
    }),
    (error) => error?.code === 'PROJECT_PROCESS_HISTORY_REVISION_MISMATCH',
  );
});

test('C3 history requires referenced canonical source heads in the qualified set', () => {
  const work=record({
    family:'iwxa.work',
    objectId:'work:ws-1:w-1',
    recordId:'work:w-1@1',
    payload:{
      schema:'IWXA_T2_WORK_V1',
      objectKind:'work',
      sourceTruth:true,
      workspaceId:'ws-1',
      workId:'w-1',
      projectId:'p-missing',
    },
    refs:{
      workspaceId:'ws-1',
      canonicalHeads:{
        project:{family:'iwxa.project',objectId:'project:ws-1:p-missing',recordId:'project:p-missing@1'},
      },
    },
  });
  assert.throws(
    () => qualifyProjectProcessSameWorkspaceHistory({workspaceId:'ws-1',records:[work]}),
    (error) => error?.code === 'PROJECT_PROCESS_HISTORY_REFERENCED_HEAD_MISSING',
  );
});


test('C3 history accepts owner-scoped tombstone revisions without pretending tombstones are source payloads', () => {
  const records=[
    record(),
    record({
      recordId:'project:p-1@2',
      revision:2,
      previousRevisionId:'project:p-1@1',
      operation:'tombstone',
      payload:null,
      refs:{workspaceId:'ws-1',canonicalHeads:{}},
    }),
  ];
  const result=qualifyProjectProcessSameWorkspaceHistory({workspaceId:'ws-1',records});
  assert.equal(result.status,'PASS');
  assert.equal(result.recordCount,2);
});
