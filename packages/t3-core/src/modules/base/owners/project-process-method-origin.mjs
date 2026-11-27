// Verification of the immutable alternative origin, through the original
// owner. Kept out of the ordinary current-method read path. No new authority.
import { canonicalStringify } from '../../../persistence/canonical-codec.mjs';
import { normalizeProject,normalizeWork,assertProjectMethodologyCreationWork } from '../features/project-process/project-process.mjs';
import { describeWorkspaceMethodSourceInputs } from '../features/workspace/workspace-project-method.mjs';
import { readHistoricalWorkspaceMethod } from './project-process-method-readback.mjs';

function fail(code,message,cause){throw Object.assign(new Error(message,cause?{cause}:undefined),{code});}

/** First Project creation (including recovery) must be an exact structural
 * fork of the selected historical method. A forged lineage is not admitted
 * even when a caller bypasses the ordinary alternative UI. */
export async function verifyProjectMethodAlternativeOrigin(owner,project){
  const origin=project?.methodology?.creation?.origin;
  if(!origin)return null;
  if(origin.workspaceId!==project.workspaceId||origin.projectId===project.projectId){
    fail('METHOD_ALTERNATIVE_ORIGIN_MISMATCH','Original alternative origin is outside the target scope');
  }
  const historical=await readHistoricalWorkspaceMethod({owner,workspaceId:origin.workspaceId,
    projectId:origin.projectId,expected:origin});
  const target={...historical.draft,projectId:project.projectId};
  const plan=describeWorkspaceMethodSourceInputs({workspaceId:project.workspaceId,draft:target});
  const creation=project.methodology.creation;
  const expected=normalizeProject({...plan.projectInput,methodology:{...plan.projectInput.methodology,creation}});
  if(canonicalStringify(expected)!==canonicalStringify(project)){
    fail('METHOD_ALTERNATIVE_ORIGIN_MISMATCH','Initial alternative Project differs from exact historical origin');
  }
  try{
    for(const work of plan.workInputs){
      const step=creation.steps.find(item=>item.workId===work.workId);
      if(!step)fail('METHOD_ALTERNATIVE_ORIGIN_MISMATCH','Initial alternative Work is missing');
      assertProjectMethodologyCreationWork(project,normalizeWork(work),step.recordId);
    }
  }catch(error){
    if(error?.code==='METHOD_ALTERNATIVE_ORIGIN_MISMATCH')throw error;
    fail('METHOD_ALTERNATIVE_ORIGIN_MISMATCH','Initial alternative Work differs from exact historical origin',error);
  }
  return historical;
}
