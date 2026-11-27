// Transport an already verified release ZIP; never publish plaintext in CI.
import {createHash,createCipheriv,createDecipheriv,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,randomBytes,constants as cryptoConstants} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,linkSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const schema='IWXA_SEALED_RELEASE_ZIP/1';
const fail=code=>{throw Error('SEALED_RELEASE_'+code)};
const hex=(s,n)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s);
const sha=b=>createHash('sha256').update(b).digest('hex');
const checkIdentity=(site,run)=>{if(!hex(site,40)||typeof run!=='string'||!/^\d+$/.test(run))fail('IDENTITY')};
function file(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||!Number.isSafeInteger(s.size)||s.size<1)fail('FILE');return s.size}
function recipient(key){const pub=key.type==='public'?key:createPublicKey(key);if(pub.asymmetricKeyType!=='rsa'||pub.asymmetricKeyDetails.modulusLength<3072)fail('RECIPIENT');return sha(pub.export({format:'der',type:'spki'}))}
async function digest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')}
function meter(){const h=createHash('sha256');let bytes=0;const stream=new Transform({transform(chunk,_encoding,done){h.update(chunk);bytes+=chunk.length;done(null,chunk)}});return {stream,finish:()=>({bytes,sha256:h.digest('hex')})}}
function verifyMeasured(m,bytes,sha256){if(m.bytes!==bytes||m.sha256!==sha256)fail('ZIP_IDENTITY')}
function checkZip(path){if(!path.toLowerCase().endsWith('.zip'))fail('ZIP_NAME');return file(path)}
export async function seal({zip,out,site,run,publicKey}){
 checkIdentity(site,run);zip=resolve(zip);out=resolve(out);
 if(existsSync(out))fail('OUTPUT_EXISTS');
 const zipBytes=checkZip(zip),checksum=zip+'.sha256';
 if(file(checksum)>1024)fail('CHECKSUM');
 const zipSha256=await digest(zip);
 if(readFileSync(checksum,'utf8').trimEnd()!==zipSha256+'  '+basename(zip))fail('CHECKSUM');
 const key=createPublicKey({key:Buffer.from(publicKey,'base64'),type:'spki',format:'der'});
 const metadata={schema,site,run,recipient:recipient(key),zipBytes,zipSha256};
 const secret=randomBytes(32),nonce=randomBytes(12);let made=false;
 try{
  const cipher=createCipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const wrappedKey=publicEncrypt({key,padding:cryptoConstants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},secret);
  mkdirSync(out,{mode:0o700});made=true;
  const measured=meter(),payload=join(out,'payload.bin');
  await pipeline(createReadStream(zip),measured.stream,cipher,createWriteStream(payload,{flags:'wx',mode:0o600}));
  verifyMeasured(measured.finish(),zipBytes,zipSha256);if(file(payload)!==zipBytes)fail('PAYLOAD_SIZE');
  writeFileSync(join(out,'header.json'),JSON.stringify({metadata,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:wrappedKey.toString('base64')},null,2)+'\n',{flag:'wx',mode:0o600});
  return metadata;
 }catch(e){if(made)rmSync(out,{recursive:true,force:true});throw e}finally{secret.fill(0)}
}
export async function open({input,out,site,run,privateKey}){
 checkIdentity(site,run);input=resolve(input);out=resolve(out);
 if(!out.toLowerCase().endsWith('.zip')||existsSync(out)||existsSync(out+'.sha256'))fail('OUTPUT_EXISTS_OR_NAME');
 if(readdirSync(input).sort().join(',')!=='header.json,payload.bin')fail('ENVELOPE_SCOPE');
 const header=join(input,'header.json'),payload=join(input,'payload.bin');if(file(header)>8192)fail('HEADER_SIZE');
 const h=JSON.parse(readFileSync(header,'utf8')),m=h.metadata;
 const key=createPrivateKey(readFileSync(privateKey));
 if(!m||m.schema!==schema||m.site!==site||m.run!==run||m.recipient!==recipient(key)||!hex(m.zipSha256,64)||!Number.isSafeInteger(m.zipBytes)||m.zipBytes!==file(payload))fail('HEADER_IDENTITY');
 const nonce=Buffer.from(h.nonce,'base64'),tag=Buffer.from(h.tag,'base64');if(nonce.length!==12||tag.length!==16)fail('AUTH_FIELDS');
 const secret=privateDecrypt({key,padding:cryptoConstants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(h.wrappedKey,'base64'));
 let stage,published=false;
 try{
  if(secret.length!==32)fail('KEY_SIZE');
  stage=mkdtempSync(join(dirname(out),'.sealed-release-'));
  const zip=join(stage,'release.zip'),checksum=zip+'.sha256';
  const cipher=createDecipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from(JSON.stringify(m)));cipher.setAuthTag(tag);
  const measured=meter();await pipeline(createReadStream(payload),cipher,measured.stream,createWriteStream(zip,{flags:'wx',mode:0o600}));
  verifyMeasured(measured.finish(),m.zipBytes,m.zipSha256);
  writeFileSync(checksum,m.zipSha256+'  '+basename(out)+'\n',{flag:'wx',mode:0o600});
  linkSync(zip,out);published=true;linkSync(checksum,out+'.sha256');
  return m;
 }catch(e){if(published)rmSync(out,{force:true});throw e}finally{secret.fill(0);if(stage)rmSync(stage,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,first,out,site,run,key,...extra]=process.argv.slice(2);
 try{
  if(extra.length||![first,out,site,run,key].every(Boolean))fail('USAGE');
  const result=mode==='seal'?await seal({zip:first,out,site,run,publicKey:key}):mode==='open'?await open({input:first,out,site,run,privateKey:key}):fail('USAGE');
  console.log('SEALED_RELEASE_'+mode.toUpperCase()+'=PASS '+JSON.stringify(result));
 }catch(e){console.error(/^SEALED_RELEASE_[A-Z_]+$/.test(e.message)?e.message:'SEALED_RELEASE_FAILED');process.exitCode=1}
}
