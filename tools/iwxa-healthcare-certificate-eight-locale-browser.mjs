#!/usr/bin/env node
// Browser qualification of IWXA Coursera AI for Healthcare certificate.
// No private site code or artifacts are copied to the public repository.
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const site = resolve(process.env.IWXA_SITE_DIR || "site");
const puppeteer = createRequire(join(site,"package.json"))("puppeteer");
const base = process.env.IWXA_BASE || "http://127.0.0.1:4390";
const locales = [
  ["ru","","ru"],["en","en","en-GB"],["zh","zh-hans","zh-Hans-CN"],
  ["es","es","es-ES"],["ar","ar","ar"],["fr","fr","fr-FR"],
  ["de","de","de-DE"],["pt","pt","pt-BR"]
];
const certUrl="https://coursera.org/verify/RKMI6MC3MAY2";
const asset="/assets/certs/RKMI6MC3MAY2.webp";
let checks=0;
const check=(ok,label)=>{if(!ok)throw Error("IWXA_CERT_BROWSER_FAILED="+label);checks++};
const imageResponse=await fetch(base+asset);
const binary=Buffer.from(await imageResponse.arrayBuffer());
check(imageResponse.status===200&&binary.toString("ascii",0,4)==="RIFF"&&binary.toString("ascii",8,12)==="WEBP","preview_binary_http");
const browser=await puppeteer.launch({headless:true,args:["--no-sandbox","--disable-setuid-sandbox"]});
const page=await browser.newPage();
await page.setViewport({width:1366,height:900});
const errors=[];
page.on("pageerror",e=>errors.push(String(e.message||"").slice(0,130)));
try {
  for (const [name,prefix,language] of locales) {
    const path=prefix?"/"+prefix+"/competencies/":"/competencies/";
    const resp=await page.goto(base+path,{waitUntil:"domcontentloaded",timeout:50000});
    check(resp?.status()===200,name+"_http_200");
    await page.waitForSelector("main[data-client-ready]",{timeout:25000});
    const data=await page.evaluate(({certUrl,asset})=>{
      const link=[...document.querySelectorAll('a[href]')].find(x=>x.getAttribute("href")===certUrl);
      const card=link?.closest("article");
      return {
        lang:document.documentElement.lang,
        title:card?.querySelector("h3")?.textContent?.trim()||"",
        cardText:card?.textContent||"",
        image:card?.querySelector("img")?.getAttribute("src")||"",
        search:!!document.querySelector('input[type="search"]'),
        schemas:[...document.querySelectorAll('script[type="application/ld+json"]')].map(x=>x.textContent||"").join(" ")
      };
    },{certUrl,asset});
    check(data.lang===language,name+"_document_language");
    check(data.title==="AI for Healthcare",name+"_certificate_title");
    check(data.cardText.includes("AI CERTs")&&data.cardText.includes("2026-11-13"),name+"_issuer_and_exact_date");
    check(data.image===asset,name+"_preview_image_path");
    check(data.search,name+"_search_exists");
    if(name==="ru")check(data.schemas.includes("AI for Healthcare")&&data.schemas.includes("2026-11-13"),name+"_jsonld");
    const input=await page.$('input[type="search"]');
    await input.click({clickCount:3});
    await input.type("AI for Healthcare");
    await page.waitForFunction(url=>[...document.querySelectorAll('article a[href]')].filter(x=>x.getAttribute("href")===url).length===1,{timeout:10000},certUrl);
    check(await page.$eval('input[type="search"]',x=>x.value)==="AI for Healthcare",name+"_search_result");
    const img=await page.$('img[src="'+asset+'"]');
    check(Boolean(img),name+"_preview_present");
    await img.evaluate(el=>el.scrollIntoView({block:"center"}));
    await page.waitForFunction(src=>{
      const image=document.querySelector('img[src="'+src+'"]');
      return Boolean(image&&image.complete&&image.naturalWidth>0);
    },{timeout:15000},asset);
    check(true,name+"_preview_loaded");
  }
  check(errors.length===0,"no_javascript_page_errors");
  console.log("IWXA_CERT_BROWSER_ASSERTIONS="+checks);
  console.log("IWXA_CERT_BROWSER_FAILURES=0");
  console.log("IWXA_CERT_BROWSER_PAGEERRORS=0");
} finally {
  await page.close().catch(()=>{});
  await browser.close().catch(()=>{});
}
