#!/usr/bin/env node
// Stage the ORIGINAL, externally supplied Control owner for the installed T3.
// Executable T3 integration has ONE source: knowledge/packages/t3-core.
// This replaces only the compiled UI static server in a disposable copy;
// original Ed25519 AccessRegistry, journals, source checkout and private
// licensing/organization keys are not changed or redistributed.
import {createHash,randomUUID} from "node:crypto";
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,
  readdirSync,renameSync,rmSync,statSync,writeFileSync} from "node:fs";
import {dirname,extname,isAbsolute,join,relative,resolve,sep} from "node:path";
import {fileURLToPath} from "node:url";

const CORE_ROOT=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),".."));
const PUBLIC_UI=join(CORE_ROOT,"src/t3/isolated-ui-server.mjs");
const PUBLIC_SIGNED_OWNER_BRIDGE=join(CORE_ROOT,"src/t3/signed-access-host-port.mjs");
const PINNED_DIRS=Object.freeze(["interop","access-control","reconciliation"]);
const QUALIFIER_FILES=Object.freeze([
  "qualification/t3-d1-loopback-owner-local.test.mjs",
  "qualification/t3-d1-cross-owner-integration.mjs",
]);
const SOURCE_EXTENSIONS=new Set([".mjs",".js",".cjs",".json",".html",".css",
  ".svg",".png",".ico",".webp",".woff2",".wasm"]);
const sha=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
const fail=code=>{throw Error("T3_D1_CONTROL_STAGE_"+code);};
function overlaps(a,b){
  return a===b||a.startsWith(b+sep)||b.startsWith(a+sep);
}
function requireRegular(root,rel){
  const path=join(root,rel);
  if(!existsSync(path)||lstatSync(path).isSymbolicLink()||
     !statSync(path).isFile()||realpathSync(path)!==path)
    fail("REQUIRED_SOURCE_INVALID");
  return path;
}
function copySources(source,target,includeQualifications){
  const dirs=PINNED_DIRS;
  let count=0,bytes=0;
  for(const dir of dirs){
    const start=join(source,dir);
    if(!existsSync(start)||!lstatSync(start).isDirectory()||
       lstatSync(start).isSymbolicLink())fail("SOURCE_DIRECTORY_REQUIRED");
    const scan=(folder)=>{
      for(const item of readdirSync(folder,{withFileTypes:true})){
        if(item.isSymbolicLink())fail("SYMLINK_FORBIDDEN");
        // Never stage repository metadata, credentials, logs or user data.
        if(item.name.startsWith(".")||item.name==="node_modules"||
           item.name==="dist"||item.name==="__pycache__")continue;
        const path=join(folder,item.name);
        if(item.isDirectory()){scan(path);continue;}
        if(!item.isFile())fail("SPECIAL_FILE");
        if(!SOURCE_EXTENSIONS.has(extname(item.name)))continue;
        const n=statSync(path).size;
        if(n>20971520||++count>3500||(bytes+=n)>104857600)
          fail("SOURCE_BOUND_EXCEEDED");
        const rel=relative(source,path),dest=join(target,rel);
        mkdirSync(dirname(dest),{recursive:true});
        cpSync(path,dest,{dereference:false,force:false,errorOnExist:true});
      }
    };
    scan(start);
  }
  if(includeQualifications){
    // Only the TWO D1 owner qualification entrypoints are needed. The
    // historical private repository contains unrelated large fixtures,
    // packaged data and old reports, none of which belong in a Control
    // installation or a public Actions runner.
    for(const rel of QUALIFIER_FILES){
      const file=requireRegular(source,rel);
      const size=statSync(file).size;
      if(size>20971520||++count>3500||(bytes+=size)>104857600)
        fail("SOURCE_BOUND_EXCEEDED");
      const dest=join(target,rel);
      mkdirSync(dirname(dest),{recursive:true});
      cpSync(file,dest,{dereference:false,force:false,errorOnExist:true});
    }
  }
  if(count<3)fail("SOURCE_INCOMPLETE");
  return count;
}

/** Build an ephemeral installed Control from an already authorized original
 * checkout. NO fetch, signer copy into knowledge, private GitHub Actions, or
 * alternative Access mechanism. The caller must keep the output private,
 * must never upload it as a public workflow artifact, and must supply the
 * original T3 one-dist independently at Control startup via --t3-dist.
 */
export function stageOriginalControlConsumer({
  originalControlRoot,outputRoot,includeQualifications=false,
}={}){
  if(typeof originalControlRoot!=="string"||!originalControlRoot.trim()||
     typeof outputRoot!=="string"||!outputRoot.trim()||
     typeof includeQualifications!=="boolean")
    fail("PATHS_REQUIRED");
  const source=realpathSync(resolve(originalControlRoot));
  const output=resolve(outputRoot);
  if(overlaps(source,output)||overlaps(CORE_ROOT,output)||
     overlaps(CORE_ROOT,source))fail("SOURCE_OUTPUT_OVERLAP");
  if(existsSync(output))fail("OUTPUT_ALREADY_EXISTS");
  const privateServer=requireRegular(source,"interop/server.mjs");
  const oldUi=requireRegular(source,"interop/t3-isolated-ui-server.mjs");
  requireRegular(source,"interop/t3-control-workspace-entry.mjs");
  const content=readFileSync(privateServer,"utf8");
  // The unmodified ORIGINAL Control uses exactly this stable static import.
  // Never rewrite its signer/issuer or accept a dynamic browser-supplied port.
  if(!content.includes(
    "import {createT3IsolatedUiServer} from './t3-isolated-ui-server.mjs';")||
     !content.includes("t3SignedPortFactory")||
     !content.includes("t3OneDistRoot")||
     !content.includes("bindOriginalControlToT3App"))
    fail("ORIGINAL_SIGNED_CONTROL_CONTRACT_REQUIRED");
  if(!readFileSync(oldUi,"utf8").includes(
    "export function createT3IsolatedUiServer(")||
     !readFileSync(PUBLIC_UI,"utf8").includes(
       "export function createT3IsolatedUiServer("))
    fail("ISOLATED_UI_API_INCOMPATIBLE");
  const ownerBridge=readFileSync(PUBLIC_SIGNED_OWNER_BRIDGE,"utf8");
  if(!ownerBridge.includes("export function createSignedAccessHostPort("))
    fail("ORIGINAL_SIGNED_BRIDGE_API_REQUIRED");
  const bridgeSha=sha(PUBLIC_SIGNED_OWNER_BRIDGE);
  const before=sha(privateServer),originalUiSha=sha(oldUi),publicSha=sha(PUBLIC_UI);
  const temporary=output+".building-"+randomUUID();
  mkdirSync(dirname(output),{recursive:true});
  try{
    mkdirSync(temporary,{recursive:false});
    const copied=copySources(source,temporary,includeQualifications);
    const stagedServer=join(temporary,"interop/server.mjs");
    const stagedUi=join(temporary,"interop/t3-isolated-ui-server.mjs");
    if(sha(stagedServer)!==before||sha(stagedUi)!==originalUiSha)
      fail("ORIGINAL_STAGE_BYTES_CHANGED");
    writeFileSync(stagedUi,readFileSync(PUBLIC_UI));
    // The historical Control CLI uses --t3-public-core to load the
    // original knowledge D1 bridge from src/t3. Stage its exact current
    // bytes so an installed Control never depends on a live Git checkout.
    const stagedBridge=join(temporary,"src/t3/signed-access-host-port.mjs");
    mkdirSync(dirname(stagedBridge),{recursive:true});
    writeFileSync(stagedBridge,ownerBridge);
    if(sha(stagedUi)!==publicSha||sha(stagedBridge)!==bridgeSha||
       sha(privateServer)!==before||sha(oldUi)!==originalUiSha)
      fail("SOURCE_MUTATION_OR_UI_MISMATCH");
    if(existsSync(output))fail("OUTPUT_ALREADY_EXISTS");
    renameSync(temporary,output);
    return Object.freeze({
      schema:"iwxa.t3.original-control-consumer-stage/1",
      source:"ORIGINAL_PRIVATE_CONTROL_EXTERNAL",
      uiServerOwner:"Faust-S/knowledge/packages/t3-core",
      installedUiSha256:publicSha,
      installedSignedOwnerBridgeSha256:bridgeSha,
      t3PublicCoreArgument:"STAGED_CONTROL_ROOT",
      privateCheckoutUnmodified:true,
      originalSignedOwnerUnmodified:true,
      separateKernelOrStoreCreated:false,
      qualifiesRealSigner:false,
      stagedSourceFiles:copied,
      qualificationStaged:includeQualifications,
    });
  }catch(e){
    rmSync(temporary,{recursive:true,force:true});
    throw e;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4&&process.argv.length!==5)
    fail("USAGE_ORIGINAL_CONTROL_OUTPUT_OPTIONAL_QUALIFY");
  const qualify=process.argv[4]==="--qualify";
  if(process.argv.length===5&&!qualify)fail("UNKNOWN_OPTION");
  const receipt=stageOriginalControlConsumer({
    originalControlRoot:process.argv[2],outputRoot:process.argv[3],
    includeQualifications:qualify,
  });
  process.stdout.write(JSON.stringify(receipt)+"\n");
}
