/**
 * T4 uses the original Host lifetime predicate (the same synchronous
 * invalidation boundary used by T3 native owner ports). No task, scheduler,
 * store, key or authority is created here.
 */
export function originalHostLifetimeMode(getMode,isHostActive,errorCode='ORIGINAL_HOST_LIFETIME_ENDED'){
  if(typeof getMode!=='function'||typeof isHostActive!=='function')
    throw Object.assign(Error('ORIGINAL_HOST_LIFETIME_PORT_REQUIRED'),{code:'ORIGINAL_HOST_LIFETIME_PORT_REQUIRED'});
  let ended=false;
  const requireActive=()=>{
    if(!ended){
      try{if(isHostActive()!==true)ended=true;}
      catch{ended=true;}
    }
    if(ended)throw Object.assign(Error(errorCode),{code:errorCode,
      details:Object.freeze({automaticRetryAllowed:false,originalOutcomeMayExist:true})});
  };
  return ()=>{
    requireActive();
    const mode=getMode();
    requireActive();
    return mode;
  };
}
/** Scope an existing original port, retaining its identity and ledger.
 * A copied or substituted advertised identity must not be normalized away
 * when reconstructing its closure for a particular original Host lifetime.
 */
export function scopeOriginalHostPort(port,isHostActive,fields,errorCode){
  const fail=()=>{throw Object.assign(Error(errorCode),{code:errorCode});};
  if(typeof port?.forOriginalHostLifetime!=='function')fail();
  const scoped=port.forOriginalHostLifetime(isHostActive);
  if(!scoped||fields.some(key=>JSON.stringify(scoped[key])!==JSON.stringify(port[key])))fail();
  return scoped;
}
