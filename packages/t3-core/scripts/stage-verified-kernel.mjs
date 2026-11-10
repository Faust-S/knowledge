/**
 * Install already qualified Kernel runtime bytes into an isolated Host's public/
 * tree. The only authority for versions and SHA-256 pins remains the canonical
 * T2 qualified-kernel-artifact verifier; this stage never creates grants.
 */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deny = code => {throw new Error('T2_QUALIFIED_KERNEL_STAGE_'+code);};
function noSymlinks(target){
 const absolute=resolve(target);
 let current=absolute;
 while(true){
  if(existsSync(current)&&lstatSync(current).isSymbolicLink())deny('SYMLINK_PATH');
  const parent=dirname(current);
  if(parent===current)break;
  current=parent;
 }
 return absolute;
}
function contained(root,path){
 const rel=relative(root,path);
 return !!rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);
}
/** The copy primitive is also tested with synthetic *already verified* bytes.
 * Production callers MUST first use assertQualifiedKernelArtifact. */
export function stageVerifiedKernelFiles(sourceRoot,publicRoot,verifiedFiles){
 const source=noSymlinks(sourceRoot),target=noSymlinks(publicRoot);
 if(!existsSync(source)||!lstatSync(source).isDirectory())deny('SOURCE_ROOT_INVALID');
 if(!existsSync(target)||!lstatSync(target).isDirectory())deny('TARGET_ROOT_INVALID');
 if(source===target||contained(source,target)||contained(target,source))deny('OVERLAPPING_ROOTS');
 if(!Array.isArray(verifiedFiles)||verifiedFiles.length===0)deny('INVENTORY_INVALID');
 const files=[],seen=new Set();
 for(const item of verifiedFiles){
  if(!item||typeof item.path!=='string'||!/^_iwxa\/[A-Za-z0-9_./-]+$/.test(item.path)||item.path.includes('..')||
    typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||seen.has(item.path))deny('INVENTORY_INVALID');
  seen.add(item.path);
  const from=resolve(source,item.path),to=resolve(target,item.path);
  if(!contained(source,from)||!contained(target,to))deny('INVENTORY_INVALID');
  noSymlinks(from);noSymlinks(to);
  if(!existsSync(from)||!lstatSync(from).isFile()||hash(readFileSync(from))!==item.sha256)deny('SOURCE_MISMATCH:'+item.path);
  if(existsSync(to)&&(!lstatSync(to).isFile()||hash(readFileSync(to))!==item.sha256))deny('TARGET_CONFLICT:'+item.path);
  files.push({from,to,sha256:item.sha256,path:item.path,exists:existsSync(to)});
 }
 const written=[];
 try{
  for(const file of files){
   if(file.exists)continue;
   mkdirSync(dirname(file.to),{recursive:true});
   noSymlinks(file.to);
   writeFileSync(file.to,readFileSync(file.from),{flag:'wx'});
   written.push(file.to);
   if(hash(readFileSync(file.to))!==file.sha256)deny('READBACK_MISMATCH:'+file.path);
  }
  return {status:'STAGED_VERIFIED_BYTES',count:files.length,created:written.length,alreadyPresent:files.length-written.length,paths:files.map(x=>x.path)};
 }catch(error){
  for(const file of written.reverse())rmSync(file,{force:true});
  throw error;
 }
}
/** T2-qualified artifact selection is the authority for installed bytes. */
export function stageQualifiedKernelAssets({qualifiedDist,publicRoot,kernel='0.3.6',contract='1.3.0',artifactId,qualificationOnly=false}){
 if(qualificationOnly!==true)deny('QUALIFICATION_ONLY_REQUIRED');
 const selector=artifactId===undefined?{kernel,contract}:{kernel,contract,artifactId};
 const verified=assertQualifiedKernelArtifact(resolve(qualifiedDist),selector);
 const report=stageVerifiedKernelFiles(qualifiedDist,publicRoot,verified.files);
 const readback=assertQualifiedKernelArtifact(resolve(publicRoot),selector);
 if(readback.artifactSha256!==verified.artifactSha256)deny('READBACK_RELEASE_MISMATCH');
 return {...report,kernel,contract,...(verified.artifactId?{artifactId:verified.artifactId}:{}),
   artifactSha256:verified.artifactSha256,productionActivation:false,grantsCreated:false};
}
const calledAsMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(calledAsMain){
 const args=process.argv.slice(2);
 if((args.length!==3&&args.length!==5)||args[2]!=='--qualification-only'||
    (args.length===5&&args[3]!=='--artifact-id'))deny('USAGE');
 console.log(JSON.stringify(stageQualifiedKernelAssets({
   qualifiedDist:args[0],publicRoot:args[1],qualificationOnly:true,
   ...(args.length===5?{artifactId:args[4]}:{})
 })));
}
