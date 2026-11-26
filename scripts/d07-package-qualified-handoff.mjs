// D07 one-time encrypted Windows handoff of an already qualified release.
// No product build, private remote write, model download, or acceptance here.
import {createHash,createCipheriv,createDecipheriv,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,randomBytes,constants} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const pins=Object.freeze({
 site:'20ca06ee2f07b430dbd6b59f72822b45f0527bd4',
 tree:'d614243c9dbfc596f7c0c2a8d5ef516ab3703aa5b61b6ec4c9a2538d49749d69',
 distFiles:826,retainedFiles:98,retainedBytes:58575873,
 recipient:'013eb95998581b9641cc9a28b134c44e9b5dbc472e7d1682bd84b11bc9987eb0',
});
const schema='IWXA_D07_QUALIFIED_HANDOFF/1';
const prefix='runtime/t3-platform/0.3.1-rc.1/';
const groups=[prefix+'d07-host',prefix+'kernel-support',prefix+'platform-inputs.zip'];
const die=code=>{throw Error('D07_HANDOFF_'+code)};
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const valid=p=>typeof p==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&p.split('/').every(s=>s!=='.'&&s!=='..'&&!s.endsWith('.')&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const retained=p=>p===groups[2]||p.startsWith(groups[0]+'/')||p.startsWith(groups[1]+'/');
const allowed=p=>valid(p)&&(p.startsWith('dist/')||retained(p));
const sort=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0;
const maxZip=768*1024*1024;
const inside=(root,p)=>{const r=relative(root,p);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!/^[A-Za-z]:/.test(r))};
function collect(root,paths){
 const rows=[];
 function walk(p){
  const s=lstatSync(p),name=relative(root,p).split(sep).join('/');
  if(s.isSymbolicLink()||!valid(name))die('UNSAFE_PATH');
  if(s.isDirectory()){for(const n of readdirSync(p))walk(join(p,n));return}
  if(!s.isFile()||!allowed(name))die('UNEXPECTED_FILE');
  const b=readFileSync(p);rows.push({path:name,bytes:b.length,sha256:hash(b)});
 }
 for(const p of paths)walk(join(root,p));
 return rows.sort(sort);
}
function checkedNames(names,expected){
 if(names.length!==expected.distFiles+expected.retainedFiles||new Set(names.map(s=>s.toLowerCase())).size!==names.length||!names.every(allowed))die('ENTRY_SCOPE');
 return names;
}
function identity(root,expected,all=false){
 const rows=collect(root,all?readdirSync(root):['dist',...groups]);
 checkedNames(rows.map(r=>r.path),expected);
 const dist=rows.filter(r=>r.path.startsWith('dist/')).map(r=>({...r,path:r.path.slice(5)}));
 const inputs=rows.filter(r=>retained(r.path));
 const bytes=inputs.reduce((n,r)=>n+r.bytes,0);
 if(dist.length!==expected.distFiles||!dist.some(r=>r.path==='t3-offline-manifest.json')||hash(Buffer.from(JSON.stringify(dist)))!==expected.tree)die('DIST_IDENTITY');
 if(inputs.length!==expected.retainedFiles||bytes!==expected.retainedBytes||!groups.every(g=>inputs.some(r=>r.path===g||r.path.startsWith(g+'/'))))die('RETAINED_IDENTITY');
 return {rows,retainedSha256:hash(Buffer.from(JSON.stringify(inputs)))};
}
function keyId(key){return hash(createPublicKey(key).export({format:'der',type:'spki'}))}
function archiveNames(archive){
 const cmd=process.platform==='win32'?'tar':'unzip';
 const args=process.platform==='win32'?['-tf',archive]:['-Z1',archive];
 return execFileSync(cmd,args,{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}).trimEnd().split(/\r?\n/);
}
export function pack({root,out,run,publicKey,expected=pins}){
 root=realpathSync(root);out=resolve(out);
 if(!/^\d+$/.test(run)||existsSync(out)||inside(root,out))die('PACK_ARGUMENT');
 const key=createPublicKey({key:Buffer.from(publicKey,'base64'),format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072||hash(key.export({format:'der',type:'spki'}))!==expected.recipient)die('RECIPIENT');
 const id=identity(root,expected),names=id.rows.map(r=>r.path);
 const temp=mkdtempSync(join(tmpdir(),'d07-seal-')),archive=join(temp,'release.zip');
 const secret=randomBytes(32);let made=false;
 try{
  execFileSync('zip',['-q','-6','-X',archive,'-@'],{cwd:root,input:Buffer.from(names.join('\n')+'\n'),stdio:['pipe','pipe','pipe']});
  const observed=checkedNames(archiveNames(archive),expected).sort();
  if(JSON.stringify(observed)!==JSON.stringify([...names].sort()))die('ZIP_ENTRY_MISMATCH');
  const n=lstatSync(archive).size;if(n<1||n>maxZip)die('ZIP_SIZE');
  const plain=readFileSync(archive);
  const metadata={schema,site:expected.site,tree:expected.tree,run,recipient:expected.recipient,distFiles:expected.distFiles,retainedFiles:expected.retainedFiles,retainedBytes:expected.retainedBytes,retainedSha256:id.retainedSha256,zipBytes:n,zipSha256:hash(plain)};
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const wrappedKey=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},secret);
  mkdirSync(out);made=true;
  writeFileSync(join(out,'payload.bin'),Buffer.concat([cipher.update(plain),cipher.final()]),{flag:'wx'});
  writeFileSync(join(out,'header.json'),JSON.stringify({metadata,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:wrappedKey.toString('base64')},null,2)+'\n',{flag:'wx'});
  return metadata;
 }catch(e){if(made)rmSync(out,{recursive:true,force:true});throw e}
 finally{secret.fill(0);rmSync(temp,{recursive:true,force:true})}
}
export function open({input,out,privateKey,run,expected=pins}){
 input=realpathSync(input);out=resolve(out);
 if(!/^\d+$/.test(run)||existsSync(out)||inside(input,out))die('OPEN_ARGUMENT');
 const names=readdirSync(input).sort();if(names.join(',')!=='header.json,payload.bin')die('ENVELOPE_SCOPE');
 for(const n of names){const s=lstatSync(join(input,n));if(!s.isFile()||s.isSymbolicLink())die('ENVELOPE_SCOPE')}
 if(lstatSync(join(input,'header.json')).size>8192)die('HEADER_SIZE');
 const h=JSON.parse(readFileSync(join(input,'header.json'),'utf8')),m=h.metadata;
 if(!m||m.schema!==schema||m.site!==expected.site||m.tree!==expected.tree||m.run!==run||m.recipient!==expected.recipient||m.distFiles!==expected.distFiles||m.retainedFiles!==expected.retainedFiles||m.retainedBytes!==expected.retainedBytes||!hex(m.retainedSha256)||!hex(m.zipSha256)||!Number.isSafeInteger(m.zipBytes)||m.zipBytes<1||m.zipBytes>maxZip||lstatSync(join(input,'payload.bin')).size!==m.zipBytes)die('HEADER_IDENTITY');
 const key=createPrivateKey(readFileSync(privateKey));if(keyId(key)!==expected.recipient)die('RECIPIENT');
 const nonce=Buffer.from(h.nonce,'base64'),tag=Buffer.from(h.tag,'base64');if(nonce.length!==12||tag.length!==16)die('AUTH_FIELDS');
 const secret=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(h.wrappedKey,'base64'));
 const temp=mkdtempSync(join(tmpdir(),'d07-open-')),archive=join(temp,'release.zip');let made=false;
 try{
  if(secret.length!==32)die('KEY_SIZE');
  const cipher=createDecipheriv('aes-256-gcm',secret,nonce);cipher.setAAD(Buffer.from(JSON.stringify(m)));cipher.setAuthTag(tag);
  const plain=Buffer.concat([cipher.update(readFileSync(join(input,'payload.bin'))),cipher.final()]);
  if(plain.length!==m.zipBytes||hash(plain)!==m.zipSha256)die('ZIP_IDENTITY');
  writeFileSync(archive,plain,{flag:'wx',mode:0o600});
  const entries=checkedNames(archiveNames(archive),expected).sort();
  mkdirSync(out);made=true;
  const cmd=process.platform==='win32'?'tar':'unzip';
  const args=process.platform==='win32'?['-xf',archive,'-C',out]:['-q',archive,'-d',out];
  execFileSync(cmd,args,{stdio:['ignore','pipe','pipe']});
  const result=identity(out,expected,true);
  if(result.retainedSha256!==m.retainedSha256||JSON.stringify(result.rows.map(r=>r.path).sort())!==JSON.stringify(entries))die('EXTRACTED_IDENTITY');
  return m;
 }catch(e){if(made)rmSync(out,{recursive:true,force:true});throw e}
 finally{secret.fill(0);rmSync(temp,{recursive:true,force:true})}
}
async function main(args){
 const [mode,...a]=args;
 if(mode==='seal'&&a.length===4){
  const [root,out,run,publicKey]=a;
  const git=(...argv)=>execFileSync('git',['-C',root,...argv],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(git('rev-parse','HEAD').trim()!==pins.site||git('diff','--name-only').trim())die('SOURCE_IDENTITY');
  const {verifyD07RetainedIndex}=await import(pathToFileURL(resolve(root,'scripts/verify-d07-retained-index.mjs')).href);
  const evidence=verifyD07RetainedIndex(root);
  if(evidence.files!==pins.retainedFiles||evidence.staged!==pins.retainedFiles||!evidence.exactBytes||!evidence.checkoutExact)die('INDEX_IDENTITY');
  console.log('D07_HANDOFF_SEALED=PASS '+JSON.stringify(pack({root,out,run,publicKey})));
 }else if(mode==='open'&&a.length===4){
  const [input,out,run,privateKey]=a;
  console.log('D07_HANDOFF_OPENED=PASS '+JSON.stringify(open({input,out,run,privateKey})));
 }else die('USAGE');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(/^D07_HANDOFF_[A-Z_]+$/.test(e.message)?e.message:'D07_HANDOFF_FAILED');process.exitCode=1});
