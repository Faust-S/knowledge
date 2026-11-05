// Optional genuine model invocation using the pre-existing K02 Ollama adapter.
// Works only when K02 and K04 are available together and a local pinned model is installed.
import {readFile} from 'node:fs/promises';
import {runK02ModelBranch} from './k02-model-host.mjs';
import {OllamaLocalModelProvider} from '../../k02-interoperability/adapters/ollama-local.mjs';
const digest=process.env.K04_MODEL_DIGEST;
const name=process.env.K04_MODEL_NAME;
if (!name || !/^[a-f0-9]{64}$/.test(digest ?? ''))
  throw Error('K04_MODEL_NAME_AND_DIGEST_REQUIRED');
const provider=new OllamaLocalModelProvider({modelName:name,expectedDigest:digest});
const transcript=await readFile(new URL('meeting.txt',import.meta.url),'utf8');
const result=await runK02ModelBranch({
  provider,transcript,hostApproved:true,
  hostAuthorization:{hostApproved:true,pinnedModelDigest:digest},
  source:{ref:'modules/k04-composer/sample/meeting.txt',revision:'fixture-v1',
    authorized:true,rights:'IWXA_AUTHORED_SYNTHETIC'}
});
process.stdout.write(JSON.stringify({
  source:'original_open_sample',status:result.evaluation.status,
  passed:result.evaluation.passed,checks:result.evaluation.errors,
  actualProviderProof:result.providerProofClass,modelName:name,
  receiptDigests:result.receipts.map(x=>({step:x.stepId,digest:x.outputDigest})),
  humanReview:'PENDING',actualWork:'NOT_EXECUTED'
})+'\n');
if (!result.evaluation.passed ||
    result.providerProofClass!=='REAL_LOCAL_MODEL_INFERENCE_NOT_PRODUCT_TASK')
  process.exitCode=1;
