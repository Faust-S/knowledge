// Independent verifier of the signed PRODUCTION employee PROOF produced by
// installed Agent -> ORIGINAL T3 Node owner under a different Windows SID.
// Read-only: no issuer vault, enrollment grant, Store or Kernel mutation.
import {readFileSync} from 'node:fs';
import {createPublicKey,verify} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const fail=code=>{throw Error(code);};
const [owner,proofPath]=process.argv.slice(2);
try {
  if(process.platform!=='win32'||!isAbsolute(owner??'')||
     !isAbsolute(proofPath??''))fail('G4_INSTALLED_EMPLOYEE_PROOF_PATH_INVALID');
  const {canonical,digest}=await import(pathToFileURL(
    join(owner,'access-control','core.mjs')).href);
  if(typeof canonical!=='function'||typeof digest!=='function')
    fail('G4_INSTALLED_EMPLOYEE_ORIGINAL_VERIFY_CONTRACT_MISSING');
  const receipt=JSON.parse(readFileSync(proofPath,'utf8'));
  const proof=receipt.proof;
  if(receipt.schema!=='IWXA_G4_INSTALLED_EMPLOYEE_PUBLIC_PROOF/1'||
     typeof receipt.publicKey!=='string'||typeof receipt.credentialKeyId!=='string'||
     proof?.schema!=='IWXA_T3_ACCESS_SIGNED/1'||
     proof?.keyId!==receipt.credentialKeyId||
     proof?.payload?.kind!=='PROOF'||
     proof?.payload?.environment!=='PRODUCTION'||
     proof?.payload?.challenge!==receipt.challenge||
     proof?.payload?.requestDigest!==digest(receipt.request)||
     receipt.request.actorId!==receipt.employeePersonId||
     !/^[A-Za-z0-9_-]{64,128}$/.test(proof.signature??''))
    fail('G4_INSTALLED_EMPLOYEE_PROOF_BINDING_INVALID');
  const message=Buffer.from('IWXA-T3-ACCESS-SIGNED-V1\0'+canonical({
    schema:proof.schema,keyId:proof.keyId,payload:proof.payload
  }));
  if(!verify(null,message,createPublicKey(receipt.publicKey),
     Buffer.from(proof.signature,'base64url')))
    fail('G4_INSTALLED_EMPLOYEE_ORIGINAL_PROOF_SIGNATURE_INVALID');
  console.log('G4_INSTALLED_EMPLOYEE_ORIGINAL_SIGNED_PROOF_VERIFIED_PASS');
}catch(e){
  const code=typeof e?.message==='string'&&
    /^G4_[A-Z0-9_]{3,110}$/.test(e.message)?e.message:
    'G4_INSTALLED_EMPLOYEE_SIGNATURE_VERIFICATION_FAILED';
  console.error(code);process.exitCode=1;
}