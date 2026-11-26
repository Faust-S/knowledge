// Test-only audit of the exact assembled dist. Public links are checked after
// hydration; authenticated Host journeys retain their original separate witness.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer-core';
import { serveStatic } from './lib/serve';
import { resolveBrowserExecutable } from './lib/resolve-browser-executable';
import { isNotFoundPage } from './lib/not-found-page';
import { prerenderSiteRoutes, publicSiteRoutes, PUBLIC_ORIGIN } from '../src/site-routes';
import { pagePath, linkTarget, fragmentExists, activationKind } from './d05-release-link-target.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(readFileSync(join(dist, 't3-offline-manifest.json'), 'utf8'));
const pack = JSON.parse(readFileSync(join(dist, 'assets/cehovod-assistant-skills.json'), 'utf8'));
const fail = (code: string): never => { throw Error('D05_T3_RENDERED_LINK_' + code); };
const publicPages = new Set<string>([
  ...publicSiteRoutes().map(r => r.path),
  ...pack.skills.map((s: { route: string }) => s.route),
]);
const declaredPages = new Set(prerenderSiteRoutes().map(r => r.path));
const manifestPages = new Set<string>(manifest.pages.map((r: { path: string }) => pagePath(r.path)));
const files = new Set<string>(manifest.files.map((r: { path: string }) => r.path));
files.add('/t3-offline-manifest.json');
const protectedPages = new Set([...declaredPages].filter(p => !publicPages.has(p)));
for (const p of manifestPages) if (p.startsWith('/workspace/')) protectedPages.add(p);
const pages = new Set([...publicPages, ...protectedPages]);
for (const p of pages) if (!manifestPages.has(p)) fail('REGISTRY_MISMATCH');
if (publicPages.size < 1 || declaredPages.size < publicPages.size) fail('EMPTY_REGISTRY');

const desktop = { width: 1440, height: 900 };
const mobile = { width: 375, height: 812 };
const menuSelector = 'button[aria-label="Открыть меню"]';
async function openMenu(page: Page): Promise<boolean> {
  const menu = await page.$(menuSelector);
  if (!menu || !(await menu.boundingBox())) return false;
  await menu.click();
  await page.waitForSelector('[role="dialog"]', { visible: true, timeout: 10000 });
  return true;
}
async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 10000 });
}
async function snapshot(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() || '',
    base: document.baseURI,
    ids: [...document.querySelectorAll<HTMLElement>('[id]')].map(el => el.id),
    names: [...document.querySelectorAll<HTMLAnchorElement>('a[name]')].map(el => el.name),
    links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map(el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        raw: el.getAttribute('href')!, resolved: el.href, target: el.target,
        label: (el.textContent || '').trim(), keyboardOnly: el.classList.contains('sr-only') && el.tabIndex >= 0,
        download: el.hasAttribute('download'), inMenu: !!el.closest('[role="dialog"]'),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[inert]'),
      };
    }),
  }));
}
async function ready(page: Page, expectedPath: string) {
  await page.waitForFunction(() => (window as unknown as { __APP_READY__?: boolean }).__APP_READY__ === true, { timeout: 30000 });
  const state = await snapshot(page);
  if (!state.title.trim() || !state.h1 || isNotFoundPage(state.title, state.h1)) fail('WRONG_PAGE');
  if (pagePath(new URL(page.url()).pathname) !== expectedPath) fail('WRONG_ROUTE');
  return state;
}
async function load(page: Page, origin: string, request: string, expectedPath: string) {
  // A genuine HTTP navigation is required: Puppeteer returns null for same-document hash changes.
  // Start each witness from a fresh document, including when the preceding click left a fragment.
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
  const response = await page.goto(origin + request, { waitUntil: 'networkidle0', timeout: 30000 });
  if (!response?.ok() || !response.headers()['content-type']?.includes('text/html')) fail('PAGE_HTTP');
  if (new URL(response.url()).origin !== origin) fail('PAGE_REDIRECT');
  return ready(page, expectedPath);
}
async function httpCheck(origin: string, request: string, html: boolean) {
  const response = await fetch(origin + request, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  try {
    if (!response.ok || new URL(response.url).origin !== origin) fail('TARGET_HTTP');
    if (html && !response.headers.get('content-type')?.includes('text/html')) fail('TARGET_NOT_HTML');
  } finally { await response.body?.cancel(); }
}

type State = Awaited<ReturnType<typeof snapshot>>;
type Link = State['links'][number];
type PublicTarget = { kind: 'page' | 'protected' | 'asset'; request: string; href: string; path: string; fragment: string; localClick?: boolean };
type Representative = { source: string; link: Link; viewport: typeof desktop; activation: 'keyboard' | 'pointer' | 'order-picker' };
async function clickTarget(page: Page, origin: string, target: PublicTarget, rep: Representative, expectedState: State) {
  await page.setViewport(rep.viewport);
  await load(page, origin, rep.source, pagePath(rep.source));
  if (rep.link.inMenu && !(await openMenu(page))) fail('MENU_LINK_HIDDEN');
  const anchors = await page.$$('a[href]');
  let clicked = false;
  for (const anchor of anchors) {
    const match = await anchor.evaluate((el, wanted) => {
      if (!(el instanceof HTMLAnchorElement)) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' &&
        el.getAttribute('href') === wanted.raw && el.href === wanted.resolved &&
        (el.textContent || '').trim() === wanted.label &&
        !!el.closest('[role="dialog"]') === wanted.inMenu && (!el.target || el.target === '_self') &&
        !el.hasAttribute('download') && !el.closest('[inert]');
    }, rep.link);
    if (!match || !(await anchor.boundingBox())) continue;
    if (rep.activation === 'keyboard') {
      await anchor.focus();
      if (!(await anchor.evaluate(el => document.activeElement === el))) fail('KEYBOARD_FOCUS');
      await page.keyboard.press('Enter');
    } else {
      await anchor.evaluate(el => el.scrollIntoView({block:'center', inline:'nearest', behavior:'instant'}));
      const point = await anchor.evaluate(el => {
        const r=el.getBoundingClientRect();
        const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
        if(right<=left||bottom<=top)return null;
        for(const fy of [0.5,0.25,0.75])for(const fx of [0.5,0.25,0.75]){
          const x=left+(right-left)*fx,y=top+(bottom-top)*fy;
          const hit=document.elementFromPoint(x,y);
          if(hit&&(hit===el||el.contains(hit)))return {x,y};
        }
        return null;
      });
      if(!point)fail('POINTER_OCCLUDED');
      await page.mouse.click(point.x,point.y);
    }
    clicked = true;
    break;
  }
  if (!clicked) fail('VISIBLE_LINK_MISSING');
  if(rep.activation === 'order-picker') {
    await page.waitForFunction(() => document.activeElement instanceof HTMLSelectElement &&
      document.activeElement.closest('label')?.textContent?.includes('Первичный источник (заказ)'), {timeout:10000});
    if(pagePath(new URL(page.url()).pathname)!==pagePath(rep.source)||new URL(page.url()).hash)fail('ORDER_PICKER_NAVIGATED');
    return;
  }
  const expected = new URL(origin + target.href);
  await page.waitForFunction((path, search, hash) => {
    let actual = location.pathname;
    if (actual.endsWith('/index.html')) actual = actual.slice(0, -'index.html'.length);
    else if (!actual.endsWith('/')) actual += '/';
    return actual === path && location.search === search && location.hash === hash;
  }, { timeout: 15000 }, target.path, expected.search, expected.hash);
  // A router may update the URL before the new page mounts. Require the
  // independently loaded destination's actual content and exact fragment.
  await page.waitForFunction((title,h1,fragment)=> document.title===title &&
    (document.querySelector('h1')?.textContent?.trim()||'')===h1 &&
    (!fragment || fragment.toLowerCase()==='top' || !!document.getElementById(fragment) ||
      [...document.querySelectorAll<HTMLAnchorElement>('a[name]')].some(a=>a.name===fragment)),
    {timeout:15000},expectedState.title,expectedState.h1,target.fragment);
  const state = await ready(page, target.path);
  if (!fragmentExists(target.fragment, state.ids, state.names)) fail('CLICK_FRAGMENT_MISSING');
  if(rep.activation==='keyboard'&&target.fragment==='main'&&!(await page.evaluate(()=>document.activeElement?.id==='main')))fail('SKIP_LINK_FOCUS');
  if (rep.link.inMenu && pagePath(rep.source) !== target.path)
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 10000 });
}

async function main() {
  const server = await serveStatic(dist);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const responses = new Map<string, State>();
  const targets = new Map<string, { target: PublicTarget; reps: Map<number, Representative> }>();
  const external = new Set<string>();
  const contacts = new Set<string>();
  let linkOccurrences = 0, menuPages = 0, pagesLoaded = 0, fragments = 0, clicks = 0;
  let privateTargets = 0, assetTargets = 0, pageErrors = 0, localErrors = 0, externalRequests = 0;
  let plannedClicks=0,keyboardClicks=0,orderPickerClicks=0;
  const failures: Record<string, number> = {};
  const note = (error: unknown, source?: string, target?: PublicTarget, width?: number) => {
    const msg = error instanceof Error ? error.message : '';
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(msg) ? msg : 'BROWSER_OPERATION';
    failures[code] = (failures[code] || 0) + 1;
    // Only registered public route ordinals, booleans, and static ASCII anchor IDs.
    // Never print query contents, source bytes, customer values or arbitrary errors.
    const sourceIndex=source?[...publicPages].indexOf(pagePath(source)):-1;
    const targetIndex=target?[...publicPages].indexOf(target.path):-1;
    const fragment=target&&/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(target.fragment)?target.fragment:'';
    console.log('D05_T3_RENDERED_LINK_DIAG '+JSON.stringify({code,sourceIndex,targetIndex,width:width||0,fragment,hasQuery:Boolean(target?.request.includes('?')),errorKind:error instanceof Error&&error.name==='TimeoutError'?'timeout':'other'}));
  };
  try {
    // Every declared page is requested over HTTP, including the separate Host entry.
    for (const p of declaredPages) { try { await httpCheck(server.origin, p, true); } catch (error) { note(error); } }
    const { executablePath } = await resolveBrowserExecutable();
    browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith(server.origin + '/') || /^(?:data|blob|about):/.test(request.url())) void request.continue();
      else { externalRequests++; void request.abort(); }
    });
    page.on('pageerror', () => pageErrors++);
    page.on('response', response => { if (response.url().startsWith(server.origin + '/') && response.status() >= 400) localErrors++; });
    page.on('requestfailed', request => { if (request.url().startsWith(server.origin + '/') && request.failure()?.errorText !== 'net::ERR_ABORTED') localErrors++; });
    const collect = (state: State, source: string, viewport: typeof desktop) => {
      for (const link of state.links) {
        linkOccurrences++;
        try {
        if (new URL(link.raw, state.base).href !== link.resolved) fail('BROWSER_HREF_MISMATCH');
        const resolved = linkTarget(link.raw, state.base, { origin: server.origin, canonical: PUBLIC_ORIGIN, pages, files, protectedPages });
        if (resolved.kind === 'external') { external.add(resolved.href); continue; }
        if (resolved.kind === 'contact') { contacts.add(resolved.href); continue; }
        const target = resolved as PublicTarget;
        const activation=activationKind(link,source);
        const key = target.kind + ':' + target.href + (activation==='order-picker'?':order-picker':'');
        const item = targets.get(key) || { target, reps: new Map<number, Representative>() };
        if (!item.reps.has(viewport.width) && target.kind === 'page' && target.localClick && link.visible && !link.download && (!link.target || link.target === '_self'))
          item.reps.set(viewport.width, { source, link, viewport, activation });
        targets.set(key, item);
        } catch (error) { note(error,source,undefined,viewport.width); }
      }
    };
    for (const source of publicPages) {
      await page.setViewport(desktop);
      const state = await load(page, server.origin, source, pagePath(source));
      responses.set(source, state);
      collect(state, source, desktop);
      await page.setViewport(mobile);
      collect(await snapshot(page), source, mobile);
      const opened = await openMenu(page);
      if (opened) menuPages++;
      if (opened) { collect(await snapshot(page), source, mobile); await closeMenu(page); }
      pagesLoaded++;
    }
    assert.equal(pagesLoaded, publicPages.size);
    if (!menuPages || !linkOccurrences || !targets.size) fail('EMPTY_LINK_COVERAGE');
    await page.setViewport(desktop);
    for (const { target } of targets.values()) {
      try {
      if (target.kind === 'asset') { await httpCheck(server.origin, target.request, false); assetTargets++; continue; }
      if (target.kind === 'protected') { await httpCheck(server.origin, target.request, true); privateTargets++; continue; }
      let state = responses.get(target.request);
      if (!state) { state = await load(page, server.origin, target.request, target.path); responses.set(target.request, state); }
      if (!fragmentExists(target.fragment, state.ids, state.names)) fail('FRAGMENT_MISSING');
      if (target.fragment) fragments++;
      } catch (error) { note(error,undefined,target); }
    }
    for (const { target, reps } of targets.values()) {
      for (const rep of reps.values()) {
        plannedClicks++;
        try {
          const expectedState=responses.get(target.request);
          if(!expectedState)fail('CLICK_TARGET_NOT_LOADED');
          await clickTarget(page, server.origin, target, rep, expectedState);
          clicks++;
          if(rep.activation==='keyboard')keyboardClicks++;
          if(rep.activation==='order-picker')orderPickerClicks++;
        } catch (error) { note(error,rep.source,target,rep.viewport.width); }
      }
    }
    if (!clicks || clicks!==plannedClicks || !keyboardClicks || !orderPickerClicks || pageErrors || localErrors || externalRequests) note(Error('BROWSER_BOUNDARY'));
    if (Object.keys(failures).length) {
      console.log(JSON.stringify({status:'D05_T3_RENDERED_LINK_AUDIT_FAIL',declaredPages:declaredPages.size,publicPages:pagesLoaded,linkOccurrences,uniqueLocalTargets:targets.size,clicks,pageErrors,localErrors,externalRequests,failures}));
      fail('QUALIFICATION');
    }
    console.log(JSON.stringify({
      status: 'D05_T3_RENDERED_LINK_AUDIT_PASS_NOT_PRODUCT_ACCEPTED', declaredPages: declaredPages.size,
      publicPages: pagesLoaded, menuPages, linkOccurrences, uniqueLocalTargets: targets.size,
      fragments, clicks, plannedClicks, keyboardClicks, orderPickerClicks, assetTargets, privateTargets, externalTargets: external.size, contactTargets: contacts.size,
      externalLinksFetched: false, protectedNavigationAccepted: false, productAccepted: false,
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
