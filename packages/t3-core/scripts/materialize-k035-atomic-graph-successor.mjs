#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { materializeFactory2K035Products } from "./factory2-k035-source-materializer.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error("K035_SUCCESSOR_ZIP_EOCD_MISSING");
}

function safeTarget(root, name) {
  const normalized = String(name).replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`K035_SUCCESSOR_ZIP_PATH_INVALID:${name}`);
  }
  const target = resolve(root, ...normalized.split("/"));
  const base = resolve(root);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`K035_SUCCESSOR_ZIP_PATH_ESCAPE:${name}`);
  }
  return target;
}

function extractZip(zipBytes, outputRoot) {
  const eocd = findEocd(zipBytes);
  const entries = zipBytes.readUInt16LE(eocd + 10);
  const centralSize = zipBytes.readUInt32LE(eocd + 12);
  const centralOffset = zipBytes.readUInt32LE(eocd + 16);
  if (entries === 0 || entries === 0xffff) {
    throw new Error("K035_SUCCESSOR_ZIP_ENTRY_COUNT_INVALID");
  }
  if (centralOffset + centralSize !== eocd) {
    throw new Error("K035_SUCCESSOR_ZIP_CENTRAL_BOUNDS_INVALID");
  }

  const inventory = [];
  let offset = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (zipBytes.readUInt32LE(offset) !== CENTRAL) {
      throw new Error("K035_SUCCESSOR_ZIP_CENTRAL_ENTRY_INVALID");
    }
    const flags = zipBytes.readUInt16LE(offset + 8);
    const method = zipBytes.readUInt16LE(offset + 10);
    const compressedSize = zipBytes.readUInt32LE(offset + 20);
    const uncompressedSize = zipBytes.readUInt32LE(offset + 24);
    const nameLength = zipBytes.readUInt16LE(offset + 28);
    const extraLength = zipBytes.readUInt16LE(offset + 30);
    const commentLength = zipBytes.readUInt16LE(offset + 32);
    const localOffset = zipBytes.readUInt32LE(offset + 42);
    if ((flags & 1) !== 0) throw new Error("K035_SUCCESSOR_ZIP_ENCRYPTED_UNSUPPORTED");
    const name = zipBytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) {
      mkdirSync(safeTarget(outputRoot, name), { recursive: true });
      continue;
    }
    if (zipBytes.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error(`K035_SUCCESSOR_ZIP_LOCAL_HEADER_INVALID:${name}`);
    }
    const localNameLength = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = zipBytes.subarray(dataOffset, dataOffset + compressedSize);
    let bytes;
    if (method === 0) bytes = Buffer.from(compressed);
    else if (method === 8) bytes = inflateRawSync(compressed);
    else throw new Error(`K035_SUCCESSOR_ZIP_METHOD_UNSUPPORTED:${method}:${name}`);
    if (bytes.length !== uncompressedSize) {
      throw new Error(`K035_SUCCESSOR_ZIP_SIZE_MISMATCH:${name}`);
    }
    const target = safeTarget(outputRoot, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    inventory.push({
      path: relative(outputRoot, target).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return inventory.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(root, out = []) {
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".md", ".html", ".css",
]);

function discoverKernelSurfaces(root) {
  const needles = [
    "putObject",
    "putRelation",
    "deleteRelation",
    "transaction",
    "indexedDB",
    "IDBTransaction",
    "granted_operations",
    "ALL_OPERATIONS",
    "LocalStore",
  ];
  const matches = [];
  for (const file of walk(root)) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const bytes = readFileSync(file);
    if (bytes.length > 5_000_000) continue;
    const source = bytes.toString("utf8");
    const found = needles.filter((needle) => source.includes(needle));
    if (found.length) {
      matches.push({
        path: relative(root, file).replaceAll("\\", "/"),
        matches: found,
        sha256: sha256(bytes),
      });
    }
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

export function materializeK035AtomicGraphSuccessor({
  authorityPath,
  repositoryRoot,
  outputRoot,
}) {
  const out = resolve(outputRoot);
  if (existsSync(out)) throw new Error("K035_SUCCESSOR_OUTPUT_EXISTS");
  mkdirSync(out, { recursive: true });

  const productRoot = resolve(out, "exact-products");
  const materialized = materializeFactory2K035Products({
    authorityPath,
    repositoryRoot,
    outputRoot: productRoot,
    writeEnvelope: false,
  });

  const kernelZipPath = resolve(productRoot, materialized.components.kernel.artifact);
  const kernelZipBytes = readFileSync(kernelZipPath);
  if (sha256(kernelZipBytes) !== materialized.components.kernel.sha256) {
    throw new Error("K035_SUCCESSOR_KERNEL_PACKAGE_IDENTITY_MISMATCH");
  }

  const sourceRoot = resolve(out, "kernel-source-base");
  mkdirSync(sourceRoot, { recursive: true });
  const inventory = extractZip(kernelZipBytes, sourceRoot);
  const discovery = discoverKernelSurfaces(sourceRoot);

  const manifest = {
    schema: "IWXA_T2_K035_ATOMIC_GRAPH_SUCCESSOR_BASE_V1",
    status: "MATERIALIZED_UNMODIFIED_SUCCESSOR_BASE",
    predecessor: {
      kernelTarget: "0.3.5",
      sourcePackage: materialized.components.kernel.artifact,
      sourcePackageSha256: materialized.components.kernel.sha256,
      sourceAuthoritySha256: materialized.sourceAuthoritySha256,
    },
    successor: {
      purpose: "T2-GAP-ATOMIC-RESULT-GRAPH-MUTATION",
      operation: "t1.commitObjectGraph",
      sourceRoot: "kernel-source-base",
      sourceModified: false,
    },
    inventory,
    discoveryRef: "KERNEL_SURFACE_DISCOVERY.json",
    immutablePredecessorChanged: false,
    productionActivation: false,
  };

  writeFileSync(
    resolve(out, "SUCCESSOR_BASE_MANIFEST.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(
    resolve(out, "KERNEL_SURFACE_DISCOVERY.json"),
    JSON.stringify({
      schema: "IWXA_T2_K035_ATOMIC_GRAPH_KERNEL_SURFACE_DISCOVERY_V1",
      status: "DISCOVERY_ONLY_NO_CODE_CHANGE",
      predecessorKernelSha256: materialized.components.kernel.sha256,
      needles: [
        "putObject",
        "putRelation",
        "deleteRelation",
        "transaction",
        "indexedDB",
        "IDBTransaction",
        "granted_operations",
        "ALL_OPERATIONS",
        "LocalStore",
      ],
      matches: discovery,
      productionActivation: false,
    }, null, 2) + "\n",
    "utf8",
  );

  return Object.freeze({
    status: manifest.status,
    kernelPackageSha256: materialized.components.kernel.sha256,
    extractedFiles: inventory.length,
    discoveryMatches: discovery.length,
    outputRoot: out,
  });
}

function main() {
  const [authorityPath, repositoryRoot, outputRoot] = process.argv.slice(2);
  if (!authorityPath || !repositoryRoot || !outputRoot) {
    console.error(
      "usage: node scripts/materialize-k035-atomic-graph-successor.mjs <SOURCE_AUTHORITY.json> <repository-root> <new-output-root>",
    );
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(materializeK035AtomicGraphSuccessor({
      authorityPath,
      repositoryRoot,
      outputRoot,
    }), null, 2));
  } catch (error) {
    console.error(error?.stack || String(error));
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) main();
