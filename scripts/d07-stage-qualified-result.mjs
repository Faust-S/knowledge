// Explicit D07 release handoff: ciphertext only in the public transit branch.
import {createHash,createCipheriv,publicEncrypt,createPublicKey,randomBytes,constants} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export const schema='IWXA_D07_QUALIFIED_TRANSIT/1';
const prefix='runtime/t3-platform/0.3.1-rc.1/';
const allowed=p=>typeof p==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..'||s==='.git'||s==='node_modules'||s.startsWith('.env'))&&!/\.(?:map|log|gguf|safetensors|onnx|pem|key)$/i.test(p)&&(p===prefix+'platform-inputs.zip'||p.startsWith(prefix+'d07-host/')||p.startsWith(prefix+'kernel-support/'));
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const blobHash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const die=code=>{throw Error('D07_TRANSIT_'+code)};
export const maxPartBytes=512*1024;
export function stageQualifiedResult({site,out,siteHead,tree,run,publicKey}){
 if(!/^[0-9a-f]{40}$/.test(siteHead)||!/^[0-9a-f]{64}$/.test(tree)||!/^\d+$/.test(run))die('IDENTITY');
 const root=realpathSync(site),dest=resolve(out),rel=relative(root,dest);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..')||existsSync(dest))die('FRESH_EXTERNAL_OUTPUT');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
 if(git('rev-parse','HEAD').toString().trim()!==siteHead||git('diff','--name-only').length)die('SOURCE_CHANGED');
 const staged=git('diff','--cached','--name-only','--no-renames','-z').toString().split('\0').filter(Boolean);
 if(staged.length!==98||new Set(staged).size!==98||!staged.every(allowed))die('STAGED_SCOPE');
 const entries=git('ls-files','--stage','-z','--',prefix+'d07-host',prefix+'kernel-support',prefix+'platform-inputs.zip').toString().split('\0').filter(Boolean);
 if(entries.length!==98)die('INDEX_COUNT');
 const keyObject=createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
 if(keyObject.asymmetricKeyType!=='rsa'||keyObject.asymmetricKeyDetails.modulusLength<3072)die('RECIPIENT_KEY');
 const key=randomBytes(32),wrapped=publicEncrypt({key:keyObject,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key);
 let counter=0,partCount=0,total=0;
 const rows=[];
 mkdirSync(dest,{recursive:false});mkdirSync(join(dest,'parts'));
 function seal(label,plain){
  const nonce=Buffer.alloc(12);nonce.writeUInt32LE(counter++,0);
  const cipher=createCipheriv('chacha20-poly1305',key,nonce,{authTagLength:16});
  cipher.setAAD(Buffer.from(JSON.stringify([schema,siteHead,tree,run,label])),{plaintextLength:plain.length});
  const body=Buffer.concat([cipher.update(plain),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),body]).toString('base64');
 }
 try{
  for(const entry of entries){
   const tab=entry.indexOf('\t'),[mode,blob,stage]=entry.slice(0,tab).split(' '),path=entry.slice(tab+1);
   if(tab<0||mode!=='100644'||!/^[0-9a-f]{40}$/.test(blob)||stage!=='0'||!allowed(path)||!staged.includes(path))die('INDEX_ENTRY');
   const b=git('cat-file','blob',blob),p=join(root,path),stat=lstatSync(p);
   if(!stat.isFile()||!b.length||b.length>95*1024*1024||blobHash(b)!==blob||!readFileSync(p).equals(b))die('INPUT_BYTES');
   total+=b.length;if(total>300*1024*1024)die('TOTAL_LIMIT');
   const parts=[];
   for(let start=0;start<b.length;start+=maxPartBytes){
    const chunk=b.subarray(start,start+maxPartBytes),label='parts/'+String(partCount++).padStart(6,'0')+'.txt';
    writeFileSync(join(dest,label),seal(label,chunk)+'\n',{flag:'wx'});
    parts.push({label,bytes:chunk.length,blob:blobHash(chunk)});
   }
   rows.push({path,mode,bytes:b.length,sha256:hash('sha256',b),blob,parts});
  }
  const manifest=Buffer.from(JSON.stringify({schema,site:siteHead,tree,run,files:rows,bytes:total}));
  if(manifest.length>400*1024)die('MANIFEST_LIMIT');
  const header={schema,site:siteHead,tree,run,partCount,wrappedKey:wrapped.toString('base64'),manifest:seal('manifest',manifest)};
  writeFileSync(join(dest,'header.json'),JSON.stringify(header,null,2)+'\n',{flag:'wx'});
  return {files:rows.length,parts:partCount,bytes:total,ciphertextOnly:true};
 }finally{key.fill(0)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [site,out,siteHead,tree,run,publicKey]=process.argv.slice(2);if(process.argv.length!==8)die('USAGE');console.log('D07_TRANSIT_STAGED=PASS '+JSON.stringify(stageQualifiedResult({site,out,siteHead,tree,run,publicKey})));}
 catch(e){console.error(/^D07_TRANSIT_[A-Z_]+$/.test(e.message)?e.message:'D07_TRANSIT_FAILED');process.exitCode=1;}
}
