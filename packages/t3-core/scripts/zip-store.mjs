import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) { const b=Buffer.alloc(2); b.writeUInt16LE(n & 0xffff,0); return b; }
function u32(n) { const b=Buffer.alloc(4); b.writeUInt32LE(n >>> 0,0); return b; }
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = 0x21; // 1980-01-01
const UTF8 = 0x0800;

export function collectDirectoryEntries(rootDir, prefix = "") {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) {
        const rel = relative(rootDir, abs).split("\\").join("/");
        out.push({ name: `${prefix}${rel}`, bytes: readFileSync(abs) });
      } else throw new Error(`ZIP_UNSUPPORTED_ENTRY_TYPE: ${abs}`);
    }
  };
  walk(rootDir);
  return out;
}

export function createStoredZip(entries) {
  const sorted = [...entries].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.name.replace(/\\/g,"/"), "utf8");
    const data = Buffer.from(entry.bytes);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(UTF8), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    localParts.push(local);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(UTF8), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(sorted.length), u16(sorted.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}

export function writeStoredZip(zipPath, entries) {
  writeFileSync(zipPath, createStoredZip(entries));
}

export function readStoredZip(input) {
  const buf = Buffer.isBuffer(input) ? input : readFileSync(input);
  const out = new Map();
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const sig = buf.readUInt32LE(pos);
    if (sig === 0x04034b50) {
      const method = buf.readUInt16LE(pos + 8);
      const compressed = buf.readUInt32LE(pos + 18);
      const uncompressed = buf.readUInt32LE(pos + 22);
      const nameLen = buf.readUInt16LE(pos + 26);
      const extraLen = buf.readUInt16LE(pos + 28);
      if (method !== 0 || compressed !== uncompressed) throw new Error("ZIP_UNSUPPORTED_COMPRESSION");
      const nameStart = pos + 30;
      const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
      const dataStart = nameStart + nameLen + extraLen;
      out.set(name, Buffer.from(buf.subarray(dataStart, dataStart + uncompressed)));
      pos = dataStart + compressed;
      continue;
    }
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    throw new Error(`ZIP_INVALID_SIGNATURE_AT_${pos}`);
  }
  return out;
}
