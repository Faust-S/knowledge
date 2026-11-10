import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {launchT2SiteRestore,mountT2SiteRestoreSender} from '../src/workspace-host/site-handoff/site-restore.mjs';

function pair(){
 const sl=new Set(),hl=new Set(),log=[];
 const site={location:{origin:'https://club.iwxa.ru'},
  addEventListener:(_,fn)=>sl.add(fn),removeEventListener:(_,fn)=>sl.delete(fn),
  open:()=>host,postMessage:(data,to)=>{log.push({from:'host',data,to});if(to==='https://club.iwxa.ru')for(const fn of [...sl])fn({data,origin:'https://localhost:4173',source:host})}};
 const host={location:{origin:'https://localhost:4173'},opener:site,crypto:webcrypto,
  addEventListener:(_,fn)=>hl.add(fn),removeEventListener:(_,fn)=>hl.delete(fn),
  postMessage:(data,to)=>{log.push({from:'site',data,to});if(to==='https://localhost:4173')for(const fn of [...hl])fn({data,origin:'https://club.iwxa.ru',source:site})}};
 return {site,host,sl,hl,log};
}
test('Host only sends verified candidate after explicit sender call and Site receives once',async()=>{
 const p=pair(),received=[],statuses=[];
 const site=launchT2SiteRestore({siteWindow:p.site,hostUrl:'https://localhost:4173/workspace/',
  onCandidate:v=>received.push(v),onStatus:v=>statuses.push(v)});
 let ready=0;
 const host=mountT2SiteRestoreSender({hostWindow:p.host,expectedSiteOrigin:'https://club.iwxa.ru',onRequest:()=>ready++});
 await Promise.resolve();
 assert.equal(site.requested,true);assert.equal(host.requested,true);assert.equal(ready,1);
 assert.deepEqual(received,[]);
 host.send('{"results":[{"object_id":"profile"}]}');
 assert.equal(received.length,1);assert.match(received[0],/profile/);
 assert.equal(host.sent,true);assert.equal(site.pending,false);
 assert.equal(p.sl.size,0);assert.equal(p.hl.size,0);
 assert.throws(()=>host.send('{}'),/REQUEST_REQUIRED/);
});
test('origin/window/nonces cannot forge a restore request or private readback',async()=>{
 const p=pair(),received=[];
 const host=mountT2SiteRestoreSender({hostWindow:p.host,expectedSiteOrigin:'https://club.iwxa.ru'});
 const nonce=p.log[0]?.data?.nonce;
 for(const fn of [...p.hl]){
  fn({origin:'https://attacker.example',source:p.site,data:{protocol:'IWXA_T2_SITE_HANDOFF/1',kind:'restore-request',nonce}});
  fn({origin:'https://club.iwxa.ru',source:{},data:{protocol:'IWXA_T2_SITE_HANDOFF/1',kind:'restore-request',nonce}});
 }
 assert.equal(host.requested,false);
 await Promise.resolve();
 const n=p.log[0].data.nonce;
 for(const fn of [...p.hl])fn({origin:'https://club.iwxa.ru',source:p.site,data:{protocol:'IWXA_T2_SITE_HANDOFF/1',kind:'restore-request',nonce:n}});
 assert.equal(host.requested,true);
 const site=launchT2SiteRestore({siteWindow:p.site,hostUrl:'https://localhost:4173/workspace/',onCandidate:v=>received.push(v)});
 for(const fn of [...p.sl])fn({origin:'https://localhost:4173',source:p.host,data:{protocol:'IWXA_T2_SITE_HANDOFF/1',kind:'restore-candidate',nonce:'bad',raw:'{}'}});
 assert.deepEqual(received,[]);
 site.dispose();host.dispose();
});
test('unmounted first StrictMode receiver sends no stale ready',async()=>{
 const p=pair();
 const first=mountT2SiteRestoreSender({hostWindow:p.host,expectedSiteOrigin:'https://club.iwxa.ru'});
 first.dispose();
 const second=mountT2SiteRestoreSender({hostWindow:p.host,expectedSiteOrigin:'https://club.iwxa.ru'});
 await Promise.resolve();
 assert.equal(p.log.filter(v=>v.data.kind==='restore-ready').length,1);
 second.dispose();
});
test('arbitrary remote destinations rejected before reading any private data',()=>{
 const p=pair();
 assert.throws(()=>launchT2SiteRestore({siteWindow:p.site,hostUrl:'https://outside.example/workspace/',onCandidate:()=>{}}),/DESTINATION_INVALID/);
 assert.equal(p.sl.size,0);
});
