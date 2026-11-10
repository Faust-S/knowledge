import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {CONTRACT_VERSION,ALL_OPERATIONS} from "../packages/t3-core/src/kernel-client/contracts/runtime-1.3.0/index.ts";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../packages/t3-core");
test("actual inherited T2 Runtime Contract 1.3.0 is executable in the T3 source tree",()=>{
  assert.equal(CONTRACT_VERSION,"1.3.0");
  assert.ok(ALL_OPERATIONS.includes("t1.commitObjectGraph"));
  assert.ok(ALL_OPERATIONS.includes("t1.putRelation"));
  assert.ok(ALL_OPERATIONS.includes("t2.exportPackage"));
  assert.ok(ALL_OPERATIONS.includes("t2.importCommit"));
  assert.equal(new Set(ALL_OPERATIONS).size,ALL_OPERATIONS.length);
  assert.equal(ALL_OPERATIONS.length,27);
});
test("inherited T2 package and source schemas are present under the single T3 successor path",()=>{
  const pkg=JSON.parse(readFileSync(resolve(ROOT,"package.json"),"utf8"));
  assert.equal(pkg.name,"@iwxa/t3-core");
  const base=resolve(ROOT,"src/kernel-client/contracts/runtime-1.3.0/schemas");
  for(const name of ["object.schema.json","relation.schema.json","iwxa-event.schema.json",
    "workspace.schema.json","service-passport.schema.json","package-manifest.schema.json",
    "import-export.schema.json"]){
    const path=resolve(base,name);
    assert.ok(existsSync(path),name+" absent");
    const schema=JSON.parse(readFileSync(path,"utf8"));
    assert.ok(schema && typeof schema==="object",name+" invalid");
  }
});
