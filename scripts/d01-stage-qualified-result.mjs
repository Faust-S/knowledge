// D01 encrypted retained-input transit, following the D07 release handoff.
// This helper never sends private code to an unencrypted public destination.
import {createHash,createCipheriv,createPublicKey,publicEncrypt,randomBytes,constants} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const schema='IWXA_D01_RETAINED_TRANSIT/1',partBytes=512*1024;
const fail=code=>{throw Error('D01_TRANSIT_'+code)};
const sha=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const valid=p=>typeof p==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&p.split('/').every(s=>s!=='.'&&s!=='..'&&s!=='.git'&&s!=='node_modules'&&!s.startsWith('.env'))&&!/\.(?:map|log|gguf|safetensors|onnx|pem|key)$/i.test(p);
const allowed=p=>valid(p)&&(p==='platform-inputs.zip'||p.startsWith('learn-host/'));
function inventory(root){
 const rows=[];
 function walk(p){const st=lstatSync(p),name=relative(root,p).split(sep).join('/');
  if(st.isSymbolicLink())fail('SYMLINK');
  if(st.isDirectory()){for(const n of readdirSync(p))walk(join(p,n));return;}
  if(!st.isFile()||!allowed(name))fail('PATH_SCOPE');
  const b=readFileSync(p);rows.push({path:name,bytes:b.length,sha256:sha(b)});
 }
 walk(join(root,'platform-inputs.zip'));walk(join(root,'learn-host'));
 rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(rows.length<2||new Set(rows.map(r=>r.path.toLowerCase())).size!==rows.length||!rows.some(r=>r.path==='learn-host/learn-t3-host-input.json'))fail('RETAINED_SCOPE');
 return rows;
}
export function packRetained({root,out,site,dist,run,publicKey,recipient}){
 root=realpathSync(root);out=resolve(out);
 if(!/^[a-f0-9]{40}$/.test(site)||!/^[a-f0-9]{64}$/.test(dist)||!/^\d+$/.test(run)||!/^[a-f0-9]{64}$/.test(recipient)||existsSync(out))fail('IDENTITY');
 const rel=relative(root,out);if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))fail('OUTPUT_SCOPE');
 const publicObject=createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
 if(publicObject.asymmetricKeyType!=='rsa'||publicObject.asymmetricKeyDetails.modulusLength<3072||sha(publicObject.export({format:'der',type:'spki'}))!==recipient)fail('RECIPIENT');
 const files=inventory(root),temp=mkdtempSync(join(tmpdir(),'d01-seal-')),archive=join(temp,'retained.zip');
 const secret=randomBytes(32);let made=false,counter=0;
 try{
  execFileSync('zip',['-q','-6','-X',archive,'-@'],{cwd:root,input:Buffer.from(files.map(r=>r.path).join('\n')+'\n'),stdio:['pipe','pipe','pipe']});
  const names=execFileSync('unzip',['-Z1',archive],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd().split(/\r?\n/).sort();
  if(JSON.stringify(names)!==JSON.stringify(files.map(r=>r.path)))fail('ZIP_SCOPE');
  const b=readFileSync(archive);if(!b.length||b.length>128*1024*1024)fail('ZIP_SIZE');
  const wrap=publicEncrypt({key:publicObject,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},secret);
  function seal(label,plain){
   const nonce=Buffer.alloc(12);nonce.writeUInt32LE(counter++,0);
   const cipher=createCipheriv('aes-256-gcm',secret,nonce);
   cipher.setAAD(Buffer.from(JSON.stringify([schema,site,dist,run,recipient,label])));
   const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
   return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
  }
  mkdirSync(out);made=true;mkdirSync(join(out,'parts'));
  const parts=[];
  for(let start=0;start<b.length;start+=partBytes){
   const plain=b.subarray(start,start+partBytes),label='parts/'+String(parts.length).padStart(6,'0')+'.txt';
   writeFileSync(join(out,label),seal(label,plain)+'\n',{flag:'wx'});
   parts.push({label,bytes:plain.length,sha256:sha(plain),blob:blob(plain)});
  }
  const manifest={schema,site,dist,run,recipient,zipBytes:b.length,zipSha256:sha(b),files,parts};
  const json=Buffer.from(JSON.stringify(manifest));if(json.length>400*1024)fail('MANIFEST_SIZE');
  writeFileSync(join(out,'header.json'),JSON.stringify({schema,site,dist,run,recipient,partCount:parts.length,wrappedKey:wrap.toString('base64'),manifest:seal('manifest',json)},null,2)+'\n',{flag:'wx'});
  return {parts:parts.length,files:files.length,bytes:b.length,ciphertextOnly:true};
 }catch(e){if(made)rmSync(out,{recursive:true,force:true});throw e;}
 finally{secret.fill(0);rmSync(temp,{recursive:true,force:true});}
}
async function main(){
 const [root,out,site,dist,run,publicKey,recipient]=process.argv.slice(2);
 if(process.argv.length!==9)fail('USAGE');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(git('rev-parse','HEAD')!==site||git('diff','HEAD','--name-only'))fail('SOURCE_CHANGED');
 const load=p=>import(pathToFileURL(join(root,'scripts',p)).href);
 const {distIdentity}=await load('verify-learn-t3-reproducibility.mjs');
 if(distIdentity(join(root,'dist')).sha256!==dist)fail('DIST_IDENTITY');
 const {platformDir,installedArchive,verifyPlatformArchive}=await load('t3-platform-inputs.mjs');
 const {retainedHost}=await load('retain-learn-t3-inputs.mjs');
 const {verifyPreparedLearnHost}=await load('prepare-learn-t3-host.mjs');
 verifyPlatformArchive(installedArchive);verifyPreparedLearnHost(retainedHost);
 console.log('D01_TRANSIT_STAGED='+JSON.stringify(packRetained({root:platformDir,out,site,dist,run,publicKey,recipient})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(/^D01_TRANSIT_[A-Z_]+$/.test(e.message)?e.message:'D01_TRANSIT_FAILED');process.exitCode=1;});
