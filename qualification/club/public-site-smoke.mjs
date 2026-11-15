import { writeFileSync } from 'node:fs';
const base = process.env.CLUB_BASE_URL || 'https://club.iwxa.ru';
const routes = ['/', '/profile/', '/tools/personal-economy/', '/tools/additional-income/', '/tools/resources-and-skills/', '/roles/', '/projects/', '/tools/action-route/', '/workspace/'];
const results = [];
const errors = [];
const assetUrls = new Set();
const internalLinks = new Set();
for (const path of routes) {
  const url = new URL(path, base).href;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'follow', headers: { 'user-agent': 'IWXA-Club-site-qualification/1.1' } });
    const html = await response.text();
    const isHtml = (response.headers.get('content-type') || '').toLowerCase().includes('text/html');
    const hasDocument = html.toLowerCase().includes('<html') && html.toLowerCase().includes('<body');
    const hasMain = html.toLowerCase().includes('<main');
    const isSameOrigin = new URL(response.url).origin === new URL(base).origin;
    const ok = response.ok && isHtml && hasDocument && isSameOrigin;
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const candidate = new URL(match[1], url);
      if (candidate.origin !== new URL(base).origin) continue;
      if (candidate.pathname.endsWith('.js') || candidate.pathname.endsWith('.css')) assetUrls.add(candidate.href);
      else if (match[0].toLowerCase().startsWith('href=') && !candidate.hash && !candidate.search && !candidate.pathname.includes('.')) internalLinks.add(candidate.pathname);
    }
    const entry = { path, status: response.status, ok, isHtml, hasDocument, hasMain, isSameOrigin, bytes: Buffer.byteLength(html), finalUrl: response.url, forms: html.toLowerCase().split('<form').length - 1, buttons: html.toLowerCase().split('<button').length - 1 };
    results.push(entry);
    if (!ok) errors.push({ path, reason: 'HTTP, HTML document or origin check failed', entry });
  } catch (error) {
    const entry = { path, ok: false, error: String(error) };
    results.push(entry);
    errors.push(entry);
  }
}
const untestedLinks = [...internalLinks].filter(path => !routes.includes(path));
const assets = [];
for (const url of [...assetUrls].slice(0, 100)) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const entry = { url, status: response.status, ok: response.ok, type: response.headers.get('content-type') };
    assets.push(entry);
    if (!entry.ok) errors.push({ url, reason: 'Referenced JS/CSS asset unavailable' });
  } catch (error) {
    assets.push({ url, ok: false, error: String(error) });
    errors.push({ url, reason: String(error) });
  }
}
const report = { target: base, mode: 'PUBLIC_HTTP_ROUTE_QUALIFICATION', sourceCodeAccess: false, browserInteraction: false, privateTokens: false, coverage: { expectedAvailableServiceRoutes: 8, checkedAvailableServiceRoutes: 8, routeCount: routes.length, checkedJsCssAssets: assets.length, functionalInteractions: 0 }, results, assets, untestedLinks, coverageGaps: ['No browser JavaScript execution', 'No form submission', 'No calculations', 'No session persistence', ...(assets.length === 0 ? ['No external JS/CSS assets discovered: asset check has zero coverage'] : [])], errors, pass: errors.length === 0 };
writeFileSync('qualification/club/report.json', JSON.stringify(report, null, 2) + String.fromCharCode(10));
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
