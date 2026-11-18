#!/usr/bin/env node
// IWXA PT browser qualification. Reads a private checkout only at runtime.
// No private source, HTML, screenshots or page text are printed or uploaded.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const root = resolve(process.env.PT_SITE_DIR || "pt-site");
const base = new URL(process.env.PT_BASE || "http://127.0.0.1:4387/");
const requireProject = createRequire(join(root, "package.json"));
const puppeteer = requireProject("puppeteer");
const source = readFileSync(join(root, "src/lib/static-routes.ts"), "utf8");
const match = source.match(/export const STATIC_ROUTES:[\s\S]*?=\s*\[([\s\S]*?)\];/);
if (!match) throw new Error("PT_BQA_ROUTE_SOURCE_MISSING");
const routes = [...match[1].matchAll(/^\s*"(\/[^"]*)",?\s*$/gm)].map(x => x[1]);
if (routes.length !== 66 || new Set(routes).size !== 66) throw new Error("PT_BQA_EXPECT_66");
const routeSet = new Set(routes);
const pt = route => route === "/" ? "/pt/" : "/pt" + route;
const errors = [];
const rows = [];
const maxErrors = 75;
const fail = (pass, route, code, detail = "") => {
  if (errors.length < maxErrors) errors.push([pass, route, code, String(detail).slice(0, 160)]);
};
const browser = await puppeteer.launch({
  headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
page.setDefaultNavigationTimeout(45000);
const pageErrors = [];
page.on("pageerror", err => pageErrors.push(String(err.message || err).slice(0, 160)));
async function visit(path, wait = true) {
  const response = await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!response || response.status() !== 200) throw new Error("HTTP_" + (response?.status() || "NONE"));
  if (wait) await page.waitForSelector("main[data-client-ready]", { timeout: 20000 });
}
try {
  for (const preset of [
    { name: "mobile_dark", width: 375, height: 812, theme: "dark" },
    { name: "mobile_light", width: 375, height: 812, theme: "light" },
    { name: "desktop_dark", width: 1440, height: 900, theme: "dark" },
    { name: "desktop_light", width: 1440, height: 900, theme: "light" },
  ]) {
    await page.setViewport({ width: preset.width, height: preset.height });
    await visit("/pt/");
    await page.evaluate(theme => window.localStorage.setItem("iwxa-theme", theme), preset.theme);
    let passed = 0;
    let attempted = 0;
    let changed = 0;
    let navigated = 0;
    let navAttempted = 0;
    for (const route of routes) {
      pageErrors.length = 0;
      const path = pt(route);
      let pagePassed = true;
      const record = (code, detail) => { pagePassed = false; fail(preset.name, path, code, detail); };
      try {
        await visit(path);
        const info = await page.evaluate(({ routeSet, path }) => {
          const html = document.documentElement;
          const main = document.querySelector("main");
          const text = main?.innerText?.trim() || "";
          const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "";
          const ruLeaks = [];
          const routes = new Set(routeSet);
          for (const a of main?.querySelectorAll("a[href]") || []) {
            const url = new URL(a.href, location.href);
            if (url.origin !== location.origin) continue;
            const hrefPath = url.pathname.replace(/\/?$/, "/");
            if (routes.has(hrefPath) && !hrefPath.startsWith("/pt/")) {
              const explanation = (a.textContent || "").trim().toLowerCase();
              if (!explanation.includes("russo") && !explanation.includes("original"))
                ruLeaks.push(hrefPath);
            }
          }
          return {
            lang: html.lang, path: location.pathname, theme: html.dataset.theme,
            canonical, title: document.title,
            h1: !!main?.querySelector("h1"),
            textLength: text.length,
            width: html.scrollWidth,
            client: html.clientWidth,
            leakCount: new Set(ruLeaks).size,
            leakExamples: [...new Set(ruLeaks)].slice(0, 3),
            buttons: [...(main?.querySelectorAll('button:not(:disabled), [role="tab"]') || [])]
              .filter(el => {
                const box = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return box.width > 1 && box.height > 1 &&
                  style.visibility !== "hidden" && style.display !== "none";
              }).length,
          };
        }, { routeSet: [...routeSet], path });
        if (info.path !== path) record("WRONG_ROUTE", info.path);
        if (info.lang !== "pt-BR") record("LANG", info.lang);
        if (info.theme !== preset.theme) record("THEME_PERSISTENCE", preset.theme + "->" + info.theme);
        if (info.canonical !== "https://iwxa.ru" + path) record("CANONICAL", info.canonical);
        if (!info.title || !info.h1 || info.textLength < 40) record("EMPTY_DOCUMENT", info.textLength);
        if (info.width > info.client + 3) record("HORIZONTAL_OVERFLOW", info.width + "/" + info.client);
        if (info.leakCount) record("RU_LINK_FOR_TRANSLATED_ROUTE", info.leakExamples.join(","));
        if (pageErrors.length) record("PAGEERROR", pageErrors.slice(0, 2).join(";"));
        if (info.buttons) {
          attempted++;
          const pre = await page.evaluate(() => {
            const root = document.querySelector("main");
            return JSON.stringify({
              text: (root?.innerText || "").slice(0, 20000),
              states: [...(root?.querySelectorAll("[aria-selected], [aria-pressed]") || [])]
                .map(n => [n.getAttribute("aria-selected"), n.getAttribute("aria-pressed")]).slice(0, 80),
            });
          });
          const clicked = await page.evaluate(() => {
            const root = document.querySelector("main");
            const candidates = [...(root?.querySelectorAll('[role="tab"], button[aria-pressed], button:not(:disabled)') || [])]
              .filter(el => {
                const b = el.getBoundingClientRect();
                return b.width > 1 && b.height > 1 && getComputedStyle(el).visibility !== "hidden";
              });
            const candidate = candidates.find(el => !el.matches('button[type="submit"]') && !el.closest("form"));
            if (!candidate) return false;
            candidate.click();
            return true;
          });
          if (clicked) {
            await new Promise(r => setTimeout(r, 150));
            const post = await page.evaluate(() => {
              const root = document.querySelector("main");
              return JSON.stringify({
                text: (root?.innerText || "").slice(0, 20000),
                states: [...(root?.querySelectorAll("[aria-selected], [aria-pressed]") || [])]
                  .map(n => [n.getAttribute("aria-selected"), n.getAttribute("aria-pressed")]).slice(0, 80),
              });
            });
            if (post !== pre) changed++;
          }
        }
        // Navigate a real same-origin Portuguese link on every page that has one.
        // This detects regressions that cannot be seen from hrefs or hydration alone.
        const clickedPath = await page.evaluate(() => {
          const anchors = [...(document.querySelector("main")?.querySelectorAll("a[href]") || [])];
          const target = anchors.find(a => {
            if (a.target === "_blank" || a.hasAttribute("download")) return false;
            const box = a.getBoundingClientRect();
            if (box.width < 1 || box.height < 1) return false;
            const href = new URL(a.href, location.href);
            return href.origin === location.origin && href.pathname.startsWith("/pt/") &&
              href.pathname !== location.pathname;
          });
          if (!target) return null;
          const expected = new URL(target.href, location.href).pathname;
          target.click();
          return expected;
        });
        if (clickedPath) {
          navAttempted++;
          try {
            await page.waitForFunction(expected => location.pathname === expected,
              { timeout: 10000 }, clickedPath);
            navigated++;
          } catch (e) { record("PT_NAVIGATION_CLICK", clickedPath); }
        }
      } catch (e) {
        record("NAVIGATION_OR_HYDRATION", String(e?.message || e));
      }
      if (pagePassed) passed++;
      rows.push({ pass: preset.name, route: path, ok: pagePassed });
    }
    console.log("PT_BQA_" + preset.name.toUpperCase() + "_PAGES=" + passed + "/66");
    console.log("PT_BQA_" + preset.name.toUpperCase() + "_ACTION_CANDIDATES=" + attempted);
    console.log("PT_BQA_" + preset.name.toUpperCase() + "_VISIBLE_STATE_CHANGES=" + changed);
    console.log("PT_BQA_" + preset.name.toUpperCase() + "_NAVIGATIONS=" + navigated + "/" + navAttempted);
  }

  // F02: physical browser geometry after real controls and in both themes.
  for (const viewport of [375, 478, 820, 1440]) {
    await page.setViewport({ width: viewport, height: 900 });
    for (const theme of ["dark", "light"]) {
      await visit("/pt/");
      await page.evaluate(mode => { document.documentElement.dataset.theme = mode; }, theme);
      const check = async step => {
        await new Promise(r => setTimeout(r, 220));
        const result = await page.evaluate(() => {
          const label = document.querySelector(".home-shell--pt .orbital-planet--amber .orbital-planet__label");
          const dock = document.querySelector(".home-shell--pt .orbital-sidedock");
          if (!label) return { missing: true };
          const l = label.getBoundingClientRect();
          const d = dock?.getBoundingClientRect();
          const dockShown = !!dock && getComputedStyle(dock).display !== "none" &&
            getComputedStyle(dock).visibility !== "hidden";
          const intersect = dockShown && d && l.left < d.right && l.right > d.left &&
            l.top < d.bottom && l.bottom > d.top;
          return {
            left: Math.round(l.left), right: Math.round(l.right), top: Math.round(l.top),
            text: (label.textContent || "").trim(), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            dockOverlap: !!intersect,
            tooLeft: l.left < 4, tooRight: l.right > innerWidth - 4,
          };
        });
        if (result.missing || !result.text?.includes("PROJETOS") || result.tooLeft || result.tooRight ||
          result.dockOverlap || result.overflow > 3)
          fail("F02", viewport + "/" + theme + "/" + step, "ORBIT_CAPTION", JSON.stringify(result));
      };
      await check("initial");
      for (const [step, symbol] of [["left", "⟲"], ["right", "⟳"], ["center", "⊙"]]) {
        const found = await page.evaluate(symbol => {
          const btn = [...document.querySelectorAll(".orbital-sidedock button")]
            .find(el => el.textContent?.trim() === symbol);
          if (btn && !btn.disabled) { btn.click(); return true; }
          return false;
        }, symbol);
        if (!found) fail("F02", viewport + "/" + theme, "CONTROL_NOT_FOUND", step);
        await check(step);
      }
    }
  }

  // Previously observed F01: ArtBazy link from PT competencies must remain in PT.
  await page.setViewport({ width: 1440, height: 900 });
  await visit("/pt/competencies/");
  const link = await page.$('main a[href="/pt/projects/artbazy/"]');
  if (!link) fail("F01", "/pt/competencies/", "ARTBAZY_PT_LINK_MISSING");
  else {
    await link.evaluate(el => el.scrollIntoView({ block: "center" }));
    await link.click();
    try {
      await page.waitForFunction(() => location.pathname === "/pt/projects/artbazy/", { timeout: 10000 });
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== "pt-BR") fail("F01", "/pt/projects/artbazy/", "ARTBAZY_NOT_PT", lang);
    } catch (e) { fail("F01", "/pt/competencies/", "ARTBAZY_NAVIGATION", String(e?.message || e)); }
  }
  // Theme switch and mobile menu are live React controls, not SSR assertions.
  await visit("/pt/");
  const before = await page.evaluate(() => document.documentElement.dataset.theme || "dark");
  await page.$eval(".atlas-theme-toggle", el => el.click());
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  if (after === before || !["dark", "light"].includes(after)) fail("UX", "/pt/", "THEME_TOGGLE", before + "->" + after);
  await page.setViewport({ width: 375, height: 812 });
  await visit("/pt/");
  const burger = await page.$(".atlas-burger");
  if (!burger) fail("UX", "/pt/", "MOBILE_MENU_MISSING");
  else {
    await burger.click();
    const expanded = await page.$eval(".atlas-burger", el => el.getAttribute("aria-expanded"));
    if (expanded !== "true") fail("UX", "/pt/", "MOBILE_MENU_OPEN_FAILED");
    await page.keyboard.press("Escape");
    const collapsed = await page.$eval(".atlas-burger", el => el.getAttribute("aria-expanded"));
    if (collapsed !== "false") fail("UX", "/pt/", "MOBILE_MENU_ESCAPE_FAILED");
  }

  console.log("PT_BQA_VISITS=" + rows.length);
  console.log("PT_BQA_FAILURE_COUNT=" + errors.length);
  for (const [pass, route, code, detail] of errors) console.error(["PT_BQA_FAIL", pass, route, code, detail].join(" | "));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
