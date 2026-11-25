import test from 'node:test';
import assert from 'node:assert/strict';
import {visitT4OriginalObjectCatalog,requireT4OriginalObjectCatalog} from '../src/network/original-object-catalog-pages.mjs';
const ws='ws:technical',ops=['t1.listObjects','t1.listObjectWindow'];
const row=(i,patch={})=>({workspace_id:ws,object_id:'object:'+String(i).padStart(6,'0'),schema_id:'iwxa.demo.note',...patch});
const page=(entries,has_more=false,after=null)=>({entries,next_after_object_id:entries.at(-1)?.object_id??after,has_more,order:'WORKSPACE_OBJECT_ID_ASC'});
function fixture(rows,size=2){
  const calls=[],seen=[],rights=[],allowed=new Set(ops);
  const originalKernel={hasOperation:op=>allowed.has(op),listObjects:async()=>{throw Error('legacy catalog forbidden');},
    listObjectWindow:async query=>{calls.push(query);const start=query.after_object_id===null?0:rows.findIndex(r=>r.object_id===query.after_object_id)+1;
      assert.ok(query.after_object_id===null||start>0);const selected=rows.slice(start,start+query.limit);return page(selected,start+selected.length<rows.length,query.after_object_id);}};
  const args={originalKernel,workspaceId:ws,pageSize:size,authorizeOriginalOperation:async(op,q)=>{rights.push([op,q]);return allowed.has(op);},
    visitOriginalObject:async r=>{seen.push(r.object_id);}};
  return {args,originalKernel,calls,seen,rights,allowed};
}
test('keyset catalog visits every row once and checks both original rights before and after each page and visitor',async()=>{
  const f=fixture([row(1),row(2),row(3)]);assert.equal(await visitT4OriginalObjectCatalog(f.args),3);
  assert.deepEqual(f.seen,[row(1).object_id,row(2).object_id,row(3).object_id]);
  assert.deepEqual(f.calls.map(q=>q.after_object_id),[null,row(2).object_id]);
  assert.deepEqual(f.rights.map(x=>x[0]),Array.from({length:6},()=>ops).flat());
  assert.ok(f.calls.every(q=>q.workspace_id===ws&&q.include_deleted===true&&q.limit===2));
});
test('catalog traverses 100001 original Objects in bounded pages without a full array result',async()=>{
  const count=100001,calls=[],kernel={hasOperation:()=>true,listObjects:async()=>{throw Error('legacy forbidden');},
    listObjectWindow:async q=>{const start=q.after_object_id===null?0:Number(q.after_object_id.slice(7))+1;
      const entries=Array.from({length:Math.min(q.limit,count-start)},(_,i)=>row(start+i));calls.push(entries.length);return page(entries,start+entries.length<count,q.after_object_id);}};
  let visited=0;assert.equal(await visitT4OriginalObjectCatalog({originalKernel:kernel,workspaceId:ws,pageSize:1024,
    authorizeOriginalOperation:async()=>true,visitOriginalObject:r=>{assert.equal(r.object_id,row(visited++).object_id);}}),count);
  assert.equal(visited,count);assert.equal(calls.length,98);assert.equal(Math.max(...calls),1024);
});
test('page validation rejects foreign workspace, malformed identity, duplicate, backwards and false continuation',async()=>{
  const bad=[page([row(1,{workspace_id:'foreign'})]),page([row(1,{schema_id:''})]),page([row(1,{deleted:'false'})]),
    page([row(1),row(1)]),page([row(2),row(1)]),page([row(1)],true),{...page([row(1)]),next_after_object_id:row(2).object_id},
    {...page([row(1)]),order:'UNKNOWN'}];
  for(const p of bad){const f=fixture([]);f.originalKernel.listObjectWindow=async()=>p;
    await assert.rejects(visitT4OriginalObjectCatalog(f.args),{code:'ORIGINAL_OBJECT_CATALOG_PAGE_INVALID'});assert.deepEqual(f.seen,[]);}
});
test('schema and live-object filters cannot be bypassed by a page',async()=>{
  for(const r of [row(1,{schema_id:'other'}),row(1,{deleted:true})]){const f=fixture([r]);
    await assert.rejects(visitT4OriginalObjectCatalog({...f.args,schemaId:'iwxa.demo.note',includeDeleted:false}),{code:'ORIGINAL_OBJECT_CATALOG_PAGE_INVALID'});}
});
test('a missing continuation is not evidence of catalog exhaustion',async()=>{
  const f=fixture([row(1),row(2),row(3)]);const read=f.originalKernel.listObjectWindow;
  f.originalKernel.listObjectWindow=q=>q.after_object_id===null?read(q):page([],false,q.after_object_id);
  await assert.rejects(visitT4OriginalObjectCatalog(f.args),{code:'ORIGINAL_OBJECT_CATALOG_PAGE_INVALID'});
  const g=fixture([]);assert.equal(await visitT4OriginalObjectCatalog(g.args),0);
});
test('missing rights, revocation during page or visitor, and lost continuation never fall back',async()=>{
  for(const op of ops){const f=fixture([row(1)]);f.allowed.delete(op);
    assert.throws(()=>requireT4OriginalObjectCatalog(true,f.originalKernel),{code:'ORIGINAL_OBJECT_CATALOG_PORTS_REQUIRED'});
    f.allowed.add(op);const read=f.originalKernel.listObjectWindow;f.originalKernel.listObjectWindow=async q=>{const p=await read(q);f.allowed.delete(op);return p;};
    await assert.rejects(visitT4OriginalObjectCatalog(f.args),{code:'ORIGINAL_OBJECT_CATALOG_READ_DENIED'});assert.equal(f.seen.length,0);
    f.allowed.add(op);f.originalKernel.listObjectWindow=read;
    await assert.rejects(visitT4OriginalObjectCatalog({...f.args,visitOriginalObject:()=>{f.allowed.delete(op);}}),{code:'ORIGINAL_OBJECT_CATALOG_READ_DENIED'});}
  const f=fixture([row(1),row(2),row(3)]),read=f.originalKernel.listObjectWindow;
  f.originalKernel.listObjectWindow=q=>q.after_object_id===null?read(q):Promise.reject(Error('lost continuation'));
  await assert.rejects(visitT4OriginalObjectCatalog(f.args),/lost continuation/);
});
