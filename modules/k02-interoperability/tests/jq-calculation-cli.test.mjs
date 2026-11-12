import test from 'node:test';
import assert from 'node:assert/strict';
import {JqCalculationCliProvider,CALCULATION_INPUT,CALCULATION_OUTPUT} from '../adapters/jq-calculation-cli.mjs';
import {CONTRACT_VERSION,resolveRequirements,buildInvocationPlan,verifyInvocationReadiness,
  validateInvocationInput,validateInvocationOutput} from '../index.mjs';

const orders={orders:[
  {documentId:'INV-1042',quantity:12,unitPriceCents:12500,discountBps:1000,shippingCents:6000},
  {documentId:'INV-1043',quantity:7,unitPriceCents:4500,discountBps:0,shippingCents:2000},
]};
const req={solutionId:'jq-deterministic-calculation',requirements:[{
  requirementId:'calculate',kind:'tool',capabilityId:'invoice.calculate',
  inputSchema:CALCULATION_INPUT,outputSchema:CALCULATION_OUTPUT,
  effectClass:'PURE_COMPUTE',required:true,
}]};
test('real installed jq executes exact invoice calculation through existing capability',async t=>{
  const provider=new JqCalculationCliProvider();
  const descriptor=await provider.describeCapabilities();
  assert.equal(descriptor.contractVersion,CONTRACT_VERSION);
  if(descriptor.availability==='unavailable') {t.diagnostic('JQ_CLI_NOT_INSTALLED; REAL_EXECUTION_NOT_RUN');return;}
  const resolved=resolveRequirements(req,[descriptor]);
  assert.equal(resolved.status,'SUPPORTED');
  const plan=buildInvocationPlan({taskId:'open-cli-verification',solutionId:req.solutionId},[],resolved);
  await verifyInvocationReadiness(plan,'calculate',provider,plan.planDigest);
  validateInvocationInput(plan.steps[0],orders);
  await assert.rejects(provider.invoke('invoice.calculate',orders),/HOST_APPROVAL_REQUIRED/);
  const result=await provider.invoke('invoice.calculate',orders,{hostApproved:true});
  validateInvocationOutput(plan.steps[0],result.output);
  assert.equal(result.observation.proofClass,'REAL_JQ_PROCESS_NOT_PRODUCT_TASK');
  assert.equal(result.output.grandTotalCents,174500);
  assert.deepEqual(result.output.lines.map(x=>x.totalCents),[141000,33500]);
  assert.equal(result.output.lines[0].discountCents,15000);
  assert.ok(result.observation.durationMs>0);
  assert.equal(plan.steps[0].proofOfInvoke,null);
});
test('invalid invoice schema and duplicate IDs are refused before invoking jq',async()=>{
  const provider=new JqCalculationCliProvider();
  await assert.rejects(provider.invoke('invoice.calculate',{orders:[]},{hostApproved:true}),/SCHEMA_VALUE_INVALID/);
  await assert.rejects(provider.invoke('invoice.calculate',
    {orders:[orders.orders[0],orders.orders[0]]},{hostApproved:true}),/SCHEMA_VALUE_INVALID/);
  await assert.rejects(provider.invoke('invoice.calculate',orders,{hostApproved:false}),/HOST_APPROVAL_REQUIRED/);
  await assert.rejects(provider.invoke('shell.exec',orders,{hostApproved:true}),/UNSUPPORTED/);
});
test('missing executable never turns into a simulated successful provider',async()=>{
  const provider=new JqCalculationCliProvider({executable:'nonexistent-jq-binary-k02-456x'});
  const descriptor=await provider.describeCapabilities();
  assert.equal(descriptor.availability,'unavailable');
  assert.equal(resolveRequirements(req,[descriptor]).status,'UNSUPPORTED');
  await assert.rejects(provider.invoke('invoice.calculate',orders,{hostApproved:true}),/PROVIDER_UNAVAILABLE/);
});
