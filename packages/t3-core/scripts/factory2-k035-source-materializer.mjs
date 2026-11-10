#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';

export class Factory2K035MaterializerError extends Error {
  constructor(message,code='FACTORY2_K035_MATERIALIZER_ERROR'){super(message);this.name='Factory2K035MaterializerError';this.code=code;}
}
const sha256=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function gitBlobSha1(bytes){
  const h=createHash('sha1');
  h.update(Buffer.from(`blob ${bytes.length}\0`,'utf8'));
  h.update(bytes);
  return h.digest('hex');
}
function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Factory2K035MaterializerError('source authority record required','FACTORY2_K035_AUTHORITY_INVALID');
  return value;
}
function safeJoin(root,rel){
  const normalized=String(rel).replaceAll('\\','/');
  if(normalized.startsWith('/')||normalized.split('/').includes('..')) throw new Factory2K035MaterializerError(`unsafe source path: ${rel}`,'FACTORY2_K035_SOURCE_PATH_INVALID');
  const path=resolve(root,...normalized.split('/'));
  const prefix=resolve(root);
  if(path!==prefix&&!path.startsWith(prefix+requireSeparator())) throw new Factory2K035MaterializerError(`source path escapes root: ${rel}`,'FACTORY2_K035_SOURCE_PATH_INVALID');
  return path;
}
function requireSeparator(){ return process.platform==='win32'?'\\':'/'; }

function findEocd(zip){
  const signature=0x06054b50;
  const min=Math.max(0,zip.length-65557);
  for(let i=zip.length-22;i>=min;i--){
    if(zip.readUInt32LE(i)===signature) return i;
  }
  throw new Factory2K035MaterializerError('ZIP EOCD not found','FACTORY2_K035_ZIP_EOCD_MISSING');
}
export function extractZipMemberBySuffix(zip,suffix){
  const eocd=findEocd(zip);
  const entries=zip.readUInt16LE(eocd+10);
  const centralOffset=zip.readUInt32LE(eocd+16);
  let offset=centralOffset;
  const matches=[];
  for(let index=0;index<entries;index++){
    if(zip.readUInt32LE(offset)!==0x02014b50) throw new Factory2K035MaterializerError('invalid central directory entry','FACTORY2_K035_ZIP_CENTRAL_INVALID');
    const flags=zip.readUInt16LE(offset+8);
    const method=zip.readUInt16LE(offset+10);
    const compressedSize=zip.readUInt32LE(offset+20);
    const uncompressedSize=zip.readUInt32LE(offset+24);
    const nameLength=zip.readUInt16LE(offset+28);
    const extraLength=zip.readUInt16LE(offset+30);
    const commentLength=zip.readUInt16LE(offset+32);
    const localOffset=zip.readUInt32LE(offset+42);
    const name=zip.subarray(offset+46,offset+46+nameLength).toString((flags&0x0800)?'utf8':'utf8');
    if(name.endsWith(suffix)) matches.push({name,method,compressedSize,uncompressedSize,localOffset});
    offset+=46+nameLength+extraLength+commentLength;
  }
  if(matches.length!==1) throw new Factory2K035MaterializerError(`ZIP member suffix ambiguous: ${suffix}: ${matches.length}`,'FACTORY2_K035_ZIP_MEMBER_AMBIGUOUS');
  const m=matches[0];
  if(zip.readUInt32LE(m.localOffset)!==0x04034b50) throw new Factory2K035MaterializerError('invalid local ZIP header','FACTORY2_K035_ZIP_LOCAL_INVALID');
  const localNameLength=zip.readUInt16LE(m.localOffset+26);
  const localExtraLength=zip.readUInt16LE(m.localOffset+28);
  const dataOffset=m.localOffset+30+localNameLength+localExtraLength;
  const compressed=zip.subarray(dataOffset,dataOffset+m.compressedSize);
  let bytes;
  if(m.method===0) bytes=Buffer.from(compressed);
  else if(m.method===8) bytes=inflateRawSync(compressed);
  else throw new Factory2K035MaterializerError(`unsupported ZIP method: ${m.method}`,'FACTORY2_K035_ZIP_METHOD_UNSUPPORTED');
  if(bytes.length!==m.uncompressedSize) throw new Factory2K035MaterializerError('ZIP member size mismatch','FACTORY2_K035_ZIP_MEMBER_SIZE_MISMATCH');
  return Object.freeze({name:m.name,bytes});
}

export function materializeFactory2K035Products({authorityPath,repositoryRoot,outputRoot,writeEnvelope=false}){
  const authority=record(JSON.parse(readFileSync(resolve(authorityPath),'utf8')));
  if(authority.schema!=='IWXA_T2_K035_RC20_CURRENT_SOURCE_AUTHORITY_V1'||authority.status!=='CURRENT_CANONICAL_SOURCE_INPUT_AUTHORITY'||
     authority.kernelTarget!=='0.3.5'||authority.historicalRecoveryRequired!==false||
     authority.bytePolicy!=='EXACT_GIT_BLOB_ALIAS_NO_REPACK_NO_BYTE_CHANGE'){
    throw new Factory2K035MaterializerError('current K035 source authority invalid','FACTORY2_K035_AUTHORITY_INVALID');
  }
  const chunks=authority.envelope?.chunks;
  if(!Array.isArray(chunks)||chunks.length!==4||chunks.some((row,index)=>row.ordinal!==index+1)){
    throw new Factory2K035MaterializerError('exact four current K035 chunks required','FACTORY2_K035_CHUNK_SET_INVALID');
  }
  const buffers=[];
  const chunkReceipts=[];
  for(const row of chunks){
    const path=safeJoin(repositoryRoot,row.path);
    if(!existsSync(path)) throw new Factory2K035MaterializerError(`source chunk missing: ${row.path}`,'FACTORY2_K035_CHUNK_MISSING');
    const bytes=readFileSync(path);
    if(bytes.length!==row.sizeBytes||gitBlobSha1(bytes)!==row.gitBlobSha1){
      throw new Factory2K035MaterializerError(`source chunk identity mismatch: ${row.path}`,'FACTORY2_K035_CHUNK_IDENTITY_MISMATCH');
    }
    buffers.push(bytes);
    chunkReceipts.push(Object.freeze({ordinal:row.ordinal,path:row.path,sizeBytes:bytes.length,gitBlobSha1:row.gitBlobSha1}));
  }
  const envelope=Buffer.concat(buffers);
  const envelopeSha256=sha256(envelope);
  if(envelopeSha256!==authority.envelope.sha256) throw new Factory2K035MaterializerError(`envelope SHA-256 mismatch: ${envelopeSha256}`,'FACTORY2_K035_ENVELOPE_IDENTITY_MISMATCH');

  const out=resolve(outputRoot);
  mkdirSync(out,{recursive:true});
  if(writeEnvelope) writeFileSync(resolve(out,authority.envelope.artifact),envelope);

  const components={};
  for(const key of ['kernel','workspace']){
    const spec=authority.components?.[key];
    const extracted=extractZipMemberBySuffix(envelope,spec.memberSuffix);
    const actual=sha256(extracted.bytes);
    if(actual!==spec.sha256) throw new Factory2K035MaterializerError(`${key} SHA-256 mismatch: ${actual}`,'FACTORY2_K035_COMPONENT_IDENTITY_MISMATCH');
    const target=resolve(out,spec.artifact);
    writeFileSync(target,extracted.bytes);
    components[key]=Object.freeze({artifact:spec.artifact,member:extracted.name,sha256:actual,sizeBytes:extracted.bytes.length});
  }
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_K035_EXACT_PRODUCT_MATERIALIZATION_V1',
    status:'PASS',
    kernelTarget:'0.3.5',
    workspaceBaseTarget:authority.workspaceTarget,
    sourceAuthoritySha256:sha256(readFileSync(resolve(authorityPath))),
    envelope:Object.freeze({artifact:authority.envelope.artifact,sha256:envelopeSha256,sizeBytes:envelope.length,written:writeEnvelope}),
    chunks:Object.freeze(chunkReceipts),
    components:Object.freeze(components),
    historicalRecoveryRequired:false,
    productionActivation:false,
  });
}

function main(){
  const [authorityPath,repositoryRoot,outputRoot]=process.argv.slice(2);
  if(!authorityPath||!repositoryRoot||!outputRoot){
    console.error('usage: node scripts/factory2-k035-source-materializer.mjs <SOURCE_AUTHORITY.json> <repository-root> <output-root>');
    process.exit(2);
  }
  try{
    console.log(JSON.stringify(materializeFactory2K035Products({authorityPath,repositoryRoot,outputRoot,writeEnvelope:false}),null,2));
  }catch(error){ console.error(error?.stack||String(error)); process.exit(1); }
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) main();
