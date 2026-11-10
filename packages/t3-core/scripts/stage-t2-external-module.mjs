/** Stage trusted domain modules in a disposable Host; never modify canonical T2. */
import {cpSync,existsSync,lstatSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const fail=(code)=>{throw new Error('T2_EXTERNAL_MODULE_'+code)};
const idPattern=/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const dirPattern=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
function inspect(root){
 let files=0,bytes=0;
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
   if(e.isSymbolicLink())fail('SYMLINK');
   if(['.git','node_modules','dist','.vite'].includes(e.name)||e.name.startsWith('.env'))fail('FORBIDDEN_FILE');
   const path=join(dir,e.name);
   if(e.isDirectory())walk(path);
   else if(e.isFile()){
     if(!/\.(?:ts|tsx|js|mjs|mts|json|css|svg|png|webp|woff2)$/.test(e.name))fail('FILE_EXTENSION');
     files++;bytes+=lstatSync(path).size;
     if(files>2048||bytes>33554432)fail('SOURCE_SIZE');
   }else fail('SPECIAL_FILE');
 }}
 walk(root);if(!files)fail('EMPTY_SOURCE');
}
function contributionIds(manifest){
 const ids=new Set();
 for(const [group,rows] of Object.entries(manifest.contributions??{})){
   if(!Array.isArray(rows))fail('CONTRIBUTIONS_INVALID');
   for(const row of rows){
     if(!row||typeof row.id!=='string'||!row.id.trim())fail('CONTRIBUTIONS_INVALID');
     const key=group+'\u0000'+row.id;
     if(ids.has(key))fail('CONTRIBUTION_COLLISION');
     ids.add(key);
   }
 }
 return ids;
}
function assertNoCollisions(stage,manifest){
 const incoming=contributionIds(manifest);
 const root=join(stage,'src/modules');
 for(const entry of readdirSync(root,{withFileTypes:true})){
   if(entry.isSymbolicLink())fail('STAGE_SYMLINK');
   if(!entry.isDirectory())continue;
   const path=join(root,entry.name,'manifest.json');
   if(!existsSync(path))continue;
   if(lstatSync(path).isSymbolicLink())fail('STAGE_SYMLINK');
   const other=JSON.parse(readFileSync(path,'utf8'));
   if(other.module_id===manifest.module_id)fail('ID_RESERVED');
   const existing=contributionIds(other);
   for(const id of incoming)if(existing.has(id))fail('CONTRIBUTION_COLLISION');
 }
}
export function stageT2ExternalModule({stageRoot,sourceDir,moduleId,moduleDirectory}){
 if(!idPattern.test(moduleId)||!dirPattern.test(moduleDirectory))fail('ID_INVALID');
 const stage=realpathSync(stageRoot),src=realpathSync(sourceDir);
 if(stage===src||stage.startsWith(src+sep)||src.startsWith(stage+sep))fail('OVERLAP');
 inspect(src);
 const manifest=JSON.parse(readFileSync(join(src,'manifest.json'),'utf8'));
 if(manifest.module_id!==moduleId||manifest.compatibility?.runtime_contract!=='1.3.0'||
 manifest.compatibility?.workspace_contract!=='0.1.0'||manifest.security?.direct_indexeddb!==false||
 manifest.security?.remote_code!==false||manifest.security?.iwxa_executable_payload!==false||
 !existsSync(join(src,'index.ts')))fail('MANIFEST_INVALID');
 const target=join(stage,'src/modules',moduleDirectory);
 if(existsSync(target))fail('ALREADY_PRESENT');
 const composition=join(stage,'src/composition/product-module-extensions.ts');
 const old=readFileSync(composition,'utf8');
 const declaration='"'+moduleId+'": () => import("../modules/'+moduleDirectory+'"),';
 if(old.includes('"'+moduleId+'"'))fail('ID_RESERVED');
 if(!old.includes('export const PRODUCT_MODULE_EXTENSIONS'))fail('COMPOSITION_INVALID');
 const marker='  // T2_EXTERNAL_DOMAIN_MODULES';
 const tableAnchor='export const PRODUCT_MODULE_EXTENSIONS: ModuleLoaderTable = Object.freeze({';
 const current=old.includes(marker)?old:old.replace(tableAnchor,tableAnchor+'\n'+marker);
 if(!current.includes(marker))fail('COMPOSITION_ANCHOR_MISSING');
 assertNoCollisions(stage,manifest);
 // Build-time literal import only; never evaluate import paths from runtime config.
 const next=current.replace(marker,marker+'\n  '+declaration);
 const pending=composition+'.t2-staging-new';
 if(existsSync(pending))fail('PENDING_COMPOSITION_EXISTS');
 try {
   cpSync(src,target,{recursive:true,force:false,errorOnExist:true,dereference:false});
   writeFileSync(pending,next,'utf8');
   renameSync(pending,composition);
 }catch(error){
   rmSync(pending,{force:true});
   rmSync(target,{recursive:true,force:true});
   throw error;
 }
 return {moduleId,sourceScope:'CANONICAL_DOMAIN_REPO',stageScope:'DISPOSABLE_HOST_ONLY',authorityGranted:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==6)throw new Error('T2_EXTERNAL_MODULE_USAGE');
    const [stageRoot,sourceDir,moduleId,moduleDirectory]=process.argv.slice(2);
    process.stdout.write(JSON.stringify(stageT2ExternalModule({stageRoot,sourceDir,moduleId,moduleDirectory}))+'\n');
  }catch(e){console.error(String(e));process.exitCode=1;}
}
