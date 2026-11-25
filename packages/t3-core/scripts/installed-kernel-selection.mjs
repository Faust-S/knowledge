// Existing original accepted-release verifier plus explicitly selected, pinned
// qualification-only successor. This is build orchestration, never a runtime loader.
import {assertQualifiedKernelArtifact} from '../src/factory2/products/domain-completion/independent-browser-witness.mjs';
import {BASE_KERNEL_ARTIFACT,assertQualificationKernelCandidate,
  selectQualificationKernelCandidate} from './installed-kernel-candidate.mjs';

export function assertInstalledOriginalKernelArtifact(root,qualificationKernelCandidate){
  return qualificationKernelCandidate===undefined
    ?assertQualifiedKernelArtifact(root,{kernel:'0.3.6',contract:'1.3.0',artifactId:BASE_KERNEL_ARTIFACT})
    :assertQualificationKernelCandidate(root,qualificationKernelCandidate);
}

// One explicit trailing CLI pair. All legacy argument layouts remain valid;
// malformed, repeated or unknown pairs are rejected by the calling CLI.
export function takeQualificationKernelCandidate(args){
  if(args.at(-2)!=='--qualification-kernel-candidate')return undefined;
  const requested=args.pop();args.pop();
  selectQualificationKernelCandidate(requested);
  return requested;
}
