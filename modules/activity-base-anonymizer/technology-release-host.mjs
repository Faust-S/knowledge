// Trusted Host composition, not an approval authority or another Exchange.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {validateTechnologyProduct} from './technology-product.mjs';
import {releaseAcceptedTechnology} from './technology-product-exchange.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const result=(status,product_sha256,extra={})=>({status,product_sha256,file_saved:false,export_confirmed:false,...extra});
const terminal=new Set(['ORIGINAL_TECHNOLOGY_RELEASED','TECHNOLOGY_SAVE_OUTCOME_UNKNOWN',
 'TECHNOLOGY_SAVE_READBACK_FAILED','TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN']);

/** The original owner resolves a fresh exact-revision disclosure decision and
 * an independently scoped, isolated release Workspace. It returns null on
 * refusal. It must not save or export during resolution. readAcceptedProduct
 * must reread the real decision on every call. A local preview, Presidio
 * report or accepted source Task cannot substitute for that decision.
 * Durable reconciliation after restart belongs to the original owner.
 */
export function createTechnologyReleaseHost({resolveOriginalRelease,subscribeInvalidation}={}){
 need(typeof resolveOriginalRelease==='function'&&typeof subscribeInvalidation==='function',
  'TECHNOLOGY_RELEASE_ORIGINAL_OWNER_REQUIRED');
 let closed=false,epoch=0,active=false;
 const completed=new Map();
 const stop=subscribeInvalidation(()=>{epoch++;});
 need(typeof stop==='function','TECHNOLOGY_RELEASE_INVALIDATION_REQUIRED');
 const port=Object.freeze({
  async reviewAndRelease(request){
   need(request&&typeof request==='object'&&!Array.isArray(request)&&
    Object.keys(request).length===2&&Object.hasOwn(request,'object_data')&&
    Object.hasOwn(request,'product_sha256')&&hex(request.product_sha256),
    'TECHNOLOGY_RELEASE_REQUEST_INVALID');
   const digest=request.product_sha256;
   need(!closed,'TECHNOLOGY_RELEASE_HOST_CLOSED');
   if(active)return result('TECHNOLOGY_RELEASE_BUSY',digest);
   active=true;
   const stamp=epoch;
   const current=()=>!closed&&stamp===epoch;
   try{
    const product=validateTechnologyProduct(request.object_data);
    need(await sha256Canonical(product)===digest,'TECHNOLOGY_RELEASE_REQUEST_CHANGED');
    need(current(),'TECHNOLOGY_NATIVE_CONTEXT_CHANGED');
    const previous=completed.get(digest);
    if(previous)return previous.epoch===stamp?{...previous.value}:
     result('TECHNOLOGY_RELEASE_RECONCILIATION_REQUIRED',digest,{file_saved:null});
    let binding;
    try{
     binding=await resolveOriginalRelease({product_sha256:digest,object_data:structuredClone(product)},current);
    }catch{
     return result('TECHNOLOGY_RELEASE_NOT_STARTED',digest);
    }
    if(!current())return result('TECHNOLOGY_RELEASE_NOT_STARTED',digest);
    if(binding===null)return result('TECHNOLOGY_RELEASE_CANCELLED',digest);
    need(binding&&typeof binding.isCurrent==='function'&&typeof binding.saveAndReadback==='function',
     'TECHNOLOGY_RELEASE_ORIGINAL_OWNER_REQUIRED');
    let value,saveDispatched=false;
    try{
     const native=await releaseAcceptedTechnology({...binding,product_sha256:digest,
      isCurrent:()=>current()&&binding.isCurrent()===true,
      saveAndReadback:async input=>{
       saveDispatched=true;
       return binding.saveAndReadback(input);
      }});
     value=result(native.status,digest,{file_saved:native.file_saved,export_confirmed:native.export_confirmed,
      ...(hex(native.package_digest)?{package_digest:native.package_digest}:{})});
    }catch{
     value=saveDispatched?result('TECHNOLOGY_SAVE_OUTCOME_UNKNOWN',digest,{file_saved:null}):
      result('TECHNOLOGY_RELEASE_NOT_STARTED',digest);
    }
    // Only a minimal receipt leaves the original Host. No bytes, owner,
    // source records, grants, manifest, Workspace id or file path.
    if(terminal.has(value.status))completed.set(digest,{epoch:stamp,value});
    return {...value};
   }finally{active=false;}
  },
 });
 return Object.freeze({port,dispose(){
  if(closed)return;
  closed=true;epoch++;
  try{stop();}finally{completed.clear();}
 }});
}
