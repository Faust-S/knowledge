// Gate for one deliberate D06 release-continuation push. No private access here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const workflow = "d06-t3-release-gate";
const path = `.github/ci-requests/${workflow}.json`;
const site = "8ee1f93603c95738333bc1489d68816ead870893";
const owner = "8471dca0037328dfee8689632df9c27866e89845";
const retention = "be7e994af3aba9837d6ee2c3ce17373e47dd1cdc";
const sha = /^[a-f0-9]{40}$/;
function verify(event, env, git, read) {
  assert.equal(env.GITHUB_REPOSITORY, "Faust-S/knowledge");
  const head = env.GITHUB_SHA;
  assert.match(head, sha);
  assert.equal(git("rev-parse", "HEAD").trim(), head);
  const frozen = JSON.parse(read(".github/d06/t3-release-request.json"));
  assert.deepEqual(frozen, {schema:"IWXA_D06_T3_QUALIFICATION/1",owner,site,attempt:10});
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    assert.equal(env.GITHUB_REF, "refs/heads/test/2026-11-24-d06-t3-preparation");
    return;
  }
  assert.equal(env.GITHUB_EVENT_NAME, "push");
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  assert.equal(event.created, false);
  assert.equal(event.deleted, false);
  assert.equal(event.forced, false);
  assert.equal(event.after, head);
  assert.equal(event.head_commit?.id, head);
  const prepared = event.before;
  assert.match(prepared, sha);
  assert.notEqual(prepared, head);
  assert.equal(event.ref, env.GITHUB_REF);
  assert.equal(event.ref, `refs/heads/ci/once/${workflow}/${prepared}`);
  assert.deepEqual(git("rev-list", "--parents", "-n", "1", head).trim().split(/\s+/), [head,prepared]);
  assert.deepEqual(git("diff", "--name-status", "-z", "--no-renames", prepared, head).split("\0").filter(Boolean), ["A",path]);
  const request = JSON.parse(read(path));
  assert.deepEqual(request, {schema:"IWXA_CI_ONCE/1",workflow,prepared,owner,site,retention,profile:"production-build-then-retention",priorRun:45685687719,reason:"Qualify final production build independently of private write authorization"});
}
try {
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
  const git=(...args)=>execFileSync("git",args,{encoding:"utf8",maxBuffer:16*1024*1024});
  verify(event,process.env,git,path=>readFileSync(path,"utf8"));
  console.log("D06_ONE_SHOT_REQUEST=PASS");
} catch {
  console.error("D06_ONE_SHOT_REQUEST=FAIL");
  process.exitCode=1;
}
