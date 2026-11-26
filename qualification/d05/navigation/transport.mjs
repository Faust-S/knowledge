export function documentResponseProblem(response, origin) {
  if (!response) return 'PAGE_HTTP_NO_RESPONSE';
  const status = response.status();
  if (!Number.isInteger(status) || status < 100 || status > 599) return 'PAGE_HTTP_STATUS_INVALID';
  if (!response.ok()) return 'PAGE_HTTP_STATUS_' + status;
  const type = response.headers()['content-type'] || '';
  if (!/^text\/html(?:\s*;|$)/i.test(type)) return 'PAGE_HTTP_MIME';
  if (new URL(response.url()).origin !== origin) return 'PAGE_REDIRECT';
  return null;
}

export async function withFreshAuditPage(browser, configure, visit) {
  const page = await browser.newPage();
  try {
    if (page.url() !== 'about:blank') throw Error('D05_T3_RENDERED_LINK_NOT_FRESH');
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    await configure(page);
    return await visit(page);
  } finally {
    await page.close();
  }
}

export async function loadAuditDocument(page, origin, request) {
  if (page.url() !== 'about:blank') throw Error('D05_T3_RENDERED_LINK_NOT_FRESH');
  const response = await page.goto(origin + request, {waitUntil:'networkidle0',timeout:30000});
  const problem = documentResponseProblem(response, origin);
  if (problem) throw Error('D05_T3_RENDERED_LINK_' + problem);
  return response;
}
