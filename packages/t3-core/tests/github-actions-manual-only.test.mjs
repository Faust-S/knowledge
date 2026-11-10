import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../../../../../',import.meta.url);
const policy=JSON.parse(readFileSync(new URL('t2/current/final-successor/product/T2_GITHUB_ACTIONS_EXECUTION_POLICY_2026-09-22.json',root),'utf8'));
const workflowsRoot=new URL('.github/workflows/',root);

test('every T2 GitHub Actions workflow is manual-only',()=>{
 assert.equal(policy.status,'REPOSITORY_WIDE_MANUAL_ONLY');
 assert.equal(policy.rules.automaticPushRunsAllowed,false);
 assert.equal(policy.rules.automaticPullRequestRunsAllowed,false);
 assert.equal(policy.rules.scheduledRunsAllowed,false);
 assert.equal(policy.rules.workflowDispatchAllowed,true);
 assert.equal(policy.rules.githubActionsRequiredForCurrentDevelopment,false);
 assert.equal(policy.rules.allRepositoryWorkflowsManualOnly,true);

 const workflowNames=readdirSync(workflowsRoot)
  .filter((name)=>/\.ya?ml$/i.test(name))
  .sort();
 assert.ok(workflowNames.length>0);

 for(const name of workflowNames){
  const text=readFileSync(new URL(name,workflowsRoot),'utf8');
  assert.match(text,/^on:\s*\n\s+workflow_dispatch:/m,name+' workflow_dispatch');
  assert.doesNotMatch(text,/^\s+push:\s*$/m,name+' push trigger');
  assert.doesNotMatch(text,/^\s+pull_request:\s*$/m,name+' pull_request trigger');
  assert.doesNotMatch(text,/^\s+schedule:\s*$/m,name+' schedule trigger');
 }
});
