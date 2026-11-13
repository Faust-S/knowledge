// Build-time PWA metadata for the SAME T3 domain dist, not a second runtime.
// Never change the existing T3 Kernel/Store/service worker or site's favicon.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {join,dirname} from "node:path";
import {deflateSync} from "node:zlib";

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
function sameOriginIcon(root,icon) {
  if(!icon || typeof icon.src!=="string")return null;
  let url;
  try {url=new URL(icon.src,"https://pwa.invalid/");} catch{return null;}
  if(url.origin!=="https://pwa.invalid" || url.search || url.hash ||
     !url.pathname.startsWith("/") || url.pathname.includes("..") ||
     url.pathname.includes("\\"))return null;
  return existsSync(join(root,url.pathname.slice(1)))?{...icon,src:url.pathname}:null;
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
    existing.icons.map(icon=>sameOriginIcon(root,icon)).filter(Boolean):[];
  for(const size of SIZES){
    if(icons.some(i=>i.type==="image/png" &&
        typeof i.sizes==="string" && i.sizes.split(/\s+/).includes(size+"x"+size)))continue;
    const path="/_iwxa/pwa/icon-"+size+".png";
    const absolute=join(root,path.slice(1));
    mkdirSync(dirname(absolute),{recursive:true});
    writeFileSync(absolute,png(size,theme));
    icons.push({src:path,sizes:size+"x"+size,type:"image/png",purpose:"any"});
  }
  const app={
    id:"/",name:typeof existing.name==="string"&&existing.name.trim()?existing.name:domainName,
    short_name:typeof existing.short_name==="string"&&existing.short_name.trim()?
      existing.short_name:domainName,
    description:typeof existing.description==="string"?existing.description:undefined,
    lang:typeof existing.lang==="string"?existing.lang:"ru",
    start_url:"/",scope:"/",display:"standalone",
    background_color:color(existing.background_color,theme),theme_color:theme,
    icons,prefer_related_applications:false
  };
  const file="/t3-app.webmanifest";
  writeFileSync(join(root,file.slice(1)),JSON.stringify(app,null,2)+"\n");
  return {path:file,manifest:app};
}
