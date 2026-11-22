import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE='tests/agent-v8/iwxa_v8.html';
const sha='d26f1d944dd9cbe7dcbcbf5559274919a012181d85187c00cb0b760c35588b2d';
const bytes=await fs.readFile(SOURCE);
const actual=crypto.createHash('sha256').update(bytes).digest('hex');
if(actual!==sha)throw Error('Wrong V8 source: '+actual);
const fileUrl=pathToFileURL(path.resolve(SOURCE)).href;
await fs.mkdir('screenshots',{recursive:true});

const scenes=[
 ['01-home','personal','Главная'],
 ['02-spaces','personal','Рабочие области'],
 ['03-family','family','Главная'],
 ['04-studio','studio','Главная'],
 ['05-studio-tasks','studio','Задачи','result'],
 ['06-research','research','Главная'],
 ['07-research-chat','research','Диалоги'],
 ['08-research-docs','research','Файлы','file'],
 ['09-research-projects','research','Проекты'],
 ['10-learning','learning','Главная'],
 ['11-learning-automation','learning','Автоматизации'],
 ['12-org','org','Главная'],
 ['13-org-reviews','org','Согласования'],
 ['14-service','service','Главная'],
 ['15-personal-memory','personal','Память'],
 ['16-personal-knowledge','personal','Знания'],
 ['17-personal-tools','personal','Программы'],
 ['18-personal-settings','personal','Настройки'],
 ['19-personal-tasks','personal','Задачи','personal-result']
];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const failures=[], report=[];
const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,locale:'ru-RU',colorScheme:'light'});
for(const [id,space,screen,preview] of scenes) {
 const page=await ctx.newPage();
 let errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(fileUrl,{waitUntil:'load',timeout:25000});
  await page.evaluate(({space,screen,preview})=>{
    v6Close();
    v8Switch(space);
    go(screen);
    if(preview==='result')v7PreviewResult(UX.tasks.find(t=>t.status==='review')?.id||UX.tasks[0].id);
    if(preview==='file')v7PreviewFile(V7.files[0].id);
    if(preview==='personal-result')v7PreviewResult(UX.tasks.find(t=>t.id==='w1')?.id||UX.tasks[0].id);
    document.querySelector('#content').scrollTop=0;
    document.querySelector('#v6-dock-body').scrollTop=0;
    document.querySelector('#nav-items').scrollTop=0;
  },{space,screen,preview});
  await page.waitForTimeout(350);
  const state=await page.evaluate(()=>{
    const shell=document.querySelector('.shell'),content=document.querySelector('#content');
    const rows=[...content.querySelectorAll('h1,h2,h3,button,.v7-list-info strong,.v8-space-card h3')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<window.innerHeight&&r.bottom>0});
    const overflow=rows.filter(el=>{
      const style=getComputedStyle(el);
      return el.scrollWidth>el.clientWidth+5 && style.overflowX==='visible';
    }).slice(0,6).map(x=>({text:x.textContent.slice(0,55),excess:x.scrollWidth-x.clientWidth}));
    const tabs=[...document.querySelectorAll('.v6-dock-tabs .v6-tab')].map(x=>x.textContent.trim());
    return {shellWidth:Math.round(shell.getBoundingClientRect().width),shellHeight:Math.round(shell.getBoundingClientRect().height),title:content.querySelector('h1')?.textContent,contentLength:content.textContent.length,overflow,previewOpen:!document.querySelector('#v6-dock').hidden,tabs};
  });
  if(state.shellWidth<1400||state.contentLength<80||errors.length)failures.push({id,state,errors});
  const png=await page.screenshot({type:'png',animations:'disabled'});
  const out='screenshots/'+id+'.webp';
  await sharp(png).webp({quality:92,effort:5}).toFile(out);
  report.push({id,space,screen,preview,...state,errors,file:out,bytes:(await fs.stat(out)).size});
  console.log('PASS',id,space,screen,JSON.stringify({title:state.title,bytes:report.at(-1).bytes,overflow:state.overflow.length,preview:state.previewOpen}));
 }catch(e) {
  failures.push({id,error:String(e)});
  console.error('FAIL',id,String(e));
 }finally{await page.close();}
}
await browser.close();
await fs.writeFile('screenshots/capture-report.json',JSON.stringify({sourceSha256:actual,scenes:report,failures},null,2));
if(failures.length||report.length!==scenes.length){console.error('FAILURES',JSON.stringify(failures));process.exitCode=1;}
else console.log('CAPTURE_OK',report.length,'verified source SHA',actual);
