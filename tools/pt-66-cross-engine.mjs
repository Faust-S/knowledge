#!/usr/bin/env node
// Cross-engine PT verification. Only numeric counts and public paths leave runner.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const root = resolve(process.env.PT_SITE_DIR || "pt-site");
const origin = new URL(process.env.PT_BASE || "http://127.0.0.1:4388/");
const requireProject = createRequire(join(root, "package.json"));
const { firefox, webkit } = requireProject("playwright");
const routesSource = readFileSync(join(root, "src/lib/static-routes.ts"), "utf8");
const match = routesSource.match(/export const STATIC_ROUTES:[\s\S]*?=\s*\[([\s\S]*?)\];/);
if (!match) throw Error("PT_XENGINE_ROUTE_LIST_MISSING");
const paths = [...match[1].matchAll(/^\s*"(\/[^"]*)",?\s*$/gm)].map(m => m[1]);
if (paths.length !== 66 || new Set(paths).size !== 66) throw Error("PT_XENGINE_EXPECT_66");
const pt = p => p === "/" ? "/pt/" : "/pt" + p;
const failures = [];
const totals = [];
const report = (engine, mode, path, code, detail = "") => {
  if (failures.length < 100) failures.push({engine, mode, path, code, detail: String(detail).slice(0, 110)});
};
for (const [name, type] of [["firefox", firefox], ["webkit", webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const mode of [
      { name: "mobile-dark", width: 375, height: 812, theme: "dark" },
      { name: "mobile-light", width: 375, height: 812, theme: "light" },
      { name: "desktop-dark", width: 1440, height: 900, theme: "dark" },
      { name: "desktop-light", width: 1440, height: 900, theme: "light" },
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: mode.width, height: mode.height },
        reducedMotion: "reduce",
      });
      await ctx.addInitScript(theme => { localStorage.setItem("iwxa-theme", theme); }, mode.theme);
      const page = await ctx.newPage();
      const runtimeErrors = [];
      page.on("pageerror", error => runtimeErrors.push(String(error?.message || error).slice(0, 100)));
      let passed = 0, navigated = 0, attempted = 0;
      for (const ru of paths) {
        const path = pt(ru);
        const errorsBefore = failures.length;
        runtimeErrors.length = 0;
        try {
          const response = await page.goto(new URL(path, origin).href, { waitUntil: "domcontentloaded", timeout: 45000 });
          if (response?.status() !== 200) throw Error("HTTP_" + response?.status());
          await page.waitForSelector('main[data-client-ready]', { timeout: 20000 });
          await page.waitForTimeout(90);
          const result = await page.evaluate(() => {
            const main = document.querySelector("main");
            const html = document.documentElement;
            return {
              pathname: location.pathname,
              lang: html.lang,
              theme: html.dataset.theme,
              title: document.title.length,
              h1: !!main?.querySelector("h1"),
              text: (main?.innerText || "").length,
              overflow: html.scrollWidth - html.clientWidth,
              canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
              ruLinks: [...(main?.querySelectorAll("a[href]") || [])].filter(a => {
                const url = new URL(a.href, location.href);
                return url.origin === location.origin && /^\/(science|projects|tools|life-plus|competencies|map|about|contacts|culture|ecosystem|technologies)\/?/.test(url.pathname)
                  && !/russo|original/i.test(a.textContent || "");
              }).length,
            };
          });
          for (const [code, invalid, detail] of [
            ["PATH", result.pathname !== path, result.pathname],
            ["LANG", result.lang !== "pt-BR", result.lang],
            ["THEME", result.theme !== mode.theme, result.theme],
            ["CANONICAL", result.canonical !== "https://iwxa.ru" + path, result.canonical],
            ["CONTENT", result.title === 0 || !result.h1 || result.text < 40, result.text],
            ["HORIZONTAL_OVERFLOW", result.overflow > 3, result.overflow],
            ["RU_NAVIGATION_LINKS", result.ruLinks > 0, result.ruLinks],
          ]) if (invalid) report(name, mode.name, path, code, detail);
          if (runtimeErrors.length) report(name, mode.name, path, "PAGEERROR", runtimeErrors.slice(0,2).join("|"));
          // One real PT navigation from each page (other than the root when no distinct link).
          const target = await page.evaluate(() => {
            const as = [...(document.querySelector("main")?.querySelectorAll("a[href]") || [])];
            const a = as.find(el => {
              if (el.target === "_blank" || el.hasAttribute("download")) return false;
              const u = new URL(el.href, location.href);
              const b = el.getBoundingClientRect();
              return u.origin === location.origin && u.pathname.startsWith("/pt/")
                && u.pathname !== location.pathname && b.width > 1 && b.height > 1;
            });
            if (!a) return null;
            const expected = new URL(a.href, location.href).pathname;
            a.click();
            return expected;
          });
          if (target) {
            attempted++;
            try {
              await page.waitForURL(url => url.pathname === target, { timeout: 10000 });
              navigated++;
            } catch { report(name, mode.name, path, "PT_CLICK_NAVIGATION", target); }
          }
        } catch (e) {
          report(name, mode.name, path, "SSR_OR_HYDRATION", e?.message || e);
        }
        if (failures.length === errorsBefore) passed++;
      }
      // F02 after real rotation; check business caption bounds and dock intersection.
      await page.goto(new URL("/pt/", origin).href, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector('main[data-client-ready]', { timeout: 20000 });
      const verifyOrbit = async step => {
        await page.waitForTimeout(200);
        const data = await page.evaluate(() => {
          const label = document.querySelector(".home-shell--pt .orbital-planet--amber .orbital-planet__label");
          const dock = document.querySelector(".home-shell--pt .orbital-sidedock");
          if (!label) return { missing: true };
          const l = label.getBoundingClientRect();
          const d = dock?.getBoundingClientRect();
          const dockActive = !!dock && getComputedStyle(dock).display !== "none" && getComputedStyle(dock).visibility !== "hidden";
          return {
            label: (label.textContent || "").trim().includes("PROJETOS"),
            left: l.left, right: l.right, viewport: innerWidth,
            overlap: dockActive && !!d && l.left < d.right && l.right > d.left && l.top < d.bottom && l.bottom > d.top,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        if (data.missing || !data.label || data.left < 4 || data.right > data.viewport - 4 ||
          data.overlap || data.overflow > 3)
          report(name, mode.name, "/pt/", "F02_" + step, JSON.stringify(data));
      };
      await verifyOrbit("initial");
      for (const [step, symbol] of [["left","⟲"],["right","⟳"],["center","⊙"]]) {
        const clicked = await page.evaluate(symbol => {
          const el = [...document.querySelectorAll(".orbital-sidedock button")].find(x => x.textContent?.trim() === symbol);
          if (!el || el.disabled) return false;
          el.click(); return true;
        }, symbol);
        if (!clicked) report(name, mode.name, "/pt/", "F02_CONTROL_" + step);
        await verifyOrbit(step);
      }
      totals.push({engine:name,mode:mode.name,passed,navigated,attempted});
      console.log("PT_XENGINE_" + name.toUpperCase() + "_" + mode.name.toUpperCase().replaceAll("-","_") + "=" + passed + "/66 NAV=" + navigated + "/" + attempted);
      await ctx.close();
    }
  } finally { await browser.close(); }
}
console.log("PT_XENGINE_PAGE_VIEWS=" + totals.reduce((n,x)=>n+x.passed,0) + "/528");
console.log("PT_XENGINE_NAVIGATIONS=" + totals.reduce((n,x)=>n+x.navigated,0) +
  "/" + totals.reduce((n,x)=>n+x.attempted,0));
console.log("PT_XENGINE_FAILURES=" + failures.length);
for (const x of failures) console.error(["PT_XENGINE_FAIL",x.engine,x.mode,x.path,x.code,x.detail].join(" | "));
if (failures.length) process.exitCode = 1;
