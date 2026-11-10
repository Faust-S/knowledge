#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
  relative,
} from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const errors = [];

const routes = [
  ["index.html", "/workspace/"],
  [
    "exchange/index.html",
    "/workspace/exchange/",
  ],
  [
    "lifecycle/index.html",
    "/workspace/lifecycle/",
  ],
];

for (const [file, base] of routes) {
  const fullPath = join(dist, file);

  if (!existsSync(fullPath)) {
    errors.push(`dist/${file} missing`);
    continue;
  }

  const html = readFileSync(fullPath, "utf8");

  if (!html.includes(`<base href="${base}"`)) {
    errors.push(
      `dist/${file} has invalid base href`,
    );
  }

  const absoluteAssets = [
    ...html.matchAll(
      /(?:src|href)=["'](\/[^"']+)["']/g,
    ),
  ].map((match) => match[1]);

  for (const asset of absoluteAssets) {
    if (
      asset.startsWith("/workspace/") ||
      asset === "/workspace/"
    ) {
      continue;
    }

    errors.push(
      `dist/${file} uses external path ${asset}`,
    );
  }
}

for (const flat of [
  "exchange.html",
  "lifecycle.html",
]) {
  if (existsSync(join(dist, flat))) {
    errors.push(`dist/${flat} must not exist`);
  }
}

const forbiddenNames = new Set([
  "sw.js",
  "service-worker.js",
  "workbox-sw.js",
  "manifest.webmanifest",
  "_worker.js",
]);

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    const rel = relative(root, fullPath);

    if (stat.isDirectory()) {
      if (
        entry === "server" ||
        entry === "functions" ||
        entry === "_server"
      ) {
        errors.push(
          `forbidden directory: ${rel}`,
        );
      }

      walk(fullPath);
      continue;
    }

    if (
      forbiddenNames.has(entry) ||
      entry.endsWith(".map")
    ) {
      errors.push(`forbidden file: ${rel}`);
    }
  }
}

if (!existsSync(dist)) {
  errors.push("dist missing");
} else {
  walk(dist);
}

if (errors.length > 0) {
  console.error("verify-dist failed");

  for (const error of errors) {
    console.error(` - ${error}`);
  }

  process.exit(1);
}

console.log("verify-dist passed");
