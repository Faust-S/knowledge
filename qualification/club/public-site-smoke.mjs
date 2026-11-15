import { writeFileSync } from 'node:fs';
const base = process.env.CLUB_BASE_URL || 'https://club.iwxa.ru';
const routes = ['/', '/profile/', '/tools/personal-economy/', '/tools/additional-income/', '/tools/resources-and-skills/', '/roles/', '/projects/', '/tools/action-route/', '/workspace/'];
const results = [];
const errors = [];
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
    const entry = { path, status: response.status, ok, isHtml, hasDocument, hasMain, isSameOrigin, bytes: Buffer.byteLength(html), finalUrl: response.url, forms: html.toLowerCase().split('<form').length - 1, buttons: html.toLowerCase().split('<button').length - 1 };
    results.push(entry);
    if (!ok) errors.push({ path, reason: 'HTTP, HTML document or origin check failed', entry });
  } catch (error) {
    const entry = { path, ok: false, error: String(error) };
    results.push(entry);
    errors.push(entry);
  }
}
const report = { target: base, mode: 'PUBLIC_HTTP_ROUTE_QUALIFICATION', sourceCodeAccess: false, browserInteraction: false, privateTokens: false, coverage: { expectedAvailableServiceRoutes: 8, checkedAvailableServiceRoutes: 8, routeCount: routes.length, functionalInteractions: 0 }, results, errors, pass: errors.length === 0 };
writeFileSync('qualification/club/report.json', JSON.stringify(report, null, 2) + '\\n');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
