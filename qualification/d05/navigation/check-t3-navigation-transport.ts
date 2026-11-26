// Real-browser online transport witness, with no domain product or data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import puppeteer from 'puppeteer-core';
import {resolveBrowserExecutable} from './lib/resolve-browser-executable';
import {withFreshAuditPage,loadAuditDocument,documentResponseProblem} from './d05-release-transport.mjs';
const requests=[];
const server=createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
  const cached=req.headers['if-none-match']==='"d05-fixture"';
  requests.push({path:req.url,cached});
  if(cached){res.writeHead(304,{'ETag':'"d05-fixture"'}).end();return;}
  if(req.url==='/missing/'){res.writeHead(404,{'Content-Type':'text/html'}).end('<h1>Missing</h1>');return;}
  if(req.url==='/wrong-type/'){res.writeHead(200,{'Content-Type':'text/plain'}).end('Not HTML');return;}
  if(!['/','/catalog/','/catalog/?case=fixture'].includes(req.url)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, must-revalidate','ETag':'"d05-fixture"'});
  res.end('<!doctype html><title>Navigation fixture</title><a href="#main">Skip</a><a href="/catalog/?case=fixture">Next</a><main id="main" tabindex="-1"><h1>Fixture</h1></main>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await puppeteer.launch({executablePath:(await resolveBrowserExecutable()).executablePath,headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
  const configure=async page=>{
    await page.setRequestInterception(true);
    page.on('request',r=>{if(r.url().startsWith(origin+'/'))void r.continue();else void r.abort();});
  };
  for(let i=0;i<8;i++){
    await withFreshAuditPage(browser,configure,async page=>{
      const path=i%2===0?'/':'/catalog/';
      await loadAuditDocument(page,origin,path);
      await page.$eval('a[href="#main"]',a=>a.focus());
      await page.keyboard.press('Enter');
      await page.waitForFunction(()=>location.hash==='#main');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
      const [response]=await Promise.all([
        page.waitForNavigation({waitUntil:'networkidle0',timeout:30000}),
        page.click('a[href="/catalog/?case=fixture"]')
      ]);
      assert.equal(documentResponseProblem(response,origin),null);
      assert.equal(page.url(),origin+'/catalog/?case=fixture');
      assert.equal(await page.$eval('h1',el=>el.textContent),'Fixture');
    });
  }
  await assert.rejects(withFreshAuditPage(browser,configure,page=>loadAuditDocument(page,origin,'/missing/')),/PAGE_HTTP_STATUS_404/);
  await assert.rejects(withFreshAuditPage(browser,configure,page=>loadAuditDocument(page,origin,'/wrong-type/')),/PAGE_HTTP_MIME/);
  assert.equal(requests.filter(r=>r.path==='/'||r.path==='/catalog/').length,8);
  assert.equal(requests.filter(r=>r.path==='/catalog/?case=fixture').length,8);
  assert.equal(requests.filter(r=>r.cached).length,0);
  console.log('D05_T3_FRESH_NAVIGATION_TRANSPORT_PASS');
}finally{
  await browser?.close();
  await new Promise(r=>server.close(r));
}
