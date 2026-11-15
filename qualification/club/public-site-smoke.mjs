import { writeFileSync } from 'node:fs';
const base = 'https://club.iwxa.ru';
const paths = ['/', '/robots.txt', '/sitemap.xml'];
const results = [];
for (const path of paths) {
  const url = new URL(path, base).href;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow', headers: { 'user-agent': 'IWXA-Club-qualification/1.0' } });
    const body = await response.text();
    const expected = path === '/' ? /<html[\\s>]/i.test(body) && /<body[\\s>]/i.test(body) : response.ok;
    results.push({ path, status: response.status, ok: response.ok && expected, bytes: Buffer.byteLength(body), finalUrl: response.url });
  } catch (error) {
    results.push({ path, ok: false, error: String(error) });
  }
}
const report = { target: base, mode: 'PUBLIC_HTTP_SMOKE_ONLY', sourceCodeAccess: false, browserInteraction: false, privateTokens: false, results, pass: results.every(r => r.ok) };
writeFileSync('qualification/club/report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exitCode = 1;
