export const WORKSPACE_VIEW_STATE_FAMILY = 'iwxa.workspace.internal.saved-view';

function requireSafeOpaqueId(value,label){
  if(typeof value!=='string'||value.length===0||value.length>256||/[\u0000-\u001f]/u.test(value)){
    throw new TypeError(`${label} must be a safe opaque id`);
  }
  return value;
}

export function workspaceSavedViewObjectId(viewId){
  const normalized=requireSafeOpaqueId(viewId,'viewId');
  const id=`saved-view:${normalized}`;
  return requireSafeOpaqueId(id,'saved view object id');
}

export function isWorkspaceViewStateObjectRecord(record) {
  if (!record || typeof record !== 'object') return false;
  return record.schema_id === WORKSPACE_VIEW_STATE_FAMILY
    || record.schemaId === WORKSPACE_VIEW_STATE_FAMILY
    || record.family === WORKSPACE_VIEW_STATE_FAMILY;
}

export function isWorkspaceBusinessObjectRecord(record) {
  return Boolean(record && typeof record === 'object' && !isWorkspaceViewStateObjectRecord(record));
}
