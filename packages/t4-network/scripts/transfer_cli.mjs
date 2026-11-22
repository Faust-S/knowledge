#!/usr/bin/env node
/** Explicit single-file research CLI. Does not grant original IWXA product rights. */
import {readFile,open,link,unlink,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWebDavPackageTransport,packageSha256} from '../src/network/webdav-package-transfer.mjs';
let transport;
try {
 const [command,configPath,input,hash]=process.argv.slice(2);
 if(!['put','get','inspect'].includes(command)||!configPath||!input) throw Error('Usage: transfer_cli.mjs put config.json package.iwxa | get config.json new-output.iwxa SHA256 | inspect config.json SHA256');
 const config=JSON.parse(await readFile(resolve(configPath),'utf8'));
 if(config.networkConsent!==true||config.referenceOnlyAcknowledged!==true) throw Error('Explicit network consent and reference-only acknowledgement required');
 const required=command==='put'?['t4.package.publish','t4.package.read']:['t4.package.read'];
 if(!Array.isArray(config.allowedOperations)||!required.every(op=>config.allowedOperations.includes(op))) throw Error('Operation not permitted in local reference configuration');
 const authorization=process.env.T4_AUTHORIZATION;
 if(!authorization) throw Error('Set T4_AUTHORIZATION in this process environment; do not put credentials in argv or config');
 transport=createWebDavPackageTransport({baseUrl:config.baseUrl,locationRef:config.locationRef,placementPolicy:config.placementPolicy,
  getMode:()=> 'T4_NETWORK',authorize:async(ctx)=>required.includes(ctx.operation),getAuthorizationHeader:async()=>authorization,maxBytes:config.maxBytes??16777216});
 if(command==='put') {
  if(!input.endsWith('.iwxa')) throw Error('An owner-exported .iwxa file is required');
  const info=await stat(input);if(!info.isFile()||info.size>(config.maxBytes??16777216)) throw Error('Input is not a bounded ordinary file');
  const bytes=await readFile(input),sha256=packageSha256(bytes);
  console.log(JSON.stringify(await transport.putSnapshot({key:sha256+'.iwxa',bytes,expectedSha256:sha256,createOnly:true}),null,2));
 } else if(command==='inspect') {
  console.log(JSON.stringify(await transport.inspectOutcome({key:input+'.iwxa',expectedSha256:input}),null,2));
 } else {
  if(!input.endsWith('.iwxa'))throw Error('Output must have .iwxa extension');
  const result=await transport.getSnapshot({key:hash+'.iwxa',expectedSha256:hash});
  const target=resolve(input),temporary=join(dirname(target),'.t4-download-'+randomUUID()+'.part');
  let handle;
  try {handle=await open(temporary,'wx',0o600);await handle.writeFile(result.bytes);await handle.sync();await handle.close();handle=null;
   // Atomic exclusive final name on supported local filesystems. Never overwrite.
   await link(temporary,target);console.log(JSON.stringify(result.receipt,null,2));
  } finally {if(handle)await handle.close();await unlink(temporary).catch(()=>{});}
 }
} catch(error) {console.error(JSON.stringify({code:error.code??'CLI_ERROR',message:error.code??error.message,automaticRetryAllowed:false}));process.exitCode=1;}
finally {transport?.close();}
