import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ps1=readFileSync(new URL('../scripts/prepare-factory2-exact-windows-toolchain.ps1',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../../product/FACTORY2_ENVIRONMENT_TOOLCHAIN_MANIFEST_2026-09-24.json',import.meta.url),'utf8'));

test('Factory 2 Windows toolchain bootstrap pins exact Node/npm identities and official Node archive digest',()=>{
  assert.match(ps1,/\$NodeVersion = 'v24\.18\.1'/);
  assert.match(ps1,/\$NpmVersion = '11\.16\.0'/);
  assert.match(ps1,/ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765/);
  assert.match(ps1,/sha512-A74XL8OxmcegZDMWPkWb5bEQppg8HdYwW3rBD2sPoS4UQHVajfaxBkqyzLeJ3wR0kZ\+5xoTjItxXaF7eIXUsyw==/);
  assert.equal(manifest.portableWindowsToolchain.nodeVersion,'v24.18.1');
  assert.equal(manifest.portableWindowsToolchain.npmVersion,'11.16.0');
  assert.equal(manifest.portableWindowsToolchain.systemToolchainModified,false);
});

test('Factory 2 Windows toolchain bootstrap remains isolated from the worktree and system toolchain',()=>{
  assert.match(ps1,/FACTORY2_EXACT_TOOLCHAIN_INSIDE_WORKTREE_FORBIDDEN/);
  assert.match(ps1,/--prefix \$NodeHome/);
  assert.match(ps1,/systemToolchainModified = \$false/);
  assert.doesNotMatch(ps1,/\bwinget\b/i);
  assert.doesNotMatch(ps1,/\bchoco\b/i);
  assert.doesNotMatch(ps1,/\bnvm\b/i);
});
