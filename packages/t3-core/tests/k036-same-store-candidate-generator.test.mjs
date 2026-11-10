import {test} from "node:test";
import assert from "node:assert/strict";
import {patchSameStoreEventFiles} from "../scripts/create-k036-same-store-history-candidate.mjs";

function fixtures({t1Events=2,t1Relations=3,graphRelations=2,dbVersion=7}={}){
  const rows=(n,text)=>Array.from({length:n},()=>text).join("\n");
  return new Map([
    ["src/local-store/internal/migrations.ts",
      'const ev=db.createObjectStore(STORES.events, { keyPath: "event_id" });\n'+
      'const rel=db.createObjectStore(STORES.relations, { keyPath: "relation_id" });\n'+
      'const STEPS = [\n  { version: 7 },\n];\n\nexport function runMigrations('],
    ["src/local-store/types.ts","export const DB_VERSION = "+dbVersion+";"],
    ["src/local-store/transactions.ts",
      rows(t1Events,"tx.objectStore(STORES.events).get(ev.event_id);")+"\n"+
      rows(t1Relations,"tx.objectStore(STORES.relations).get(input.relation_id);")+"\n"+
      "tx.objectStore(STORES.relations).delete(input.relation_id);"],
    ["src/local-store/LocalStore.ts","await this.readOne<RelationRecord>(STORES.relations, relation_id);"],
    ["src/local-store/atomic-graph.ts",
      rows(graphRelations,"tx.objectStore(STORES.relations).get(row.relation_id);")+"\n"+
      "tx.objectStore(STORES.relations).delete(id);"],
    ["src/package/import/commit.ts",
      "for (const e of eventsToApply) {\n  const existing=await promisify(tx.objectStore(STORES.events).get(e.event_id));\n"+
      "  const previous=await promisify(tx.objectStore(STORES.events).get(e.event_id));\n"+
      "  if (existing) continue;\n  tx.objectStore(STORES.events).add(e);\n}"]
  ]);
}

test("all six inputs: workspace-scoped events and relations; preserved DB8 footer",()=>{
  const original=fixtures(),result=patchSameStoreEventFiles(original);
  assert.equal(result.size,6);
  for(const [name,body] of original)assert.notEqual(result.get(name),body,"unchanged "+name);
  const m=result.get("src/local-store/internal/migrations.ts");
  assert.match(m,/keyPath: \["workspace_id", "event_id"\]/);
  assert.match(m,/keyPath: \["workspace_id", "relation_id"\]/);
  assert.equal([...m.matchAll(/\bversion:\s*8\s*,/g)].length,1);
  assert.equal([...m.matchAll(/\n\];\n\nexport function runMigrations\(/g)].length,1);
  assert.match(m,/const compound = \(key: string \| string\[\] \| null, id: string\): boolean/);
  assert.match(m,/oldEvents\.getAll\(\)/);
  assert.match(m,/oldRelations\.getAll\(\)/);
  assert.equal(result.get("src/local-store/types.ts"),"export const DB_VERSION = 8;");
  const tx=result.get("src/local-store/transactions.ts");
  assert.equal([...tx.matchAll(/\.get\(\[ev\.workspace_id, ev\.event_id\]\)/g)].length,2);
  assert.equal([...tx.matchAll(/\.get\(\[input\.workspace_id, input\.relation_id\]\)/g)].length,3);
  assert.match(tx,/\.delete\(\[input\.workspace_id, input\.relation_id\]\)/);
  assert.match(result.get("src/local-store/LocalStore.ts"),/\.readOne<RelationRecord>\(STORES\.relations, \[workspace_id, relation_id\]\)/);
  const g=result.get("src/local-store/atomic-graph.ts");
  assert.equal([...g.matchAll(/\.get\(\[input\.workspace_id, row\.relation_id\]\)/g)].length,2);
  assert.match(g,/\.delete\(\[input\.workspace_id, id\]\)/);
  const imp=result.get("src/package/import/commit.ts");
  assert.equal([...imp.matchAll(/\.get\(\[e\.workspace_id, e\.event_id\]\)/g)].length,2);
  assert.doesNotMatch(imp,/\.get\(e\.event_id\)/);
  assert.match(imp,/IMPORT_EVENT_ID_COLLISION/);
});
test("every matching operation is converted, without fragile fixed counts",()=>{
  for(const count of [1,2,3,4]){
    const result=patchSameStoreEventFiles(fixtures({
      t1Events:count,t1Relations:count,graphRelations:count}));
    const tx=result.get("src/local-store/transactions.ts");
    const graph=result.get("src/local-store/atomic-graph.ts");
    assert.equal([...tx.matchAll(/\.get\(\[ev\.workspace_id, ev\.event_id\]\)/g)].length,count);
    assert.equal([...tx.matchAll(/\.get\(\[input\.workspace_id, input\.relation_id\]\)/g)].length,count);
    assert.equal([...graph.matchAll(/\.get\(\[input\.workspace_id, row\.relation_id\]\)/g)].length,count);
    assert.doesNotMatch(tx,/\.get\(ev\.event_id\)|\.get\(input\.relation_id\)/);
    assert.doesNotMatch(graph,/\.get\(row\.relation_id\)/);
  }
  for(const variable of ["t1Events","t1Relations","graphRelations"]){
    assert.throws(()=>patchSameStoreEventFiles(fixtures({[variable]:0})),
      /K036_SAME_STORE_.*_MISSING/);
  }
  assert.throws(()=>patchSameStoreEventFiles(fixtures({dbVersion:8})),
    /DB_VERSION_ANCHORS_0/);
  const old=fixtures();
  old.set("src/local-store/internal/migrations.ts",
    old.get("src/local-store/internal/migrations.ts").replace("version: 7 }","version: 8, }"));
  assert.throws(()=>patchSameStoreEventFiles(old),
    /EVENT_STORE_UPGRADE_ALREADY_PRESENT/);
});
