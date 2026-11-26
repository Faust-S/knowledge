import test from 'node:test';
import assert from 'node:assert/strict';
import { documentResponseProblem, withFreshAuditPage, loadAuditDocument } from './transport.mjs';
const origin = 'http://127.0.0.1:34567';
test('strict document response requires an actual same-origin successful HTML response', () => {
  const response = (status, type='text/html; charset=UTF-8', url=origin+'/catalog/') => ({
    status:()=>status, ok:()=>status>=200&&status<300, headers:()=>({'content-type':type}), url:()=>url
  });
  assert.equal(documentResponseProblem(response(200),origin),null);
  assert.equal(documentResponseProblem(null,origin),'PAGE_HTTP_NO_RESPONSE');
  assert.equal(documentResponseProblem(response(304,''),origin),'PAGE_HTTP_STATUS_304');
  assert.equal(documentResponseProblem(response(404),origin),'PAGE_HTTP_STATUS_404');
  assert.equal(documentResponseProblem(response(500),origin),'PAGE_HTTP_STATUS_500');
  assert.equal(documentResponseProblem(response(200,'application/json'),origin),'PAGE_HTTP_MIME');
  assert.equal(documentResponseProblem(response(200,'text/html','https://example.org/'),origin),'PAGE_REDIRECT');
});
test('each visit starts in a fresh page with cache and service worker bypassed, and closes on failure', async () => {
  const events=[];
  let pageCount=0;
  const browser={async newPage(){
    const id=++pageCount;let url='about:blank';
    events.push([id,'new']);
    return {url:()=>url,async setCacheEnabled(value){events.push([id,'cache',value]);},
      async setBypassServiceWorker(value){events.push([id,'worker',value]);},
      async goto(value){url=value;events.push([id,'goto',value]);return {status:()=>200,ok:()=>true,headers:()=>({'content-type':'text/html'}),url:()=>url};},
      async close(){events.push([id,'close']);}};
  }};
  const configure=async()=>{};
  for(let i=0;i<3;i++){
    await withFreshAuditPage(browser,configure,async page=>{
      await loadAuditDocument(page,origin,'/catalog/');
      await assert.rejects(loadAuditDocument(page,origin,'/catalog/'),/NOT_FRESH/);
    });
  }
  await assert.rejects(withFreshAuditPage(browser,configure,async()=>{throw Error('fixture');}),/fixture/);
  assert.equal(pageCount,4);
  for(let i=1;i<=4;i++){
    const eventsForPage=events.filter(x=>x[0]===i);
    assert.deepEqual(eventsForPage.slice(0,3),[[i,'new'],[i,'cache',false],[i,'worker',true]]);
    assert.deepEqual(eventsForPage.at(-1),[i,'close']);
  }
});
