// Real, bounded, read-only jq calculation provider for an open K02 study.
// No ToolRuntime, Task, filesystem writes or host grants are implemented here.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, InteropError, validatePayload } from '../index.mjs';

const execute=promisify(execFile);
const field=(type,extra={})=>({type,...extra});
const lineSchema={
  type:'object',additionalProperties:false,
  required:['documentId','quantity','unitPriceCents','discountBps','shippingCents'],
  properties:{
    documentId:field('string',{minLength:1,maxLength:48}),
    quantity:field('integer',{minimum:1,maximum:10000}),
    unitPriceCents:field('integer',{minimum:0,maximum:1000000}),
    discountBps:field('integer',{minimum:0,maximum:10000}),
    shippingCents:field('integer',{minimum:0,maximum:1000000}),
  },
};
export const CALCULATION_INPUT={type:'object',additionalProperties:false,
  required:['orders'],properties:{orders:{type:'array',items:lineSchema,minItems:1,maxItems:16}}};
export const CALCULATION_OUTPUT={type:'object',additionalProperties:false,
  required:['lines','grandTotalCents'],
  properties:{
    lines:{type:'array',items:{
      type:'object',additionalProperties:false,required:['documentId','subtotalCents','discountCents','totalCents'],
      properties:{
        documentId:field('string',{minLength:1,maxLength:48}),
        subtotalCents:field('integer',{minimum:0}),
        discountCents:field('integer',{minimum:0}),
        totalCents:field('integer',{minimum:0}),
      },
    },minItems:1,maxItems:16},
    grandTotalCents:field('integer',{minimum:0}),
  }};
const capability={kind:'tool',capabilityId:'invoice.calculate',
  supported:true,inputSchema:CALCULATION_INPUT,outputSchema:CALCULATION_OUTPUT,
  effectClass:'PURE_COMPUTE',providerFeeUsd:0,latencyMsP50:null};
const FILTER="$orders | map((.quantity * .unitPriceCents) as $subtotal | (($subtotal * .discountBps / 10000 + 0.5) | floor) as $discount | {documentId, subtotalCents: $subtotal, discountCents: $discount, totalCents: ($subtotal - $discount + .shippingCents)}) as $lines | {lines: $lines, grandTotalCents: ($lines | map(.totalCents) | add)}";
export class JqCalculationCliProvider{
  constructor({executable='jq'}={}){this.executable=executable;this.providerId='jq-calculation-cli';}
  async describeCapabilities(){
    let available=false;
    try{const r=await execute(this.executable,['--version'],{timeout:3000,maxBuffer:1024});
      available=r.stdout.trim().startsWith('jq-');}
    catch{}
    return {contractVersion:CONTRACT_VERSION,providerId:this.providerId,
      availability:available?'available':'unavailable',
      ...(!available?{unavailableReason:'JQ_CLI_NOT_INSTALLED'}:{}),
      capabilities:[capability]};
  }
  async invoke(operation,input,authorization){
    if(operation!=='invoice.calculate')throw new InteropError('UNSUPPORTED','operation');
    if(authorization?.hostApproved!==true)throw new InteropError('HOST_APPROVAL_REQUIRED');
    validatePayload(CALCULATION_INPUT,input);
    if(new Set(input.orders.map(o=>o.documentId)).size!==input.orders.length)
      throw new InteropError('SCHEMA_VALUE_INVALID','duplicate_document');
    const started=performance.now();
    let raw;
    try{raw=(await execute(this.executable,['-nc','--argjson','orders',JSON.stringify(input.orders),FILTER],
      {timeout:8000,maxBuffer:64*1024,encoding:'utf8'})).stdout;}
    catch{throw new InteropError('PROVIDER_UNAVAILABLE','JQ_CALCULATION_FAILED');}
    let output;
    try{output=JSON.parse(raw);validatePayload(CALCULATION_OUTPUT,output);}
    catch{throw new InteropError('INVALID_PROVIDER_OUTPUT','CALCULATION_RESULT');}
    const inputIds=input.orders.map(o=>o.documentId);
    if(output.lines.length!==inputIds.length||
      output.lines.some((x,i)=>x.documentId!==inputIds[i])||
      output.lines.reduce((s,x)=>s+x.totalCents,0)!==output.grandTotalCents)
      throw new InteropError('INVALID_PROVIDER_OUTPUT','CALCULATION_CROSSCHECK');
    return {status:'SUCCEEDED',output,
      observation:{providerId:this.providerId,transport:'jq-cli',capabilityId:operation,
        durationMs:Number(Math.max(0.001,performance.now()-started).toFixed(3)),
        outputSha256:createHash('sha256').update(raw,'utf8').digest('hex'),
        actualProviderFeeUsd:0,hostComputeCostUsd:null,
        proofClass:'REAL_JQ_PROCESS_NOT_PRODUCT_TASK'}};
  }
}
