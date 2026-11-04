import { GitHubPublicRestProvider } from '../adapters/github-public-rest.mjs';
import { describeCapabilities, resolveRequirements, buildInvocationPlan, validateInvocationOutput } from '../index.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';

async function main() {
  const [revision, path] = process.argv.slice(2);
  const provider = new GitHubPublicRestProvider({ owner: 'Faust-S', repo: 'knowledge' });
  const descriptor = await describeCapabilities(provider);
  const solution = { solutionId: 'external-source-consumer', requirements: [{
    requirementId: 'source', kind: 'tool', capabilityId: 'source.git.show',
    inputSchema: GIT_INPUT, outputSchema: GIT_OUTPUT, effectClass: 'HOST_AUTHORIZED_READ', required: true
  }] };
  const resolution = resolveRequirements(solution, [descriptor]);
  if (resolution.status !== 'SUPPORTED') throw new Error('unavailable:' + JSON.stringify(resolution.missing));
  const plan = buildInvocationPlan({ taskId: 'PUBLIC-SOURCE-READ', solutionId: solution.solutionId }, [], resolution);
  const result = await provider.invoke('source.git.show', { revision, path }, { hostApproved: true });
  validateInvocationOutput(plan.steps[0], result.output);
  process.stdout.write(JSON.stringify({
    contractVersion: plan.contractVersion, planDigest: plan.planDigest,
    providerId: descriptor.providerId, status: result.status,
    output: result.output, observation: result.observation
  }));
}
main().catch(e => {
  process.stderr.write(JSON.stringify({ errorCode: e.code ?? 'CONSUMER_FAILED' }) + '\n');
  process.exitCode = 1;
});
