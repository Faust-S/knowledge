const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const keys=(value,expected)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
const fail=code=>{throw Object.assign(Error(code),{code});};

export function requireT4OriginalObjectCatalog(enabled,originalKernel,pageSize=16){
  if(typeof enabled!=='boolean'||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024||
    (enabled&&!['listObjects','listObjectWindow'].every(name=>
      originalKernel?.hasOperation?.('t1.'+name)===true&&typeof originalKernel[name]==='function')))
    fail('ORIGINAL_OBJECT_CATALOG_PORTS_REQUIRED');
}

// The original Kernel owns each keyset page. No lock, Store, authority, or
// multi-page snapshot is created here. Callers must retain their original
// exclusion/readback rules. Only one page's unrelated Object bodies is kept.
export async function visitT4OriginalObjectCatalog({originalKernel,workspaceId,schemaId,
  includeDeleted=true,authorizeOriginalOperation,visitOriginalObject,pageSize=16}={}){
  requireT4OriginalObjectCatalog(true,originalKernel,pageSize);
  if(!ID(workspaceId)||(schemaId!==undefined&&!ID(schemaId))||typeof includeDeleted!=='boolean'||
    typeof authorizeOriginalOperation!=='function'||typeof visitOriginalObject!=='function')
    fail('ORIGINAL_OBJECT_CATALOG_PORTS_REQUIRED');
  let after=null,count=0;
  async function authorize(query){
    for(const operation of ['t1.listObjects','t1.listObjectWindow']){
      if(originalKernel.hasOperation(operation)!==true||await authorizeOriginalOperation(operation,query)!==true)
        fail('ORIGINAL_OBJECT_CATALOG_READ_DENIED');
    }
  }
  for(;;){
    const query=Object.freeze({workspace_id:workspaceId,include_deleted:includeDeleted,
      ...(schemaId===undefined?{}:{schema_id:schemaId}),after_object_id:after,limit:pageSize});
    await authorize(query);
    const page=structuredClone(await originalKernel.listObjectWindow(query));
    await authorize(query);
    if(!keys(page,['entries','next_after_object_id','has_more','order'])||page.order!=='WORKSPACE_OBJECT_ID_ASC'||
      typeof page.has_more!=='boolean'||!Array.isArray(page.entries)||page.entries.length>pageSize||
      (page.has_more&&page.entries.length!==pageSize)||(after!==null&&!page.entries.length)||
      !Number.isSafeInteger(count+page.entries.length))fail('ORIGINAL_OBJECT_CATALOG_PAGE_INVALID');
    let last=after;
    for(const row of page.entries){
      if(row?.workspace_id!==workspaceId||!ID(row.object_id)||!ID(row.schema_id)||
        (row.deleted!==undefined&&typeof row.deleted!=='boolean')||(!includeDeleted&&row.deleted===true)||
        (schemaId!==undefined&&row.schema_id!==schemaId)||(last!==null&&row.object_id<=last))
        fail('ORIGINAL_OBJECT_CATALOG_PAGE_INVALID');
      last=row.object_id;
    }
    if(page.next_after_object_id!==last)fail('ORIGINAL_OBJECT_CATALOG_PAGE_INVALID');
    for(const row of page.entries)await visitOriginalObject(row);
    await authorize(query);
    count+=page.entries.length;
    if(!page.has_more)return count;
    after=last;
  }
}
