import { readFile } from 'node:fs/promises';
import { GitCliProvider, GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';
import { NodeEvidenceCliProvider, AUDIT_INPUT, AUDIT_OUTPUT } from '../adapters/node-evidence-cli.mjs';
import {
  CONTRACT_VERSION, describeCapabilities, resolveRequirements, buildInvocationPlan,
  verifyInvocationReadiness, verifySkillBinding,
} from '../index.mjs';

const source = new GitCliProvider(process.cwd());
const evidence = new NodeEvidenceCliProvider();
const [sourceDescriptor, evidenceDescriptor] = await Promise.all([
  describeCapabilities(source), describeCapabilities(evidence),
]);
const descriptors = [sourceDescriptor, evidenceDescriptor];
const solution = {
  solutionId: 'K02-CROSS-LANGUAGE-CONFORMANCE',
  requirements: [
    { requirementId: 'source', kind: 'tool', capabilityId: 'source.git.show', inputSchema: GIT_INPUT,
      outputSchema: GIT_OUTPUT, effectClass: 'HOST_AUTHORIZED_READ', required: true },
    { requirementId: 'audit', kind: 'tool', capabilityId: 'evidence.exact.audit', inputSchema: AUDIT_INPUT,
      outputSchema: AUDIT_OUTPUT, effectClass: 'PURE_COMPUTE', required: true },
  ],
};
const resolution = resolveRequirements(solution, descriptors);
if (resolution.status !== 'SUPPORTED') throw new Error('K02_CONFORMANCE_PROVIDERS_UNAVAILABLE');
const skill = JSON.parse(await readFile(new URL('../skills/exact-source-audit.skill.json', import.meta.url), 'utf8'));
const instructionBytes = await readFile(new URL('../skills/exact-source-audit.instructions.json', import.meta.url));
const plan = buildInvocationPlan({
  taskId: 'K02-CONFORMANCE-NOT-A-PRODUCT-TASK', solutionId: solution.solutionId,
}, [skill], resolution);
verifySkillBinding(plan, skill.skillId, skill, instructionBytes, plan.planDigest);
await verifyInvocationReadiness(plan, 'source', source, plan.planDigest);
await verifyInvocationReadiness(plan, 'audit', evidence, plan.planDigest);
process.stdout.write(JSON.stringify({
  schema: 'IWXA.K02.CROSS_LANGUAGE_VECTOR/0.1.0',
  plan, descriptors, skill,
}) + '\n');
