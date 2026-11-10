#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');
const problems=[]; let checks=0;
const req=(cond,msg)=>{checks++; if(!cond) problems.push(msg)};
const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const current=JSON.parse(read('overlay/_iwxa/current.json'));
const bridge=JSON.parse(read('overlay/_iwxa/migration-adapter/current.json'));
const types=read('src/local-store/types.ts');
const secTypes=read('src/capability/security-types.ts');
const mig=read('src/local-store/internal/migrations.ts');
const localStore=read('src/local-store/LocalStore.ts');
const trust=read('src/capability/security-trust.ts');
const auth=read('src/capability/authorization04.ts');
const authLegacy=read('src/capability/authorization.ts');
const router=read('src/capability/router.ts');
const reader=read('src/package/import/read.ts');
const importCommit=read('src/package/import/commit.ts');
const generated=read('src/generated/security04-root.ts');
const unguardedTest=read('tests/capability-authorization04-unguarded.test.ts');
const trustTest=read('tests/security-trust04.test.ts');
const installTest=read('tests/capability-install-concurrency.test.ts');
const routerTest=read('tests/capability-router04.test.ts');
const importCapabilityTest=read('tests/capability-import-authorization.test.ts');
const authority=read('src/capability/authority.ts');
const buildContracts=read('scripts/build-contracts.mjs');
const preRelease=read('scripts/run-pre-release-verification.mjs');
const buildStatic=read('scripts/build-static-check.mjs');
const runtimeDoc=read('RUNTIME_CONTRACT_1.2.0_RU.md');
const method=(name,next='\n  async ')=>{
  const start=auth.indexOf(`async ${name}`);
  if(start<0) return '';
  const n=auth.indexOf(next,start+10);
  return auth.slice(start,n<0?auth.length:n);
};
req(pkg.version==='0.3.5','package version must be 0.3.5');
req(lock.version==='0.3.5'&&lock.packages?.['']?.version==='0.3.5','package-lock root version must be 0.3.5');
req(current.runtime_version==='0.3.5'&&current.runtime_url==='/_iwxa/runtime/0.3.5/runtime.js'&&current.status==='active','active runtime pointer must bind 0.3.5');
req(bridge.runtime_version==='0.3.5'&&bridge.runtime_url==='/_iwxa/runtime/0.3.5/runtime.js','migration adapter must bind 0.3.5');
req(/DB_VERSION\s*=\s*6/.test(types),'LocalStore DB_VERSION must remain 6 add-only');
for(const s of ['security_state','security_targets','authorization_decisions']) req(types.includes(s)&&mig.includes(s),`missing v6 store ${s}`);
req(localStore.includes('expected: { state: SecurityAtomicCommitRecord["state"]; transaction_id: string } | null'),'security snapshot commit lacks exact compare-and-commit predecessor expectation');
req(localStore.includes('return "CONFLICT" as const'),'security snapshot commit lacks stale-writer conflict outcome');
req(localStore.includes('markSecurityRecoveryRequired'),'recovery marking is not conditional on the current security transaction');
req(trust.includes('commit === "CONFLICT"')&&trust.includes('ConcurrentSecurityStateError'),'trust refresh does not retry/deny concurrent stale commits');
req(trust.includes('maxAttempts = 4')&&trust.includes('refreshOnce()'),'concurrent refresh retry loop is missing/bounded retry is not explicit');
req(trust.includes('return await this.recoveryRequired("monotonic anchor advance/confirmation failed after local compare-and-commit", next'),'anchor failure does not conditionally transition the exact committed state to recovery');
for(const marker of ['DENY_ROLLBACK','DENY_EQUIVOCATION','DENY_ROOT_SKIP','RECOVERY_REQUIRED','freshness_bytes','snapshot_bytes','trusted_time_request_bytes']) req(trust.includes(marker),`security trust marker missing: ${marker}`);
req(trust.includes('DENY_POLICY_EQUIVOCATION'),'policy equivocation has no terminal fail-closed classification');
req(secTypes.includes('policy_identity_digests?: Record<string, string>'),'security atomic state does not persist immutable policy identities');
req(trust.includes('extendPolicyIdentityFloor(inheritedPolicyIdentities, parsed.policies)'),'candidate policies are not checked against inherited identity floor');
req(trust.includes('inheritedPolicyIdentityFloor(local)'),'pre-policy-floor state -> K032 migration path missing');
req(trust.includes('persisted issuance policy identity floor does not match current accepted policy bytes'),'persisted policy floor is not reverified');
req(trust.includes('record.semantic_version !== "1.0.0"'),'unsupported security target semantic versions are not fail-closed');
req(secTypes.includes('readonly trusted_time_floor: string | null'),'resolver does not expose persisted trusted-time lower floor');
req(auth.includes('trusted_time_floor: resolver.trusted_time_floor'),'ADR does not bind exact persisted trusted-time lower floor');
req(auth.includes('private async evaluateCarrierWithResolver'),'single-resolver carrier evaluation helper missing');
req(!method('authorizeOperation').includes('this.serviceDeclaration()'),'authorizeOperation must not refresh metadata through serviceDeclaration');
req((method('authorizeOperation').match(/this\.trust\.refresh\(\)/g)||[]).length===1,'authorizeOperation must perform exactly one trust refresh');
req(method('authorizeOperation').includes('if (guards === null) return unguarded()'),'unguarded operation must return an unguarded ACTIVE decision before binding lookup');
req(!method('authorizeOperation').includes('this.authorizationForWorkspace('),'authorizeOperation must not perform a second independent workspace refresh');
req((method('authorizeActivation').match(/this\.trust\.refresh\(\)/g)||[]).length===1,'authorizeActivation must perform exactly one trust refresh');
req(method('authorizeActivation').includes('authorizationForWorkspaceWithResolver(workspaceId, resolver)'),'activation does not reuse pinned resolver');
req((method('prepareInstallCarrier').match(/this\.trust\.refresh\(\)/g)||[]).length===1,'multi-workspace install must pin one resolver');
req(method('prepareInstallCarrier').includes('evaluateCarrierWithResolver'),'multi-workspace install does not reuse pinned resolver');
req((method('portableCarrierForWorkspaces').match(/this\.trust\.refresh\(\)/g)||[]).length===1,'multi-workspace export must pin one resolver');
req(method('portableCarrierForWorkspaces').includes('evaluateCarrierWithResolver'),'multi-workspace export does not reuse pinned resolver');
req(unguardedTest.includes('expect(refreshCalls).toBe(1)'),'TOCTOU regression tests do not assert one resolver refresh');
req(unguardedTest.includes('decision: "ACTIVE"')&&unguardedTest.includes('grant_id: null'),'unguarded regression does not assert no-binding ACTIVE semantics');
req(trustTest.includes('DENY_POLICY_EQUIVOCATION'),'policy equivocation regression test missing');
req(trustTest.includes('semantic_version = "9.9.9"'),'semantic-version negative regression test missing');
req(trustTest.includes('rejects a stale compare-and-commit'),'concurrent stale-writer regression test missing');
req(trustTest.includes('conditional recovery marking cannot overwrite a newer concurrent commit'),'conditional recovery race regression test missing');
req(trustTest.includes('never returns ACTIVE when the exact local transaction becomes recovery-required while anchor advance is in flight'),'external-anchor/local-state race regression test missing');
req(trustTest.includes('maps external monotonic anchor read failures to explicit fail-closed metadata unavailability'),'external-anchor transport classification regression test missing');
req(router.includes('LEGACY_DOWNGRADE_FORBIDDEN'),'0.4 -> 0.3.1 capability downgrade guard missing');
req(router.includes('SECURITY04_ROOT_NOT_BOUND'),'release-bound trust-root fail-closed guard missing');
req(reader.includes('rawGrant?.schema_version === "0.4.0"')&&reader.includes('rawGrant?.schema_version === "0.3.1"'),'package reader must dispatch exactly capability schema 0.3.1/0.4.0');
req(generated.includes('EMBEDDED_SECURITY04_ROOT_BYTES')&&generated.includes('null'),'source candidate must not invent an operational trust root');
req(trust.includes('external monotonic anchor did not confirm the just-committed security floor'),'post-commit anchor read-back confirmation missing');
req(trust.includes('security transaction is no longer ACTIVE after monotonic anchor confirmation'),'post-anchor local ACTIVE transaction fence missing');
req(trust.includes('anchorMayBeTemporarilyBehind')&&trust.includes('for (let attempt = 0; attempt < 3; attempt++)'),'bounded local-ahead/anchor-behind settling logic missing');
req(trust.includes('external monotonic anchor is unavailable')&&trust.includes('DENY_METADATA_UNAVAILABLE'),'anchor read failures are not fail-closed classified');
req(trust.includes('if (!marked) throw new ConcurrentSecurityStateError()'),'stale recovery classification must retry when a newer transaction won');


req(localStore.includes('installCapabilityRecordsChecked'),'shared capability compare-and-install transaction missing');
for(const marker of ['CONFLICT_BINDING','CONFLICT_INSTANCE','CONFLICT_GRANT']) req(localStore.includes(marker),`capability install conflict outcome missing: ${marker}`);
req(localStore.includes('expected_bindings')&&localStore.includes('bindingSnapshotEqual'),'capability binding expected-state compare missing from IndexedDB transaction');
req(localStore.includes('instanceIdentityEqual')&&localStore.includes('grantIdentityEqual'),'immutable capability instance/grant collision checks missing');
req(auth.includes('expected_bindings')&&auth.includes('maxAttempts = 4')&&auth.includes('installCapabilityRecords04(prepared)')&&auth.includes('Concurrent Capability 0.4 binding updates prevented a stable install'),'Capability 0.4 manager does not bounded re-prepare on binding conflict');
req(authLegacy.includes('expected_bindings')&&authLegacy.includes('maxAttempts = 4')&&authLegacy.includes('installCapabilityRecords(prepared)')&&authLegacy.includes('Concurrent capability binding updates prevented a stable install'),'legacy Capability 0.3.1 manager does not bounded re-prepare on binding conflict');
req(installTest.includes('CONFLICT_BINDING')&&installTest.includes('CONFLICT_INSTANCE')&&installTest.includes('CONFLICT_GRANT'),'capability install concurrency regression tests missing');
req(installTest.includes('installCapabilityRecords04'),'Capability 0.4 install concurrency regression missing');
req(authority.includes('expected_bindings')&&authority.includes('Package commit must'),'shared prepared capability boundary drops expected binding snapshots');
req(localStore.includes('installCapabilityRecordsCheckedInTransaction')&&localStore.includes('installPreparedCapabilityRecordsInTransaction'),'transaction-aware capability compare-and-install helper missing');
req(importCommit.includes('installPreparedCapabilityRecordsInTransaction')&&importCommit.includes('atomic_semantic_rollback'),'secure package commit does not use the same capability CAS inside semantic transaction');
req(!/objectStore\(STORES\.capability_(?:instances|grants|bindings)\)\.put/.test(importCommit),'secure package commit still directly writes capability stores');
req(importCapabilityTest.includes('atomically aborts semantic import when capability binding changes after prepare')&&importCapabilityTest.includes('CONFLICT_BINDING')&&importCapabilityTest.includes('atomic_semantic_rollback'),'package import capability TOCTOU regression test missing');
req(auth.includes('RENEWAL_SIGNED_SUCCESSOR_PREDECESSOR_NOT_LOCAL')&&auth.includes('REPLACEMENT_REQUIRES_PREDECESSOR_EVIDENCE'),'portable continuous renewal / strict replacement predecessor split missing');
req(auth.includes('preferredActiveGrantId04')&&auth.includes('GRANT_SEQUENCE_EQUIVOCATION')&&auth.includes('GRANT_SERIES_FORK'),'0.4 grant-series/sequence downgrade fence missing');
req(auth.includes('highest.envelope.signed_claims.grant_sequence > incoming.envelope.signed_claims.grant_sequence'),'older signed renewal can still downgrade active binding pointer');
req(router.includes('authorityProfilesForWorkspace')&&router.includes('independently evaluable')&&router.includes('guardedAny'),'router does not evaluate independent 0.4 grants across assurance profiles / guard convergence');
req(routerTest.includes('evaluates independently valid continuous grants across different 0.4 assurance profiles'),'cross-profile continuous-grant router regression missing');
req(routerTest.includes('does not let an older unguarded profile bypass a guard observed by another valid 0.4 profile'),'cross-profile guard anti-bypass regression missing');



req(buildContracts.includes('const RUNTIME_COMPAT = ">=0.2.0 <0.4.0"'),'Runtime Contract build metadata must include current 0.3.5 runtime compatibility');
req(preRelease.includes('run-security04-combinatorial-model.mjs'),'pre-release verification must execute the combinatorial security model');
req(buildStatic.includes('run-security04-combinatorial-model.mjs'),'static verification must execute the combinatorial security model');
req(buildStatic.includes('kernel-035-contract')&&!buildStatic.includes('kernel-033-contract'),'active static gate label must identify K035 contract');
req(runtimeDoc.includes('Physical LocalStore DB version = 6'),'active Runtime Contract documentation must describe DB 6');
for(const store of ['security_state','security_targets','authorization_decisions']) req(runtimeDoc.includes(store),`active Runtime Contract documentation missing DB6 store ${store}`);


const grantValidationTest=read('tests/capability-grant04-validation.test.ts');
const corePositive=read('core-e2e/core-e2e-positive.test.ts');
const coreNegative=read('core-e2e/core-e2e-negative.test.ts');
for(const [name,text] of [['capability-router04',routerTest],['capability-grant04-validation',grantValidationTest],['security-trust04',trustTest]]) {
  req(!/(?:\bas\s+any\b|:\s*any\b)/.test(text),`${name} retains explicit-any lint bypass`);
}
req(!corePositive.includes('eslint-disable-next-line no-console')&&!coreNegative.includes('eslint-disable-next-line no-console'),'core-e2e retains stale no-console eslint-disable directives');
req(preRelease.includes('check-kernel-035-contract.mjs'),'pre-release active contract gate must identify K035');

req(pkg.overrides?.['fast-uri']==='4.1.5','K035 fast-uri override missing');
req(preRelease.includes('check-dependency-security.mjs'),'pre-release dependency-security gate missing');
req(buildStatic.includes('dependency-security'),'static dependency-security gate missing');

const out={result:problems.length?'FAIL':'PASS',contract:'K035_DEPENDENCY_SECURITY_BOUNDARY',checks,problems};
console.log(JSON.stringify(out,null,2)); process.exit(problems.length?1:0);
