#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {FACTORY2_ARTIFACT_NAME} from '../src/factory2/distribution/release-identity.mjs';
import {inventoryFactory2Staging,verifyFactory2Sha256Sums,Factory2StagingError} from './factory2-staging-tree.mjs';

export class Factory2ZipError extends Error {
  constructor(message,code='FACTORY2_ZIP_ERROR'){super(message);this.name='Factory2ZipError';this.code=code;}
}

const DOS_DATE_1980_01_01=(1<<5)|1;
const UTF8_FLAG=0x0800;
const VERSION=20;
const MAX_U16=0xffff;
const MAX_U32=0xffffffff;

const CRC_TABLE=(()=>{
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[n]=c>>>0;
  }
  return table;
})();
function crc32(bytes){
  let c=0xffffffff;
  for(const byte of bytes) c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function u16(v){ const b=Buffer.allocUnsafe(2); b.writeUInt16LE(v,0); return b; }
function u32(v){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(v>>>0,0); return b; }
function posix(value){ return value.split(sep).join('/'); }
function assertOutside(rootValue,outputValue){
  const root=resolve(rootValue), out=resolve(outputValue);
  const rel=posix(relative(root,out));
  if(rel===''||(!rel.startsWith('../')&&rel!=='..')) throw new Factory2ZipError('ZIP output must be outside staging root','FACTORY2_ZIP_OUTPUT_INSIDE_STAGING');
}
function requireStagingShape(files){
  const paths=files.map((x)=>x.path);
  for(const required of ['FACTORY2_DISTRIBUTION_MANIFEST.json','SHA256SUMS','START_HERE.md']){
    if(!paths.includes(required)) throw new Factory2ZipError(`missing required package entry: ${required}`,'FACTORY2_ZIP_REQUIRED_ENTRY_MISSING');
  }
  for(const prefix of ['PRODUCTS/','CONTROL/','ACCEPTANCE/','BOOTSTRAP/','COMPATIBILITY/','TOOLCHAIN/']){
    if(!paths.some((p)=>p.startsWith(prefix))) throw new Factory2ZipError(`missing required package root: ${prefix}`,'FACTORY2_ZIP_REQUIRED_ROOT_MISSING');
  }
}
export function buildFactory2ZipBytes(rootValue){
  const root=resolve(rootValue);
  const sumsPath=resolve(root,'SHA256SUMS');
  if(!existsSync(sumsPath)) throw new Factory2ZipError('SHA256SUMS is required before ZIP emission','FACTORY2_ZIP_SHA256SUMS_MISSING');
  try{ verifyFactory2Sha256Sums(root,readFileSync(sumsPath,'utf8')); }
  catch(error){
    if(error instanceof Factory2StagingError) throw new Factory2ZipError(error.message,'FACTORY2_ZIP_SHA256SUMS_INVALID');
    throw error;
  }
  const files=inventoryFactory2Staging(root);
  requireStagingShape(files);
  if(files.length>MAX_U16) throw new Factory2ZipError('ZIP64 is intentionally unsupported','FACTORY2_ZIP64_REQUIRED');

  const localParts=[];
  const centralParts=[];
  let offset=0;
  for(const file of files){
    const name=Buffer.from(file.path,'utf8');
    const data=readFileSync(resolve(root,file.path));
    if(name.length>MAX_U16||data.length>MAX_U32||offset>MAX_U32) throw new Factory2ZipError('ZIP64 is intentionally unsupported','FACTORY2_ZIP64_REQUIRED');
    const crc=crc32(data);

    const local=Buffer.concat([
      u32(0x04034b50),u16(VERSION),u16(UTF8_FLAG),u16(0),u16(0),u16(DOS_DATE_1980_01_01),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data,
    ]);
    localParts.push(local);

    const central=Buffer.concat([
      u32(0x02014b50),u16(VERSION),u16(VERSION),u16(UTF8_FLAG),u16(0),u16(0),u16(DOS_DATE_1980_01_01),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name,
    ]);
    centralParts.push(central);
    offset+=local.length;
  }
  const central=Buffer.concat(centralParts);
  const eocd=Buffer.concat([
    u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(offset),u16(0),
  ]);
  return Buffer.concat([...localParts,central,eocd]);
}

function safeExtractPath(root,name){
  const normalized=name.replaceAll('\\','/');
  if(normalized.startsWith('/')||normalized.split('/').includes('..')||normalized.includes('\\')) throw new Factory2ZipError(`unsafe ZIP entry: ${name}`,'FACTORY2_ZIP_UNSAFE_ENTRY');
  const out=resolve(root,...normalized.split('/')), base=resolve(root), rel=relative(base,out);
  if(rel===''||rel==='..'||rel.startsWith('..'+sep)) throw new Factory2ZipError(`ZIP entry escapes root: ${name}`,'FACTORY2_ZIP_UNSAFE_ENTRY');
  return out;
}
export function extractFactory2ZipBytes(bytes,targetRootValue){
  const targetRoot=resolve(targetRootValue);
  if(existsSync(targetRoot)) throw new Factory2ZipError('fresh extract target must not exist','FACTORY2_ZIP_EXTRACT_TARGET_EXISTS');
  mkdirSync(targetRoot,{recursive:true});
  let offset=0,count=0;
  while(offset+4<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),expectedCrc=bytes.readUInt32LE(offset+14),compressedSize=bytes.readUInt32LE(offset+18),uncompressedSize=bytes.readUInt32LE(offset+22),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    if(method!==0) throw new Factory2ZipError('Factory 2 deterministic ZIP extractor accepts stored entries only','FACTORY2_ZIP_EXTRACT_METHOD_INVALID');
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString((flags&UTF8_FLAG)?'utf8':'utf8');
    const dataOffset=offset+30+nameLength+extraLength;
    const data=bytes.subarray(dataOffset,dataOffset+compressedSize);
    if(data.length!==uncompressedSize) throw new Factory2ZipError(`ZIP entry size mismatch: ${name}`,'FACTORY2_ZIP_EXTRACT_SIZE_MISMATCH');
    if(crc32(data)!==expectedCrc) throw new Factory2ZipError(`ZIP entry CRC mismatch: ${name}`,'FACTORY2_ZIP_EXTRACT_CRC_MISMATCH');
    const out=safeExtractPath(targetRoot,name);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,data);count+=1;
    offset=dataOffset+compressedSize;
  }
  if(count===0) throw new Factory2ZipError('no local ZIP entries extracted','FACTORY2_ZIP_EXTRACT_EMPTY');
  return Object.freeze({schema:'IWXA_T2_FACTORY2_FRESH_EXTRACT_RECEIPT_V1',status:'PASS',fileCount:count,targetRoot});
}

export function writeFactory2Zip(rootValue,outputValue){
  assertOutside(rootValue,outputValue);
  const bytes=buildFactory2ZipBytes(rootValue);
  const rebuildRoot=mkdtempSync(resolve(tmpdir(),'factory2-zip-rebuild-'));
  const rebuildPath=resolve(rebuildRoot,FACTORY2_ARTIFACT_NAME);
  let rebuilt;
  try{
    writeFileSync(rebuildPath,buildFactory2ZipBytes(rootValue));
    rebuilt=readFileSync(rebuildPath);
    if(Buffer.compare(bytes,rebuilt)!==0) throw new Factory2ZipError('second deterministic ZIP build is not byte-identical','FACTORY2_ZIP_REBUILD_MISMATCH');
  }finally{ rmSync(rebuildRoot,{recursive:true,force:true}); }
  const digest=createHash('sha256').update(bytes).digest('hex');
  const rebuiltDigest=createHash('sha256').update(rebuilt).digest('hex');
  if(rebuiltDigest!==digest) throw new Factory2ZipError('second deterministic ZIP SHA-256 differs','FACTORY2_ZIP_REBUILD_MISMATCH');
  writeFileSync(resolve(outputValue),bytes);
  return Object.freeze({
    schema:'IWXA_T2_FACTORY2_DETERMINISTIC_ZIP_RECEIPT_V1',
    status:'PASS',
    artifactName:FACTORY2_ARTIFACT_NAME,
    bytes:bytes.length,
    sha256:digest,
    deterministicRebuildVerified:true,
    deterministicRebuildSha256:rebuiltDigest,
    deterministicPolicy:Object.freeze({
      entryOrder:'RELATIVE_POSIX_STRING_ASCENDING',
      timestamp:'1980-01-01T00:00:00',
      compression:'ZIP_STORED',
      utf8Names:true,
      zip64:false,
    }),
  });
}
function main(){
  const [root,output]=process.argv.slice(2);
  if(!root||!output){
    console.error('usage: node scripts/factory2-deterministic-zip.mjs <staging-root> <output-zip>');
    process.exit(2);
  }
  try{ console.log(JSON.stringify(writeFactory2Zip(root,output),null,2)); }
  catch(error){ console.error(error?.stack||String(error)); process.exit(1); }
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) main();
