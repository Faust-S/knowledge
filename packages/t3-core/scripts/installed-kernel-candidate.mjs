// Build-time qualification selector only. Not a new Kernel or release registry.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export const BASE_KERNEL_ARTIFACT='iwxa-kernel-k036-same-store-history-20261019-qualified.1';
export const CANDIDATE_KERNEL_ARTIFACT='iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1';
const pin=Object.freeze({
  artifactId:CANDIDATE_KERNEL_ARTIFACT,baseQualifiedArtifactId:BASE_KERNEL_ARTIFACT,
  kernel:'0.3.6',contract:'1.3.0',releaseAccepted:false,productionActivation:false,
  sourceCommit:'4e4ad5c5e566a74f24243b9d0744a6d64652a199',
  archiveSha256:'5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a',
  files:Object.freeze([
    Object.freeze({path:'_iwxa/loader.js',sha256:'f38f9e716dab71b37b41d74864a55f69d064eacb85ed8a43adbd234376f30126'}),
    Object.freeze({path:'_iwxa/validator.js',sha256:'457fee8f254eb061b9184c5bfcaeb31a3348c8f8b9fc9eee4755eb6bab16eba9'}),
    Object.freeze({path:'_iwxa/current.json',sha256:'862e003a1b932e7ba20fa06a950404b4c565258e80c77365902b8e718847ee13'}),
    Object.freeze({path:'_iwxa/runtime/0.3.6/runtime.js',sha256:'559e8dd74988144733394114b020ea89a78d49ae5bbc8d49faafb86f9325c1e7'}),
  ]),
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const deny=code=>{throw Error('T3_INSTALLED_KERNEL_CANDIDATE_'+code);};

// Never infer a candidate from a runtime hash or an environment flag. Both
// the explicit immutable artifact ID and the disposable qualification context
// are necessary. The accepted-release selector remains separate and unchanged.
export function selectQualificationKernelCandidate(requested,env=process.env){
  if(requested===undefined)return null;
  if(requested!==CANDIDATE_KERNEL_ARTIFACT)deny('ID_INVALID');
  const allowed=(env.GITHUB_REPOSITORY==='Faust-S/Center'&&
      ['refs/heads/work/2026-11-24-corporate-installed-one-core',
       'refs/heads/work/2026-11-27-t4-native-pilot-k036'].includes(env.GITHUB_REF))||
    (env.GITHUB_REPOSITORY==='Faust-S/knowledge'&&
      env.GITHUB_REF==='refs/heads/work/2026-11-25-k036-corporate-event-qualification');
  if(env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||!allowed)
    deny('DISPOSABLE_PUBLIC_QUALIFICATION_REQUIRED');
  return pin;
}

function exactRegularFile(root,path){
  const file=resolve(root,path);
  // Pin the fixed inventory, not caller-provided paths. Refuse symlinked
  // file/directory components, including a symlinked input root itself.
  for(let at=file;;at=dirname(at)){
    if(!existsSync(at)||lstatSync(at).isSymbolicLink())deny('FILE_PATH_INVALID');
    if(at===root)break;
    if(dirname(at)===at)deny('FILE_PATH_INVALID');
  }
  if(!lstatSync(file).isFile())deny('FILE_PATH_INVALID');
  return file;
}

export function assertQualificationKernelCandidate(root,requested){
  const selected=selectQualificationKernelCandidate(requested);
  if(!selected)deny('EXPLICIT_SELECTION_REQUIRED');
  const absolute=resolve(root);
  if(!existsSync(absolute)||lstatSync(absolute).isSymbolicLink()||
     !lstatSync(absolute).isDirectory())deny('DIST_ROOT_INVALID');
  const canonical=realpathSync(absolute);
  // Resolve the real parent once, while checking the paths inside that root.
  // On Windows a temporary directory may have a case-normalized spelling.
  for(const item of selected.files){
    if(sha(readFileSync(exactRegularFile(canonical,item.path)))!==item.sha256)
      deny('FILE_DIGEST_MISMATCH:'+item.path);
  }
  return Object.freeze({...selected,artifactSha256:sha(Buffer.from(JSON.stringify(selected.files)))});
}

export function qualificationKernelCandidateFields(selected){
  if(selected?.releaseAccepted!==false)return {};
  return {original_kernel_candidate_artifact:selected.artifactId,
    original_kernel_candidate_archive_sha256:selected.archiveSha256,
    original_kernel_release_accepted:false};
}
