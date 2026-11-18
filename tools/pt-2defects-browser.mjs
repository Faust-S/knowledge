#!/usr/bin/env node
// IWXA PT targeted independent reproduction. No HTML/screenshots/source leaves CI.
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const root = resolve(process.env.PT_SITE_DIR || "pt-site");
const puppeteer = createRequire(join(root, "package.json"))("puppeteer");
const base = process.env.PT_BASE ?? "http://127.0.0.1:4389";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();
page.setDefaultNavigationTimeout(35000);
const problems=[];
try {
  for(const width of [320,375,478]) {
    for(const theme of ["dark","light"]) {
      await page.setViewport({width,height:812});
      await page.goto(base + "/pt/", {waitUntil:"domcontentloaded"});
      await page.evaluate(x=>localStorage.setItem("iwxa-theme",x),theme);
      await page.reload({waitUntil:"domcontentloaded"});
      await page.waitForSelector('main[data-client-ready]',{timeout:16000});
      for(const action of ["initial","pause","center"]) {
        if(action!=="initial") {
          await page.evaluate(which=>{
            const buttons=[...document.querySelectorAll(".orbital-sidedock button")];
            const found=buttons.find(b=>b.textContent.trim()===which);
            found?.click();
          },action==="pause"?"⏸":"⊙");
        }
        await new Promise(r=>setTimeout(r,260));
        const result=await page.evaluate(()=>{
          const project=document.querySelector(".home-shell--pt .orbital-planet--amber .orbital-planet__label");
          const author=document.querySelector(".home-shell--pt .orbital-planet--core .orbital-planet__label");
          const dock=document.querySelector(".home-shell--pt .orbital-sidedock");
          if(!project||!author) return {missing:true};
          const a=project.getBoundingClientRect(),b=author.getBoundingClientRect();
          const d=dock?.getBoundingClientRect();
          const intersect=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
          return {
            project:{l:Math.round(a.left),r:Math.round(a.right),t:Math.round(a.top),b:Math.round(a.bottom)},
            author:{l:Math.round(b.left),r:Math.round(b.right),t:Math.round(b.top),b:Math.round(b.bottom)},
            overlap:Math.round(intersect(a,b)),
            dockOverlap:d&&getComputedStyle(dock).visibility!=="hidden"?Math.round(intersect(a,d)):0,
            overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          };
        });
        console.log("PT_F02_OBS="+JSON.stringify({width,theme,action,...result}));
        if(result.missing||result.overlap>0||result.dockOverlap>0||result.overflow>3)problems.push("PT_F02_"+width+"_"+theme+"_"+action);
      }
    }
  }
  await page.setViewport({width:375,height:812});
  await page.goto(base + "/pt/map/",{waitUntil:"domcontentloaded"});
  await page.waitForSelector("#agent-start",{timeout:22000});
  await page.click("#agent-start");
  await page.waitForFunction(() => {
    const el=document.querySelector("#agent-offers");
    return el&&!el.hidden;
  },{timeout:14000});
  await page.click('[data-agent-offer="B"]');
  await new Promise(r=>setTimeout(r,250));
  const check=await page.evaluate(()=>{
    const ids=["agent-offer-reason","agent-decision-context","agent-outcome"];
    return ids.map(id=>{
      const el=document.getElementById(id);
      return {id,missing:!el,ru:/[А-Яа-яЁё]/u.test((el?.textContent||"") + " " +(el?.getAttribute("aria-label")||"")),length:el?.textContent?.length||0};
    });
  });
  console.log("PT_ATLAS_B_OBS="+JSON.stringify(check));
  if(check.some(x=>x.missing||x.ru))problems.push("PT_ATLAS_B_RU_RUNTIME");
  console.log("PT_TARGET_FAILURE_COUNT="+problems.length);
  problems.forEach(x=>console.error("PT_TARGET_FAIL="+x));
  if(problems.length)process.exitCode=1;
} finally { await browser.close(); }
