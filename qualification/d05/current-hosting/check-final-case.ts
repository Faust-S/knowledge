import assert from "node:assert/strict";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { serveStatic } from "./lib/serve";
import { resolveBrowserExecutable } from "./lib/resolve-browser-executable";

const path = "/keisy/240-fartukov/";
const retained = "https://ufa.sarafanovo.com/product/tkan-sarzha-150-sm-260-gr-041-seryj/";
const server = await serveStatic(resolve(process.cwd(), "dist"));
let browser;
try {
  const resolved = await resolveBrowserExecutable();
  browser = await puppeteer.launch({
    executablePath: resolved.executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  for (const width of [1440, 375]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    let pageErrors = 0;
    let localErrors = 0;
    try {
      await page.setViewport({ width, height: width < 700 ? 812 : 900 });
      await page.setCacheEnabled(false);
      await page.setBypassServiceWorker(true);
      page.on("pageerror", () => pageErrors++);
      page.on("response", r => {
        if (r.url().startsWith(server.origin + "/") && r.status() >= 400) localErrors++;
      });
      const response = await page.goto(server.origin + path, { waitUntil: "networkidle0" });
      assert.ok(response?.ok(), "D05_FINAL_CASE_HTTP");
      await page.waitForFunction(() =>
        (window as unknown as { __APP_READY__?: boolean }).__APP_READY__ === true);
      const checks = await page.evaluate((retained) => {
        const link = document.querySelector<HTMLAnchorElement>('a[href="' + retained + '"]');
        return {
          h1: !!document.querySelector("h1")?.textContent?.includes("240"),
          reference: !!link && link.getClientRects().length > 0 && link.target === "_blank" &&
            link.rel.split(" ").includes("noopener"),
          noBroken: !document.querySelector('a[href*="msk.sarafanovo.com/category/tekhnicheskie-tkani/seryy/"]'),
          noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
      }, retained);
      for (const [key, ok] of Object.entries(checks)) assert.equal(ok, true, "D05_FINAL_CASE_" + key.toUpperCase());
      const link = await page.$('a[href="' + retained + '"]');
      assert.ok(link);
      await link.focus();
      assert.equal(await page.evaluate(retained => document.activeElement?.getAttribute("href") === retained, retained), true, "D05_FINAL_CASE_FOCUS");
      assert.equal(pageErrors, 0, "D05_FINAL_CASE_PAGE_ERRORS");
      assert.equal(localErrors, 0, "D05_FINAL_CASE_ASSET_ERRORS");
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({status:"D05_FINAL_CASE_PASS",widths:[1440,375],retainedReference:true,keyboardFocus:true}));
} finally {
  await browser?.close();
  await server.close();
}
