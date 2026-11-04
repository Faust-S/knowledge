import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path)=>readFileSync(resolve(base,path));
const json=(path)=>JSON.parse(read(path).toString('utf8'));
const manifest=json('SOURCE_MIGRATION.json');

test('original 7 public-scoped files are byte-for-byte pinned to owner Git blobs',()=>{
 assert.equal(manifest.files.length,7);
 assert.equal(manifest.source_repository,'Faust-S/iwxa');
 assert.match(manifest.source_commit,/^[0-9a-f]{40}$/);
 for(const item of manifest.files){
   const target=item.target_path.slice('research/activity-research/'.length);
   assert.equal(item.source_path,'knowledge/activity-research/'+target);
   const bytes=read(target);
   const actual=createHash('sha1')
     .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
   assert.equal(actual,item.git_blob_sha,item.target_path);
   assert.equal(item.exact_bytes,true);
 }
});

test('published source references and external datasets are not accepted evidence',()=>{
 const evidence=json('EVIDENCE_REGISTRY.json');
 const datasets=json('DATASET_SOURCE_CANDIDATES_2026-10-23.json');
 assert.equal(evidence.reference_count,evidence.records.length);
 assert.equal(evidence.reference_count,47);
 assert.equal(new Set(evidence.records.map(x=>x.id)).size,evidence.records.length);
 assert.equal(datasets.source_count,datasets.entries.length);
 assert.equal(datasets.status,'CANDIDATES_ONLY_NO_REAL_DATA_INGESTION');
 assert.ok(datasets.entries.every(x=>x.url&&x.data_kind&&x.access&&x.not_valid_for));
});

test('ADP-001 contains only secondary cases, no promoted TaskType or field pass',()=>{
 const pilot=json('pilots/ADP-001.json');
 assert.equal(pilot.sources.length,5);
 assert.equal(pilot.evidence.length,11);
 assert.equal(pilot.cases.length,5);
 assert.equal(pilot.negative_probes.length,8);
 assert.equal(pilot.qualification,'DESK_CASES_PREPARED_NO_EMPIRICAL_PASS');
 const sourceIds=new Set(pilot.sources.map(x=>x.id));
 const evidenceIds=new Set(pilot.evidence.map(x=>x.id));
 const cases=new Set(pilot.cases.map(x=>x.id));
 for(const e of pilot.evidence) assert.ok(sourceIds.has(e.source));
 for(const c of pilot.cases) {
  assert.equal(c.task_types,'NONE_ACCEPTED');
  assert.ok(c.evidence_ids.every(x=>evidenceIds.has(x)));
  assert.ok(c.source_ids.every(x=>sourceIds.has(x)));
 }
 for(const p of pilot.negative_probes){
   assert.ok(cases.has(p.case_id));
   assert.equal(p.expected,'REJECT_AS_UNSUPPORTED');
   assert.ok(p.evidence_ids.every(x=>evidenceIds.has(x)));
 }
 const zero=pilot.cases.find(c=>c.id==='CASE-0');
 assert.deepEqual(zero.evidence_ids,[]);
 assert.deepEqual(zero.confirmed_activity,[]);
 assert.equal(zero.outcome,'CLARIFY_INSTEAD_OF_INVENTING_PROCESS');
});

test('all local Markdown research and adjacent-work links resolve',()=>{
 for(const item of manifest.files.filter(x=>x.target_path.endsWith('.md')).map(x=>x.target_path.slice('research/activity-research/'.length))){
  const doc=read(item).toString('utf8');
  const links=[...doc.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]);
  for(const href of links){
   if(href.startsWith('#')||/^https?:\/\//.test(href)) continue;
   const p=resolve(dirname(resolve(base,item)),href.split('#')[0]);
   assert.ok(existsSync(p),'unresolved link '+item+' -> '+href);
  }
 }
});

test('read-only PET benchmark is present but does not bundle upstream corpus',()=>{
 const source=read('pet_activity_benchmark.mjs').toString('utf8');
 assert.match(source,/PET_EXACT_UPSTREAM_GIT_BLOB_MISMATCH/);
 assert.match(source,/task_candidates_created:0/);
 assert.match(source,/accepted_task:false/);
 assert.equal(existsSync(resolve(base,'PETv1.1-entities.jsonl')),false);
});
