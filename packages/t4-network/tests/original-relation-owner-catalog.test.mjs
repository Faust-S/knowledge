import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveT4OriginalRelationOwnerFromCatalog} from '../src/network/original-object-catalog-pages.mjs';
const ws='ws:source',rel='relation:target',row=i=>({workspace_id:ws,object_id:'object:'+String(i).padStart(5,'0'),schema_id:'iwxa.demo.note',revision:1,deleted:false,data:{n:i}});
function fixture(n=3,owners=[n-1]){
  const rows=Array.from({length:n},(_,i)=>row(i)),objects=new Map(rows.map(r=>[r.object_id,r])),outgoing=new Map(owners.map(i=>[row(i).object_id,[{workspace_id:ws,relation_id:rel,from_object_id:row(i).object_id,to_object_id:row(0).object_id}]]));
  const rights=new Set(['t1.listObjects','t1.listObjectWindow','t1.getObject']),calls=[],reads=[],proofs=[];
  const kernel={hasOperation:op=>rights.has(op),listObjects:async()=>{throw Error('legacy forbidden');},
    listObjectWindow:async q=>{calls.push(q);const start=q.after_object_id===null?0:Number(q.after_object_id.slice(7))+1,entries=rows.slice(start,start+q.limit);
      return {entries,next_after_object_id:entries.at(-1)?.object_id??q.after_object_id,has_more:start+entries.length<rows.length,order:'WORKSPACE_OBJECT_ID_ASC'};},
    getObject:async(w,id)=>{assert.equal(w,ws);reads.push(id);return {object:structuredClone(objects.get(id)),relations:{outgoing:structuredClone(outgoing.get(id)??[]),incoming:[]}};}};
  const args={originalKernel:kernel,workspaceId:ws,relationId:rel,pageSize:256,authorizeOriginalOperation:async(op,scope)=>{proofs.push([op,scope]);return rights.has(op);}};
  return {args,kernel,rows,objects,outgoing,rights,calls,reads,proofs};
}
test('relation owner is resolved uniquely beyond the old 4096 object ceiling',async()=>{
  const f=fixture(4097);assert.equal(await resolveT4OriginalRelationOwnerFromCatalog(f.args),row(4096).object_id);
  assert.equal(f.calls.length,17);assert.equal(f.reads.length,4097);assert.ok(f.calls.every(q=>q.include_deleted===false));
  assert.equal(f.proofs.filter(p=>p[0]==='t1.getObject').length,4097*2+1);
});
test('missing or ambiguous relation owner never authorizes deletion',async()=>{
  for(const owners of [[],[0,2]]){const f=fixture(3,owners);
    await assert.rejects(resolveT4OriginalRelationOwnerFromCatalog(f.args),{code:'NATIVE_LOCAL_RELATION_OWNER_NOT_UNIQUE'});}
});
test('foreign relation endpoints and changed original object receipts are denied',async()=>{
  const f=fixture();f.outgoing.get(row(2).object_id)[0].from_object_id='foreign';
  await assert.rejects(resolveT4OriginalRelationOwnerFromCatalog(f.args),{code:'NATIVE_LOCAL_RELATION_OWNER_SCOPE_MISMATCH'});
  const g=fixture();g.objects.set(row(1).object_id,{...row(1),revision:2});
  await assert.rejects(resolveT4OriginalRelationOwnerFromCatalog(g.args),{code:'NATIVE_LOCAL_RELATION_OWNER_READ_INVALID'});
});
test('revocation while reading original relation or catalog prevents returning even an earlier match',async()=>{
  const f=fixture(3,[0]),read=f.kernel.getObject;
  f.kernel.getObject=async(...args)=>{const result=await read(...args);if(args[1]===row(1).object_id)f.rights.delete('t1.getObject');return result;};
  await assert.rejects(resolveT4OriginalRelationOwnerFromCatalog(f.args),{code:'NATIVE_LOCAL_RELATION_OWNER_READ_DENIED'});
  const g=fixture(3,[0]);g.args.pageSize=1;const page=g.kernel.listObjectWindow;
  g.kernel.listObjectWindow=async q=>{if(q.after_object_id!==null)g.rights.delete('t1.listObjectWindow');return page(q);};
  await assert.rejects(resolveT4OriginalRelationOwnerFromCatalog(g.args),{code:'ORIGINAL_OBJECT_CATALOG_READ_DENIED'});
});
