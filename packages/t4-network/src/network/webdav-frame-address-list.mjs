import {SaxesParser} from 'saxes';
import {createHash} from 'node:crypto';

// A bounded, read-only interpretation of RFC 4918 Depth:1 multistatus.
// Never use a server-supplied href as a subsequent request URL.
const fail=code=>{throw Object.assign(Error(code),{code});};
export const MAX_T4_FRAME_LIST_BYTES=4*1024*1024;
const MAX_RESPONSES=8192,MAX_DEPTH=24,MAX_HREF=2048;
const KEY=/^[a-f0-9]{64}\.t4n$/;
const dav=(tag,local)=>tag?.uri==='DAV:'&&tag.local===local;
const digest=keys=>createHash('sha256').update('IWXA-T4-FRAME-ADDRESS-LIST-V1\0')
  .update(JSON.stringify(keys)).digest('hex');
function directResource(raw,base){
  if(typeof raw!=='string'||!raw||raw.length>MAX_HREF||
    /[\x00-\x20\x7f\\?#]/.test(raw)||
    /%2f|%5c|%00/i.test(raw)||/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(raw)||
    !(raw.startsWith('/')&&!raw.startsWith('//')||/^https?:\/\//i.test(raw)))
    fail('DAV_FRAME_LIST_HREF_INVALID');
  let url,path,root;
  try{
    url=new URL(raw,base);
    path=decodeURIComponent(url.pathname);
    root=decodeURIComponent(base.pathname);
  }catch{fail('DAV_FRAME_LIST_HREF_INVALID');}
  if(url.origin!==base.origin||url.username||url.password||url.search||url.hash||
    /[\x00-\x1f\x7f\\]/.test(path)||!root.endsWith('/'))
    fail('DAV_FRAME_LIST_HREF_INVALID');
  if(path===root||path===root.slice(0,-1))return {root:true,path:root,key:null};
  if(!path.startsWith(root))fail('DAV_FRAME_LIST_SCOPE_MISMATCH');
  const child=path.slice(root.length),name=child.endsWith('/')?child.slice(0,-1):child;
  if(!name||name.includes('/')||name==='.'||name==='..')
    fail('DAV_FRAME_LIST_NOT_DIRECT_CHILD');
  return {root:false,path:root+name,key:KEY.test(name)?name:null};
}
export function decodeT4WebDavFrameAddressList(bytes,baseUrl){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_T4_FRAME_LIST_BYTES)
    fail('DAV_FRAME_LIST_SIZE_INVALID');
  let base,xml;
  try{base=new URL(baseUrl);xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{fail('DAV_FRAME_LIST_XML_INVALID');}
  let rootSeen=false,rootClosed=false,current=null,propstat=null,capture=null,responseCount=0;
  const stack=[],seen=new Set(),keys=[];
  const parser=new SaxesParser({xmlns:true});
  parser.on('doctype',()=>fail('DAV_FRAME_LIST_DTD_FORBIDDEN'));
  parser.on('error',()=>fail('DAV_FRAME_LIST_XML_INVALID'));
  parser.on('opentag',tag=>{
    const parent=stack.at(-1),depth=stack.length;
    if(depth>=MAX_DEPTH||capture)fail('DAV_FRAME_LIST_XML_INVALID');
    if(depth===0){
      if(rootSeen||!dav(tag,'multistatus'))fail('DAV_FRAME_LIST_XML_INVALID');
      rootSeen=true;
    }else if(depth===1&&dav(tag,'response')&&dav(parent,'multistatus')){
      if(++responseCount>MAX_RESPONSES)fail('DAV_FRAME_LIST_TOO_MANY_RESPONSES');
      current={href:null,status:null,types:[]};
    }else if(current&&depth===2&&dav(parent,'response')){
      if(dav(tag,'href')||dav(tag,'status')){
        const field=tag.local;
        if(current[field]!==null)fail('DAV_FRAME_LIST_DUPLICATE_FIELD');
        capture={target:current,field,text:''};
      }else if(dav(tag,'propstat'))propstat={status:null,type:null,propSeen:false,typeChildSeen:false};
    }else if(propstat&&depth===3&&dav(parent,'propstat')){
      if(dav(tag,'status')){
        if(propstat.status!==null)fail('DAV_FRAME_LIST_DUPLICATE_FIELD');
        capture={target:propstat,field:'status',text:''};
      }else if(dav(tag,'prop')){
        if(propstat.propSeen)fail('DAV_FRAME_LIST_DUPLICATE_FIELD');
        propstat.propSeen=true;
      }
    }else if(propstat&&depth===4&&dav(parent,'prop')&&dav(tag,'resourcetype')){
      if(propstat.type!==null)fail('DAV_FRAME_LIST_DUPLICATE_FIELD');
      propstat.type='FILE';
    }else if(propstat&&depth===5&&dav(parent,'resourcetype')){
      // An extension resource type is not a plain immutable file.
      if(propstat.typeChildSeen)fail('DAV_FRAME_LIST_RESOURCE_TYPE_UNPROVEN');
      propstat.typeChildSeen=true;
      propstat.type=dav(tag,'collection')?'COLLECTION':'OTHER';
    }
    stack.push(tag);
  });
  const chars=value=>{
    if(capture){
      capture.text+=value;
      if(capture.text.length>MAX_HREF)fail('DAV_FRAME_LIST_HREF_INVALID');
    }else if(dav(stack.at(-1),'resourcetype')&&value.trim())
      fail('DAV_FRAME_LIST_RESOURCE_TYPE_UNPROVEN');
  };
  parser.on('text',chars);
  parser.on('cdata',chars);
  parser.on('closetag',tag=>{
    const depth=stack.length-1;
    if(capture&&((depth===2&&dav(tag,capture.field))||
      (depth===3&&capture.target===propstat&&dav(tag,'status')))){
      capture.target[capture.field]=capture.text.trim();
      capture=null;
    }
    if(propstat&&depth===2&&dav(tag,'propstat')){
      if(typeof propstat.status!=='string'||!/^HTTP\/\d+(?:\.\d+)? \d{3}(?: .*)?$/.test(propstat.status))
        fail('DAV_FRAME_LIST_STATUS_INVALID');
      if(/^HTTP\/\d+(?:\.\d+)? 200(?: |$)/.test(propstat.status)&&propstat.type!==null)
        current.types.push(propstat.type);
      propstat=null;
    }
    if(current&&depth===1&&dav(tag,'response')){
      if(current.status!==null&&!/^HTTP\/\d+(?:\.\d+)? 200(?: |$)/.test(current.status))
        fail('DAV_FRAME_LIST_RESPONSE_INCOMPLETE');
      const row=directResource(current.href,base);
      if(seen.has(row.path))fail('DAV_FRAME_LIST_DUPLICATE_RESOURCE');
      seen.add(row.path);
      if(current.types.length!==1)fail('DAV_FRAME_LIST_RESOURCE_TYPE_UNPROVEN');
      const type=current.types[0];
      if(row.root){
        if(rootClosed||type!=='COLLECTION')fail('DAV_FRAME_LIST_ROOT_INVALID');
        rootClosed=true;
      }else if(row.key&&type==='FILE')keys.push(row.key);
      else if(row.key)fail('DAV_FRAME_LIST_FRAME_NOT_FILE');
      current=null;
    }
    stack.pop();
  });
  try{parser.write(xml).close();}
  catch(error){if(typeof error?.code==='string'&&error.code.startsWith('DAV_FRAME_LIST_'))throw error;
    fail('DAV_FRAME_LIST_XML_INVALID');}
  if(!rootSeen||!rootClosed||stack.length||current||propstat||capture)
    fail('DAV_FRAME_LIST_RESPONSE_INCOMPLETE');
  keys.sort();
  const addresses=Object.freeze(keys.map(key=>Object.freeze({key,sha256:key.slice(0,-4)})));
  return Object.freeze({schema:'IWXA_T4_NATIVE_FRAME_ADDRESS_LIST_V1',addresses,
    listingDigest:digest(keys),collectionEnumerated:true,
    addressMetadataIsNotSignatureOrAuthority:true,originalBusinessApplied:false});
}
