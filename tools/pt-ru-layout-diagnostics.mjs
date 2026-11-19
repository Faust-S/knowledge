#!/usr/bin/env node
// Private source stays inside the checkout. Print only layout metrics and public paths.
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const projectRoot = resolve(process.env.PT_SITE_DIR || "pt-site");
const base = process.env.PT_BASE || "http://127.0.0.1:4397";
const puppeteer = createRequire(join(projectRoot, "package.json"))("puppeteer");
const browser = await puppeteer.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const page = await browser.newPage();
let failed=0, qualified=0;
const sample=async path=>{
  const res=await page.goto(base+path,{waitUntil:"domcontentloaded",timeout:45000});
  if(res?.status()!==200)throw Error("HTTP "+res?.status()+" "+path);
  await page.waitForSelector("main[data-client-ready]",{timeout:25000});
  await new Promise(resolve => setTimeout(resolve, 180));
  return page.evaluate(()=>{
    const computed=s=>{const n=document.querySelector(s);if(!n)return null;const c=getComputedStyle(n);
      return {paddingTop:parseFloat(c.paddingTop)||0,fontSize:parseFloat(c.fontSize)||0,
              position:c.position,gap:parseFloat(c.gap)||0,width:Math.round(n.getBoundingClientRect().width)};
    };
    const readable=s=>{
      const n=document.querySelector(s);if(!n)return {missing:true};
      const range=document.createRange();range.selectNodeContents(n);
      const rects=[...range.getClientRects()];
      const el=n.getBoundingClientRect();
      return {missing:false,elementRight:Math.round(el.right),
        textRight:Math.round(Math.max(0,...rects.map(r=>r.right))),
        viewport:innerWidth,
        fontSize:parseFloat(getComputedStyle(n).fontSize)||0,
        scrollOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    };
    return {
      styled:[...document.querySelectorAll('link[rel="stylesheet"]')].some(n=>(n.getAttribute("href")||"").includes("life-plus")),
      bodyTheme:document.body.classList.contains("theme-life"),
      lifeHero:computed(".life-hero"),
      lifeNav:computed(".lab-subnav"),
      lifeSection:computed(".life-section"),
      lifeBody:computed(".life-section__body"),
      h1:readable(".univ-h1"),
      para:readable(".univ-intro"),
      clip:getComputedStyle(document.querySelector(".univ-page")||document.body).overflowX,
    };
  });
};
try{
  for(const width of [375,1440]){
    await page.setViewport({width,height:900});
    for(const theme of ["dark","light"]){
      await page.goto(base+"/",{waitUntil:"domcontentloaded"});
      await page.evaluate(v=>localStorage.setItem("iwxa-theme",v),theme);
      const ru=await sample("/life-plus/environment/");
      const pt=await sample("/pt/life-plus/environment/");
      const keys=["lifeHero","lifeNav","lifeSection","lifeBody"];
      let okay=pt.styled&&pt.bodyTheme;
      for(const key of keys){
        if(!pt[key]||!ru[key]){okay=false;continue;}
        for(const prop of ["paddingTop","fontSize","gap"]){
          if(Math.abs(pt[key][prop]-ru[key][prop])>.55)okay=false;
        }
        if(pt[key].position!==ru[key].position)okay=false;
      }
      console.log("PT_LIFE_STYLE_OBS="+JSON.stringify({
        width,theme,ruStylesheet:ru.styled,ptStylesheet:pt.styled,
        ruHeroPadding:ru.lifeHero?.paddingTop,ptHeroPadding:pt.lifeHero?.paddingTop,
        ruSectionPadding:ru.lifeSection?.paddingTop,ptSectionPadding:pt.lifeSection?.paddingTop,
        ptTheme:pt.bodyTheme,parity:okay}));
      if(!okay)failed++;
      else qualified++;
    }
  }
  await page.setViewport({width:375,height:812});
  for(const [name,path] of [
    ["digital-twin","/science/university/cifrovoy-dvoynik-universiteta/"],
    ["analytics","/science/university/obrazovatelnaya-analitika/"],
    ["pt-digital-twin","/pt/science/university/cifrovoy-dvoynik-universiteta/"],
    ["pt-analytics","/pt/science/university/obrazovatelnaya-analitika/"],
  ]){
    const s=await sample(path);
    const readable = [s.h1,s.para].every(x =>
      x && !x.missing && x.textRight <= x.viewport - 8 &&
      x.elementRight <= x.viewport - 8 &&
      x.scrollOverflow <= 1);
    console.log("UNIVERSITY_READABILITY_OBS="+JSON.stringify({
      name,overflowClipping:s.clip,h1:s.h1,paragraph:s.para,readable,
    }));
    if(!readable)failed++;
  }
  console.log("PT_LIFE_STYLE_PARITY="+qualified+"/4");
  console.log("UNIVERSITY_READABILITY_REQUIRED=4/4");
  console.log("PT_LIFE_STYLE_FAILURES="+failed);
  if(failed)process.exitCode=1;
}finally{await browser.close();}
