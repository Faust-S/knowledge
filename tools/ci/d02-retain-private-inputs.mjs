// Exact private D02 retention via the normal authorized Git Data API.
// Never output tokens, response bodies, private paths or prepared bytes.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {TextDecoder} from 'node:util';

const repo='Faust-S/club.iwxa.ru';
const target='heads/work/2026-11-25-club-t3-final-qualified-inputs';
const candidate='c1b02ba9f2b65175be91faa6476fd8d079b62e1f';
const root='runtime/t3-platform/0.3.1-rc.1/';
const shaOK=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const require=(ok,code)=>{if(!ok)throw Error(code)};
const git=(args,encoding='utf8')=>execFileSync('git',args,{encoding,maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
const blobHash=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
export function category(status,remaining,retry,message=''){
 if(status===429||status===403&&(remaining==='0'||!!retry||/rate limit|abuse detection/i.test(message)))return 'RATE_LIMIT';
 if(status===401)return 'AUTHENTICATION_DENIED';
 if(status===403){
  if(/protected branch|repository rule|GH013|GH006/i.test(message))return 'REF_RULE';
  return /resource not accessible|permission|forbidden|not authorized|must have .*access|denied/i.test(message)?'ACCESS_DENIED':'HTTP_403_UNCLASSIFIED';
 }
 if(status===404)return 'NOT_FOUND_OR_NOT_AUTHORIZED';
 if(status===409||status===422)return /protected branch|repository rule|GH013|GH006/i.test(message)?'REF_RULE':'CONFLICT_OR_VALIDATION';
 if(status===413)return 'REQUEST_TOO_LARGE';
 if([408,500,502,503,504].includes(status))return 'TRANSIENT';
 return 'HTTP_FAILURE';
}
async function api(stage,method,path,body){
 const token=process.env.GH_TOKEN;
 require(token&&token.length>10,'TOKEN_MISSING');
 const base='https://api.github.com/repos/'+repo;
 let r;
 try{
  r=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(120000),
   headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','content-type':'application/json','user-agent':'IWXA-D02-private-retention/1'},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 }catch{console.log('D02_RETENTION_API_RESULT=NETWORK; stage='+stage);throw Error('API_NETWORK')}
 let data;try{data=await r.json()}catch{throw Error('API_RESPONSE_FORMAT')}
 if(!r.ok){
  const cls=category(r.status,r.headers.get('x-ratelimit-remaining'),r.headers.get('retry-after'),typeof data?.message==='string'?data.message:'');
  console.log('D02_RETENTION_API_RESULT='+cls+'; stage='+stage+'; http='+r.status);
  throw Error('API_REJECTED');
 }
 return data;
}
async function exactTarget(){
 const metadata=await api('repository','GET','');
 require(metadata.private===true&&metadata.full_name===repo,'PRIVATE_REPOSITORY_REQUIRED');
 const ref=await api('ref-read','GET','/git/ref/'+target);
 require(ref.ref==='refs/'+target&&ref.object?.sha===candidate,'TARGET_HEAD_UNEXPECTED');
 return ref;
}
export async function probe(){
 await exactTarget();
 // Create a harmless unreferenced blob to exercise Contents write, then
 // exercise the existing isolated ref with the same SHA and force=false.
 const content='IWXA D02 private retention write probe v1\n';
 const blob=await api('blob-write-probe','POST','/git/blobs',{content,encoding:'utf-8'});
 require(blob.sha===blobHash(Buffer.from(content)),'PROBE_BLOB_MISMATCH');
 const ref=await api('ref-write-probe','PATCH','/git/refs/'+target,{sha:candidate,force:false});
 require(ref.ref==='refs/'+target&&ref.object?.sha===candidate,'PROBE_REF_MISMATCH');
 await exactTarget();
 console.log('D02_RETENTION_WRITE_PROBE=PASS; target_unchanged=true');
}
export function validateEntries(rows){
 require(rows.length===92,'UNEXPECTED_RETAINED_FILE_COUNT');
 const names=new Set(),roots=new Set();
 for(const row of rows){
  require(row.path.startsWith(root)&&!names.has(row.path),'UNEXPECTED_PATH');
  const rest=row.path.slice(root.length),top=rest.split('/')[0];
  require(['club-host','kernel-support','platform-inputs.zip'].includes(top),'UNEXPECTED_ROOT');
  require(top==='platform-inputs.zip'?rest===top:rest.startsWith(top+'/'),'ROOT_TYPE');
  require(!row.path.split('/').some(p=>!p||p==='.'||p==='..'||/^(?:\.env|\.git$|node_modules$|\.npmrc$|\.ssh$)/.test(p)),'FORBIDDEN_PATH');
  require(!/\.(?:map|log|iwxa|pem|key|pfx|gguf|safetensors)$/i.test(row.path),'FORBIDDEN_EXTENSION');
  require(['100644','100755'].includes(row.mode)&&shaOK(row.sha),'INVALID_BLOB_ENTRY');
  names.add(row.path);roots.add(top);
 }
 require(roots.size===3,'MISSING_INPUT_ROOT');
}
async function retain(){
 await exactTarget();
 require(git(['rev-parse','HEAD']).trim()===candidate,'SOURCE_HEAD_MISMATCH');
 const parentTree=git(['rev-parse','HEAD^{tree}']).trim();
 const expectedTree=git(['write-tree']).trim();
 require(shaOK(parentTree)&&shaOK(expectedTree)&&parentTree!==expectedTree,'INVALID_TREE');
 const rows=git(['diff','--cached','--name-status','-z','HEAD']).split('\0').filter(Boolean);
 require(rows.length===184,'UNEXPECTED_STAGE');
 const paths=[];
 for(let i=0;i<rows.length;i+=2){require(rows[i]==='A','NOT_ADDITION');paths.push(rows[i+1])}
 const all=git(['ls-files','--stage','-z','--',root+'club-host',root+'kernel-support',root+'platform-inputs.zip']).split('\0').filter(Boolean);
 const entries=all.map(s=>{
  const m=s.match(/^([0-9]{6}) ([a-f0-9]{40}) 0\t(.+)$/);
  require(m,'INVALID_INDEX_ENTRY');return {mode:m[1],sha:m[2],path:m[3]};
 });
 validateEntries(entries);
 require(paths.length===entries.length&&paths.every(p=>entries.some(e=>e.path===p)),'STAGED_PATH_MISMATCH');
 const originals=await api('parent-read','GET','/git/commits/'+candidate);
 require(originals.tree?.sha===parentTree,'PARENT_TREE_MISMATCH');
 let tree=parentTree,pending=[],pendingSize=0,blobWrites=0,treeWrites=0;
 async function flush(){
  if(!pending.length)return;
  const response=await api('tree-write','POST','/git/trees',{base_tree:tree,tree:pending});
  require(shaOK(response.sha),'TREE_RESPONSE');
  tree=response.sha;pending=[];pendingSize=0;treeWrites++;
 }
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 for(const e of entries){
  const bytes=git(['cat-file','blob',e.sha],null);
  require(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=95*1024*1024&&blobHash(bytes)===e.sha,'BLOB_BYTES_MISMATCH');
  const entry={path:e.path,mode:e.mode,type:'blob'};
  let content=null;
  if(bytes.length<=1024*1024&&!bytes.includes(0)){
   try{const s=decoder.decode(bytes);if(Buffer.from(s,'utf8').equals(bytes))content=s}catch{}
  }
  if(content!==null){entry.content=content}
  else{
   const b=await api('blob-write','POST','/git/blobs',{content:bytes.toString('base64'),encoding:'base64'});
   require(b.sha===e.sha,'REMOTE_BLOB_MISMATCH');entry.sha=b.sha;blobWrites++;
  }
  const size=Buffer.byteLength(JSON.stringify(entry));
  if(pendingSize+size>4*1024*1024)await flush();
  pending.push(entry);pendingSize+=size;
 }
 await flush();
 require(tree===expectedTree,'REMOTE_TREE_MISMATCH');
 const run=process.env.GITHUB_RUN_ID;
 require(/^[0-9]+$/.test(run||''),'RUN_ID');
 const commit=await api('commit-write','POST','/git/commits',{message:'Retain qualified Club T3 inputs for run '+run+' [skip ci]',tree,parents:[candidate]});
 require(shaOK(commit.sha)&&commit.tree?.sha===expectedTree&&commit.parents?.length===1&&commit.parents[0].sha===candidate,'REMOTE_COMMIT_MISMATCH');
 await exactTarget();
 const moved=await api('ref-fast-forward','PATCH','/git/refs/'+target,{sha:commit.sha,force:false});
 require(moved.ref==='refs/'+target&&moved.object?.sha===commit.sha,'REF_UPDATE_MISMATCH');
 const read=await api('ref-readback','GET','/git/ref/'+target);
 require(read.object?.sha===commit.sha,'REF_READBACK_MISMATCH');
 const saved=await api('commit-readback','GET','/git/commits/'+commit.sha);
 require(saved.tree?.sha===expectedTree&&saved.parents?.length===1&&saved.parents[0].sha===candidate,'COMMIT_READBACK_MISMATCH');
 console.log('D02_RETENTION_API_TREE_MATCH=PASS; files='+entries.length+'; blob_writes='+blobWrites+'; tree_writes='+treeWrites);
 console.log('D02_T3_QUALIFIED_INPUT_COMMIT='+commit.sha);
 console.log('D02_T3_PRIVATE_RETENTION=PASS');
}
try{
 const mode=process.argv[2];
 require(mode==='probe'||mode==='retain','USAGE');
 if(mode==='probe')await probe();else await retain();
}catch(e){
 const message=typeof e?.message==='string'&&/^[A-Z_]{1,80}$/.test(e.message)?e.message:'UNEXPECTED';
 console.log('D02_RETENTION_OPERATION=FAIL; code='+message);
 process.exitCode=1;
}
