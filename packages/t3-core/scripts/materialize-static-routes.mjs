#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import {
  dirname,
  join,
} from "node:path";

const dist = join(process.cwd(), "dist");

const routes = [
  {
    source: "exchange.html",
    target: "exchange/index.html",
    base: "/workspace/exchange/",
  },
  {
    source: "lifecycle.html",
    target: "lifecycle/index.html",
    base: "/workspace/lifecycle/",
  },
  {
    source: "studio.html",
    target: "studio/index.html",
    base: "/workspace/studio/",
  },
];

for (const route of routes) {
  const source = join(dist, route.source);
  const target = join(dist, route.target);

  if (!existsSync(source)) {
    throw new Error(
      `Missing Vite entry: dist/${route.source}`,
    );
  }

  const html = readFileSync(source, "utf8");

  if (
    !html.includes(
      `<base href="${route.base}"`,
    )
  ) {
    throw new Error(
      `Invalid base in dist/${route.source}`,
    );
  }

  mkdirSync(dirname(target), {
    recursive: true,
  });

  rmSync(target, { force: true });
  renameSync(source, target);
}

console.log("static directory routes materialized");
