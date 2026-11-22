import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIVITY_WIDGETS,ACTIVITY_DEFAULT_BOARD,defaultActivityBoard,
 normalizeActivityBoard,moveActivityWidget,updateActivityWidget} from '../modules/activity-base-anonymizer/dashboard-layout.mjs';
test('dashboard initializes with real Activity routes and sixteen user-selectable blocks',()=>{
  assert.equal(Object.keys(ACTIVITY_WIDGETS).length,16);
  assert.equal(defaultActivityBoard().length,6);
  assert.notStrictEqual(defaultActivityBoard()[0],ACTIVITY_DEFAULT_BOARD[0]);
  assert.deepEqual(normalizeActivityBoard(defaultActivityBoard()),defaultActivityBoard());
});
test('malformed layout cannot carry source objects, credentials or extra fields into workspace',()=>{
  assert.equal(normalizeActivityBoard([{id:'raw'}]),null);
  assert.equal(normalizeActivityBoard([{...defaultActivityBoard()[0],source:'raw-kernel'}]),null);
  assert.equal(normalizeActivityBoard([{...defaultActivityBoard()[0],size:'100vw'}]),null);
  assert.equal(normalizeActivityBoard(Array(25).fill(defaultActivityBoard()[0])),null);
  const privateRow={...defaultActivityBoard()[0],signedAccess:'secret',sourceWorkspaceId:'raw'};
  assert.deepEqual(normalizeActivityBoard([privateRow]),[defaultActivityBoard()[0]]);
  assert.equal(JSON.stringify(normalizeActivityBoard([privateRow])).includes('secret'),false);
});
test('drag reorder moves exactly one block without dropping another',()=>{
  const before=defaultActivityBoard(),id=before[0].id,last=before.at(-1).id;
  const after=moveActivityWidget(before,id,last,true);
  assert.equal(after.length,before.length);
  assert.equal(after.at(-1).id,id);
  assert.equal(before[0].id,id);
  assert.equal(new Set(after.map(x=>x.id)).size,before.length);
});
test('size/source edits preserve unrelated widgets and reject impossible sources',()=>{
  const board=defaultActivityBoard(),id=board[0].id;
  const changed=updateActivityWidget(board,id,{size:'compact',source:'ocel',label:'Моя аналитика'});
  assert.equal(changed[0].source,'ocel');
  assert.equal(changed[0].size,'compact');
  assert.equal(changed[0].label,'Моя аналитика');
  assert.equal(changed[1].id,board[1].id);
  assert.equal(updateActivityWidget(board,'db-processes',{source:'t3'}),null);
  assert.equal(updateActivityWidget(board,id,{size:'invalid'}),null);
});
