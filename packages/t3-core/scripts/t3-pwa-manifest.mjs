// Build-time PWA metadata for the SAME T3 domain dist, not a second runtime.
// Never change the existing T3 Kernel/Store/service worker or site's favicon.
import {readFileSync,writeFileSync,existsSync,mkdirSync,rmSync} from "node:fs";
import {join,dirname} from "node:path";
import {deflateSync,inflateSync} from "node:zlib";

const SIZES=[192,512];
function chunk(type,bytes) {
  const size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);
  const data=Buffer.concat([Buffer.from(type),bytes]);
  let crc=0xffffffff;
  for(const x of data) {crc^=x;for(let j=0;j<8;j++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  const tail=Buffer.alloc(4);tail.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,data,tail]);
}
function color(hex,fallback) {
  return typeof hex==="string" && /^#[0-9a-fA-F]{6}$/.test(hex)?hex:fallback;
}
function rgb(hex) {return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function png(size,theme) {
  // Stable abstract IWXA mark, used only when a site has no suitable PNG.
  const bg=rgb(theme),fg=[255,255,255],rows=Buffer.alloc((size*4+1)*size);
  const px=(x,y,c)=>{const i=y*(size*4+1)+1+x*4;rows[i]=c[0];rows[i+1]=c[1];rows[i+2]=c[2];rows[i+3]=255;};
  for(let y=0;y<size;y++) {
    for(let x=0;x<size;x++) {
      const u=(x+.5)/size,v=(y+.5)/size;
      const mark=(Math.abs(u-.5)+Math.abs(v-.5)<.26 &&
        Math.abs(u-.5)+Math.abs(v-.5)>.15) ||
        (Math.abs(u-.5)<.055 && Math.abs(v-.5)<.055);
      px(x,y,mark?fg:bg);
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);
  ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",ihdr),chunk("IDAT",deflateSync(rows,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
const PNG_SIGNATURE=Buffer.from("89504e470d0a1a0a","hex");
function crc32(bytes) {
  let crc=0xffffffff;
  for(const x of bytes) {
    crc^=x;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;
  }
  return (crc^0xffffffff)>>>0;
}
function validPng(file,size) {
  let bytes;
  try {bytes=readFileSync(file);} catch{return false;}
  if(bytes.length<57 || bytes.length>8*1024*1024 ||
     !bytes.subarray(0,8).equals(PNG_SIGNATURE))return false;
  let offset=8,ihdr=false,idat=[],end=false;
  try {
    while(offset+12<=bytes.length) {
      const count=bytes.readUInt32BE(offset);
      if(count>bytes.length-offset-12)return false;
      const type=bytes.toString("ascii",offset+4,offset+8);
      const chunkData=bytes.subarray(offset+8,offset+8+count);
      const crc=bytes.readUInt32BE(offset+8+count);
      if(crc!==crc32(bytes.subarray(offset+4,offset+8+count)))return false;
      if(!ihdr) {
        if(type!=="IHDR"||count!==13||
           chunkData.readUInt32BE(0)!==size||
           chunkData.readUInt32BE(4)!==size)return false;
        ihdr=true;
      }
      if(type==="IDAT")idat.push(chunkData);
      if(type==="IEND") {end=count===0;break;}
      offset+=count+12;
    }
    if(!ihdr||!end||idat.length===0)return false;
    // Reject truncated/corrupted image data before advertising installability.
    inflateSync(Buffer.concat(idat),{maxOutputLength:128*1024*1024});
    return true;
  }catch{return false;}
}
function sameOriginIcon(root,icon,domainOrigin) {
  if(!icon || typeof icon.src!=="string")return null;
  let url;
  try {url=new URL(icon.src,domainOrigin+"/site.webmanifest");} catch{return null;}
  if(url.origin!==domainOrigin || url.search || url.hash ||
     !url.pathname.startsWith("/") || url.pathname.includes("\\") ||
     /%2f|%5c|%00/i.test(url.pathname))return null;
  const file=join(root,url.pathname.slice(1));
  if(!existsSync(file))return null;
  if(icon.type==="image/png" && typeof icon.sizes==="string"){
    const sized=icon.sizes.split(/\s+/).filter(x=>/^\d+x\d+$/.test(x));
    if(sized.length && !sized.every(dim=>{
      const [w,h]=dim.split("x").map(Number);
      return w===h && validPng(file,w);
    }))return null;
  }
  return {...icon,src:url.pathname};
}
export function materializePwaManifest(root,domainOrigin) {
  const sitePath=join(root,"site.webmanifest");
  let existing={};
  if(existsSync(sitePath)){
    try {existing=JSON.parse(readFileSync(sitePath,"utf8"));}
    catch {throw Error("T3_PWA_SITE_MANIFEST_INVALID");}
  }
  const origin=new URL(domainOrigin);
  const domainName=origin.hostname.replace(/^www\./,"");
  const theme=color(existing.theme_color,"#172A38");
  const icons=Array.isArray(existing.icons)?
    existing.icons.map(icon=>sameOriginIcon(root,icon,domainOrigin)).filter(Boolean):[];
  for(const size of SIZES){
    const path="/_iwxa/pwa/icon-"+size+".png";
    const absolute=join(root,path.slice(1));
    if(icons.some(i=>i.type==="image/png" &&
        typeof i.sizes==="string" && i.sizes.split(/\s+/).includes(size+"x"+size))) {
      // A branded icon replaced our fallback: do not ship stale, unused assets
      // in the single complete offline snapshot.
      if(existsSync(absolute) && !icons.some(i=>i.src===path))rmSync(absolute);
      continue;
    }
    mkdirSync(dirname(absolute),{recursive:true});
    writeFileSync(absolute,png(size,theme));
    icons.push({src:path,sizes:size+"x"+size,type:"image/png",purpose:"any"});
  }
  // The OS may open .iwxa only into the already compiled, enabled Exchange
  // route. Sites without T2 Exchange never advertise an inert file handler.
  let iwxaHandlerReady=false;
  const exchangeEntry=join(root,"workspace/exchange/index.html");
  const workspaceConfig=join(root,"workspace/workspace.config.json");
  if(existsSync(exchangeEntry)&&existsSync(workspaceConfig)) {
    let config;
    try {config=JSON.parse(readFileSync(workspaceConfig,"utf8"));}
    catch {throw Error("T3_PWA_WORKSPACE_CONFIG_INVALID");}
    iwxaHandlerReady=Array.isArray(config?.modules)&&config.modules.some(
      module=>module?.module_id==="iwxa.workspace.exchange"&&module?.state==="active");
  }
  const app={
    id:"/",name:typeof existing.name==="string"&&existing.name.trim()?existing.name:domainName,
    short_name:typeof existing.short_name==="string"&&existing.short_name.trim()?
      existing.short_name:domainName,
    description:typeof existing.description==="string"?existing.description:undefined,
    lang:typeof existing.lang==="string"?existing.lang:"ru",
    start_url:"/",scope:"/",display:"standalone",
    background_color:color(existing.background_color,theme),theme_color:theme,
    icons,prefer_related_applications:false,
    ...(iwxaHandlerReady?{file_handlers:[{
      action:"/workspace/exchange/",
      name:"Пакет IWXA",
      accept:{"application/octet-stream":[".iwxa"]},
      launch_type:"single-client",
    }]}:{})
  };
  const file="/t3-app-manifest.json";
  writeFileSync(join(root,file.slice(1)),JSON.stringify(app,null,2)+"\n");
  return {path:file,manifest:app};
}
