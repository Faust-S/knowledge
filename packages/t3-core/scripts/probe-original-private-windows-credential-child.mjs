// Public diagnostic child. Loads the original Windows DPAPI owner in a
// process with the same bounded OS environment as native Agent qualification.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [sourceRoot,workRoot]=process.argv.slice(2);
let phase='MODULE_IMPORT';
try{
  const original=await import(pathToFileURL(join(sourceRoot,
    'access-control','windows-credential.mjs')).href);
  phase='WINDOWS_IDENTITY';
  const identity=original.windowsIdentity();
  assert.ok(identity.sid&&identity.deviceId);
  phase='WINDOWS_DPAPI_PROTECT';
  const text=Buffer.from('original-native-dpapi-fixture');
  const entropy=Buffer.from('current-user-dpapi-fixture');
  const cipher=original.dpapiProtect(text,entropy);
  assert.ok(cipher.length>0);
  phase='WINDOWS_DPAPI_UNPROTECT';
  assert.deepEqual(original.dpapiUnprotect(cipher,entropy),text);
  phase='WINDOWS_VAULT_SECRET';
  mkdirSync(workRoot,{recursive:true});
  const first=original.windowsVaultSecret(workRoot,{create:true});
  const second=original.windowsVaultSecret(workRoot,{create:false});
  assert.equal(second,first);
  console.log('G4_ORIGINAL_PROVIDER_CHILD_FULL_ROUNDTRIP_PASS');
}catch(error){
  console.log('G4_ORIGINAL_PROVIDER_CHILD_FAILURE_PHASE',phase);
  console.log('G4_ORIGINAL_PROVIDER_CHILD_FAILURE_CODE',
    /^[A-Z][A-Z0-9_]{3,119}$/.test(error?.message??'')?
      error.message:'UNCLASSIFIED');
  process.exitCode=1;
}
