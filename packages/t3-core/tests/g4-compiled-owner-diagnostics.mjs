#!/usr/bin/env node
// PUBLIC diagnostic boundary for a temporary private T3 owner build log.
// Never print raw stderr, source, paths, identities, keys or arbitrary lines.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const BOOL = '(True|False)';
const PROBES = '(NATIVE_D3|RUNTIME|PROVISION|SERVER|CREDENTIAL|LICENSE_CLI)';
const ORIGINS = '(BUN_VIRTUAL|BUILD_SHIM|ORIGINAL_CLI|SIGNED_INTEROP|T2_ASSET)';
const machine = /^(?:T3_D3|INTEROP|WINDOWS|DPAPI|PRODUCT_OWNER)_[A-Z0-9_]{4,90}$/;
const rules = [
  {
    re: new RegExp('^T3_D3_COMPILED_ENROLL_PREFLIGHT_(NONZERO|ENOENT) ' + BOOL + '$'),
    format: m => 'G4_COMPILED_ENROLL_' + m[1] + ' ' + m[2],
  },
  {
    re: /^T3_D3_COMPILED_ENROLL_PREFLIGHT_LINE_COUNT ([0-9]{1,4})$/,
    format: m => 'G4_COMPILED_ENROLL_LINE_COUNT ' + m[1],
  },
  {
    re: /^T3_D3_COMPILED_ENROLL_PREFLIGHT_MACHINE_CODE ([A-Z0-9_]{5,100})$/,
    format: m => machine.test(m[1]) ? 'G4_COMPILED_ENROLL_MACHINE_CODE ' + m[1] : null,
  },
  {
    re: new RegExp('^T3_D3_COMPILED_ENROLL_PREFLIGHT_ORIGIN_' + ORIGINS + ' ' + BOOL + '$'),
    format: m => 'G4_COMPILED_ENROLL_ORIGIN_' + m[1] + ' ' + m[2],
  },
  {
    re: new RegExp('^T3_D3_COMPILED_IMPORT_PROBE_' + PROBES + '_(COMPILED|RAN) ' + BOOL + '$'),
    format: m => 'G4_COMPILED_IMPORT_PROBE_' + m[1] + '_' + m[2] + ' ' + m[3],
  },
];

export function classify(text) {
  const output = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    for (const rule of rules) {
      const match = rule.re.exec(line);
      if (!match) continue;
      const safe = rule.format(match);
      if (safe) output.add(safe);
      break;
    }
  }
  return [...output].sort();
}

if (process.argv[2] === '--selftest') {
  const valid = [
    'T3_D3_COMPILED_IMPORT_PROBE_NATIVE_D3_COMPILED True',
    'T3_D3_COMPILED_IMPORT_PROBE_NATIVE_D3_RAN False',
    'T3_D3_COMPILED_ENROLL_PREFLIGHT_NONZERO True',
    'T3_D3_COMPILED_ENROLL_PREFLIGHT_LINE_COUNT 16',
    'T3_D3_COMPILED_ENROLL_PREFLIGHT_MACHINE_CODE T3_D3_ORIGINAL_NATIVE_COMMAND_FAILED',
  ];
  const hostile = [
    'T3_D3_COMPILED_IMPORT_PROBE_NATIVE_D3_RAN True C:\\private\\key',
    'T3_D3_COMPILED_IMPORT_PROBE_NATIVE_D3_RAN Maybe',
    'T3_D3_COMPILED_IMPORT_PROBE_UNKNOWN_RAN True',
    'T3_D3_COMPILED_ENROLL_PREFLIGHT_MACHINE_CODE C:\\Users\\someone',
    'T3_D3_COMPILED_ENROLL_PREFLIGHT_MACHINE_CODE T3_D3_BAD private-content',
    'raw stderr: password=<redacted>',
  ];
  const out = classify([...valid, ...hostile].join('\n'));
  assert.equal(out.length, valid.length);
  assert(out.some(x => x === 'G4_COMPILED_IMPORT_PROBE_NATIVE_D3_RAN False'));
  assert(out.every(x => !x.includes('private') && !x.includes('Users') && !x.includes('password')));
  console.log('G4_COMPILED_OWNER_PUBLIC_CLASSIFIER_SELFTEST_PASS');
} else {
  if (process.argv.length !== 3) {
    console.log('G4_COMPILED_OWNER_PUBLIC_CLASSIFIER_ARGUMENTS_INVALID');
    process.exitCode = 2;
  } else {
    try {
      const log = readFileSync(process.argv[2], 'utf8');
      for (const line of classify(log)) console.log(line);
    } catch {
      console.log('G4_COMPILED_OWNER_PUBLIC_CLASSIFIER_LOG_UNAVAILABLE');
    }
  }
}
