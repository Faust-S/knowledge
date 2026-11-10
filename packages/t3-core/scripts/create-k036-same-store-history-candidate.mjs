/**
 * Issue #3 - derive a separate Kernel successor from exact timestamp-patched
 * source. Do not rewrite qualified Runtime/Factory or expand import scope.
 */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir=dirname(fileURLToPath(import.meta.url));
const subjectPath=resolve(scriptDir,'../../kernel-successors/k036-atomic-graph/SOURCE_SUBJECT.json');
const regressionPath=resolve(scriptDir,'../../kernel-successors/k036-same-store-event-history-20261019/same-store-event-history.test.ts');
const timestampSha='c6628836b5f7d1b39432cf52889976378cda798183eea58ecf2619dcac4c3d0f';
const priorArtifactId='iwxa-kernel-k036-import-timestamp-20261018-qualified.1';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fail(code){throw new Error('K036_SAME_STORE_'+code);}
function safe(root,path){
  if(typeof path!=='string'||!path||path.includes('\\')||isAbsolute(path)||
     path.split('/').some(part=>!part||part==='.'||part==='..'))fail('UNSAFE_PATH');
  const result=resolve(root,path),rel=relative(root,result);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))fail('PATH_ESCAPE');
  return result;
}
function patchExactCount(text,re,change,label,expectedCount=1){
  if(!re.global)fail(label+'_PATTERN_NOT_GLOBAL');
  const matches=[...text.matchAll(re)];
  if(matches.length!==expectedCount)fail(label+'_ANCHORS_'+matches.length);
  const result=text.replace(re,change);
  if(result===text||[...result.matchAll(re)].length!==0)fail(label+'_REPLACEMENT_INCOMPLETE');
  return result;
}
function patchOnce(text,re,change,label){
  return patchExactCount(text,re,change,label,1);
}
// Source integrity is secured by the immutable inventory/SHA checks.
// Rewrite every matching call to the correct workspace-scoped key;
// never guess how many branches the verified source happens to contain.
function patchAllCalls(text,re,replacement,label){
  if(!re.global)fail(label+'_PATTERN_NOT_GLOBAL');
  if(![...text.matchAll(re)].length)fail(label+'_MISSING');
  const patched=text.replace(re,replacement);
  if(patched===text||[...patched.matchAll(re)].length)fail(label+'_INCOMPLETE');
  return patched;
}
// Structural insertion preserves the footer. Verify the footer once before
// and after plus one new DB8 migration, instead of treating its retention as
// a failed substitution.
function insertDB8Step(text,step){
  const footer=/\n\];\n\nexport function runMigrations\(/g;
  const anchors=[...text.matchAll(footer)];
  if(anchors.length!==1)fail('EVENT_STORE_UPGRADE_ANCHORS_'+anchors.length);
  if(/\bversion:\s*8\s*,/.test(text))fail('EVENT_STORE_UPGRADE_ALREADY_PRESENT');
  const result=text.replace(footer,'\n'+step+'\n];\n\nexport function runMigrations(');
  if(result===text||[...result.matchAll(footer)].length!==1||
     [...result.matchAll(/\bversion:\s*8\s*,/g)].length!==1||
     !result.includes(step))fail('EVENT_STORE_UPGRADE_INCOMPLETE');
  return result;
}
export function patchSameStoreEventFiles(original){
  const files=new Map(original);
  let migrations=files.get('src/local-store/internal/migrations.ts');
  if(typeof migrations!=='string')fail('MISSING_MIGRATIONS');
  migrations=patchOnce(migrations,
    /db\.createObjectStore\(STORES\.events,\s*\{\s*keyPath:\s*"event_id"\s*\}\)/g,
    'db.createObjectStore(STORES.events, { keyPath: ["workspace_id", "event_id"] })',
    'EVENT_STORE_KEY');
  migrations=patchOnce(migrations,
    /db\.createObjectStore\(STORES\.relations,\s*\{\s*keyPath:\s*"relation_id"\s*\}\)/g,
    'db.createObjectStore(STORES.relations, { keyPath: ["workspace_id", "relation_id"] })',
    'RELATION_STORE_KEY');
  const step=[
    '  {',
    '    version: 8,',
    '    description: "Scope event and relation storage identity to Workspace while preserving history.",',
    '    up: (db, tx) => {',
    '      const oldEvents = tx.objectStore(STORES.events);',
    '      const oldRelations = tx.objectStore(STORES.relations);',
    '      const eventKey = oldEvents.keyPath, relationKey = oldRelations.keyPath;',
    '      const compound = (key: string | string[] | null, id: string): boolean => Array.isArray(key) && key.length === 2 &&',
    '        key[0] === "workspace_id" && key[1] === id;',
    '      if (compound(eventKey, "event_id") && compound(relationKey, "relation_id")) {',
    '        tx.objectStore(STORES.migrations).put({',
    '          id: 8, description: STEPS[7].description, applied_at: new Date().toISOString(),',
    '        });',
    '        return;',
    '      }',
    '      if (eventKey !== "event_id" || relationKey !== "relation_id") {',
    '        throw new Error("WORKSPACE_STORE_KEYPATH_UNEXPECTED");',
    '      }',
    '      // Both store snapshots and rebuilds share ONE versionchange transaction.',
    '      // Any error aborts the migration; DB7 records are not dropped.',
    '      let eventsSnapshot: unknown[] | undefined;',
    '      let relationsSnapshot: unknown[] | undefined;',
    '      const migrate = () => {',
    '        if (!eventsSnapshot || !relationsSnapshot) return;',
    '        db.deleteObjectStore(STORES.events);',
    '        db.deleteObjectStore(STORES.relations);',
    '        createEventsStore(db);',
    '        createRelationsStore(db);',
    '        const events = tx.objectStore(STORES.events);',
    '        const relations = tx.objectStore(STORES.relations);',
    '        for (const event of eventsSnapshot) events.add(event);',
    '        for (const relation of relationsSnapshot) relations.add(relation);',
    '        tx.objectStore(STORES.migrations).put({',
    '          id: 8, description: STEPS[7].description, applied_at: new Date().toISOString(),',
    '        });',
    '      };',
    '      const er = oldEvents.getAll(), rr = oldRelations.getAll();',
    '      er.onsuccess = () => { eventsSnapshot = er.result; migrate(); };',
    '      rr.onsuccess = () => { relationsSnapshot = rr.result; migrate(); };',
    '    },',
    '  },'
  ].join('\n');
  migrations=insertDB8Step(migrations,step);
  files.set('src/local-store/internal/migrations.ts',migrations);
  let types=files.get('src/local-store/types.ts');
  if(typeof types!=='string')fail('MISSING_TYPES');
  types=patchOnce(types,/export const DB_VERSION = 7;/g,'export const DB_VERSION = 8;','DB_VERSION');
  files.set('src/local-store/types.ts',types);
  let transactions=files.get('src/local-store/transactions.ts');
  if(typeof transactions!=='string')fail('MISSING_TRANSACTIONS');
  // Both object write and object delete verify event immutability. Keep
  // both checks workspace-scoped; changing just one corrupts DB8 behavior.
  transactions=patchAllCalls(transactions,
    /\.get\(\s*ev\.event_id\s*\)/g,
    '.get([ev.workspace_id, ev.event_id])','T1_EVENT_LOOKUP');
  transactions=patchAllCalls(transactions,
    /\.get\(\s*input\.relation_id\s*\)/g,
    '.get([input.workspace_id, input.relation_id])','T1_RELATION_LOOKUP');
  transactions=patchOnce(transactions,/\.delete\(\s*input\.relation_id\s*\)/g,
    '.delete([input.workspace_id, input.relation_id])','T1_RELATION_DELETE');
  files.set('src/local-store/transactions.ts',transactions);
  let localStore=files.get('src/local-store/LocalStore.ts');
  if(typeof localStore!=='string')fail('MISSING_LOCAL_STORE');
  localStore=patchOnce(localStore,/(\.readOne(?:<RelationRecord>)?)\(\s*STORES\.relations,\s*relation_id\s*\)/g,
    '$1(STORES.relations, [workspace_id, relation_id])','READ_RELATION');
  files.set('src/local-store/LocalStore.ts',localStore);
  let graph=files.get('src/local-store/atomic-graph.ts');
  if(typeof graph!=='string')fail('MISSING_ATOMIC_GRAPH');
  graph=patchAllCalls(graph,
    /\.get\(\s*row\.relation_id\s*\)/g,
    '.get([input.workspace_id, row.relation_id])','GRAPH_RELATION_LOOKUP');
  graph=patchOnce(graph,/objectStore\(STORES\.relations\)\.delete\(id\)/g,
    'objectStore(STORES.relations).delete([input.workspace_id, id])','GRAPH_RELATION_DELETE');
  files.set('src/local-store/atomic-graph.ts',graph);
  let commit=files.get('src/package/import/commit.ts');
  if(typeof commit!=='string'||!commit.includes('eventsToApply'))fail('MISSING_IMPORT_EVENTS');
  commit=patchAllCalls(commit,/\.get\(\s*e\.event_id\s*\)/g,
    '.get([e.workspace_id, e.event_id])','T2_EVENT_LOOKUP');
  // Same-workspace ID can be idempotent only for an exactly identical record.
  // A different event with the same ID is an atomic conflict, not a skip.
  commit=patchAllCalls(commit,/\bif\s*\(\s*existing\s*\)\s*continue\s*;/g,
    'if (existing) {\n          if (JSON.stringify(existing) !== JSON.stringify(e)) {\n            throw new Error("IMPORT_EVENT_ID_COLLISION");\n          }\n          continue;\n        }',
    'EVENT_COLLISION_POLICY');
  files.set('src/package/import/commit.ts',commit);
  return files;
}
export function createSameStoreHistoryCandidate(sourceArg,targetArg){
  const source=realpathSync(sourceArg),target=resolve(targetArg);
  if(existsSync(target))fail('TARGET_EXISTS');
  if(source===target||target.startsWith(source+sep)||source.startsWith(target+sep))fail('OVERLAPPING_ROOTS');
  const checkout=realpathSync(resolve(scriptDir,'../../../../..'));
  const rel=relative(checkout,target);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))fail('TARGET_IN_T2_CHECKOUT');
  const subject=JSON.parse(readFileSync(subjectPath,'utf8'));
  const marker=JSON.parse(readFileSync(resolve(source,'IMPORT_TIMESTAMP_CANDIDATE.json'),'utf8'));
  if(subject.kernelVersion!=='0.3.6'||subject.runtimeContract!=='1.3.0'||
     subject.sourceTreeSha256!=='9917c5c12790f138184100de2e7b725395fc77b1fd901c676d6e21e47acd4a1b'||
     !Array.isArray(subject.inventory)||subject.inventory.length!==437||
     marker.afterSha256!==timestampSha||marker.status!=='SOURCE_PATCHED_UNQUALIFIED')fail('SOURCE_IDENTITY');
  const inputs=new Map();
  for(const row of subject.inventory){
    const full=safe(source,row.path);
    if(!lstatSync(full).isFile()||realpathSync(full)!==full)fail('SOURCE_LINK:'+row.path);
    const bytes=readFileSync(full);
    const hash=row.path==='src/package/import/commit.ts'?timestampSha:row.sha256;
    if(sha(bytes)!==hash||
       (row.path!=='src/package/import/commit.ts'&&bytes.length!==row.bytes))fail('SOURCE_HASH:'+row.path);
    inputs.set(row.path,bytes);
  }
  const selected=new Map(['src/local-store/internal/migrations.ts','src/local-store/types.ts',
    'src/local-store/transactions.ts','src/local-store/LocalStore.ts',
    'src/local-store/atomic-graph.ts','src/package/import/commit.ts']
    .map(path=>[path,inputs.get(path).toString('utf8')]));
  const patched=patchSameStoreEventFiles(selected);
  mkdirSync(target,{recursive:true});
  const changed=[];
  for(const [path,original] of inputs){
    const bytes=patched.has(path)?Buffer.from(patched.get(path),'utf8'):original;
    const destination=safe(target,path);
    mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,bytes,{flag:'wx'});
    if(patched.has(path)){
      if(sha(bytes)===sha(original))fail('UNMODIFIED:'+path);
      changed.push({path,beforeSha256:sha(original),afterSha256:sha(bytes)});
    }
  }
  mkdirSync(resolve(target,'tests'),{recursive:true});
  writeFileSync(safe(target,'tests/same-store-event-history.test.ts'),
    readFileSync(regressionPath),{flag:'wx'});
  const identity={
    schema:'IWXA_K036_SAME_STORE_HISTORY_CANDIDATE_V1',
    status:'SOURCE_PATCHED_UNQUALIFIED',
    issue:'Faust-S/T2#3',baseQualifiedArtifactId:priorArtifactId,
    kernelInternalVersion:'0.3.6',runtimeContract:'1.3.0',
    localStoreVersion:8,changedFiles:changed,
    semantics:'composite (workspace_id,event_id) and (workspace_id,relation_id) keys; original historical IDs, metadata and payloads unchanged',
    test:'tests/same-store-event-history.test.ts',
    qualificationRequired:'TARGETED_KERNEL_MIGRATION_AND_REAL_EXCHANGE_UI_SAME_STORE',
    productionActivation:false
  };
  writeFileSync(resolve(target,'SAME_STORE_HISTORY_CANDIDATE.json'),JSON.stringify(identity,null,2)+'\n');
  return identity;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw new Error(
    'Usage: create-k036-same-store-history-candidate.mjs <verified-timestamp-source> <new-external-dir>');
  console.log(JSON.stringify(createSameStoreHistoryCandidate(process.argv[2],process.argv[3]),null,2));
}
