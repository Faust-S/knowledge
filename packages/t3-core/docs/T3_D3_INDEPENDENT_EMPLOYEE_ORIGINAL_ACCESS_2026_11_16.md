# T3 D3: independent employee original Access enrollment

Date: 2026-11-16. Executable code owner: **Faust-S/knowledge/packages/t3-core**.
Implemented in `src/t3/access/original-employee-enrollment.mjs`. The original
signed Access algorithm, encrypted vault adapter and T2 Kernel registry remain
the ONLY owners; no Admin Center, Agent or private T3 repository source is copied.

## Actual operation

The installed trusted T3 Host supplies the existing branded
`createOriginalKernelRegistryStatePort`, its original issuer signer, the
signed manager proof callback and a pinned organization + Workspace.
Browser-selected descriptors are never trusted as an issuer or data root.

`begin(input)` first proves that the employee's **independently held**
Ed25519 proof credential is already pinned in the organization's original
trusted Access policy. It also checks distinct employee/manager identities,
a scope-limited issuer, authority ceiling, role and key validity. Returns a
short-lived challenge and original proof request, **not** an invitation.

The employee signs that challenge with its own original local credential via
`makeProof`. The issuer's trusted Host calls
`complete({enrollmentId,employeeProof})`, which checks:
- the exact credential key, signed proof, challenge and request digest;
- the original signed manager `grant.issue` action using `evaluate()`;
- the same pinned organization/Workspace and the authority scope ceiling;
- absence of an existing enrollment for that employee;
- separate original `work.prepare` ACTION and `package.export` DATA grants.

It signs the two original Access grants and a new STATUS with the original
issuer signer, commits **once** through
`createOriginalKernelRegistryStatePort.commitSignedState()` into the original
Kernel Object/Event history, reads back both signed grants and STATUS, and only
then returns original `StaffMembership`, `AdminIssuedCredential`,
`OrganizationGrant` descriptors and
`signOrganizationEnrollment()` signed claims. No employee private key is
generated, copied or delivered by the employer. No personal Agent Task or memory
is handed over. The operation returns
`SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED`, never delivered/accepted/applied.

For lost acknowledgements,
`readEnrollment({organizationId,employeePersonId,enrollmentId})` uses the
original Kernel-backed signed registry. It verifies signed grant IDs,
current authority STATUS, expiry and recorded tombstones, returning ACTIVE,
REVOKED_OR_EXPIRED or UNKNOWN_STATUS_HOLD. It **never** repeats issuance. A
confirmed prior enrollment is never reissued under a new ID.

More than one independent employee can be enrolled successively using the same
original authority, each with a separate credential and grants. Distinct
organizations remain separately scoped.

## Original key admission implemented

The original Kernel-backed registry now offers a bounded
`admitProofCredential({authorityId,organizationId,employeeWorkspaceId,
credentialKeyId,keyRecord,issuerSigner,managerRequest,managerChallenge,
managerProof,employeeRequest,employeeChallenge,employeeProof})`.
It accepts a **previously unknown, proof-only Ed25519 key**, but only if:

- The manager's original signed grant permits `grant.issue`, verified via
  the existing T3 `evaluate()` and fresh challenge.
- The independent employee signs the exact operation digest with the new
  key, verified by the existing original `verifyRecord(PROOF)`.
- Key use is exactly `PROOF`, never `GRANT`, `STATUS` or an issuer key;
  the employee is not the manager and does not already hold ADMINISTRATION.
- Scope belongs to the originally pinned organization and employee Workspace;
  the key cannot silently alter audiences, grant ceilings or data roots.
- Original issuer signs a new `STATUS` carrying the digest of the proof-only
  policy addition and both evidence digests.
- Only the already inherited T2 Kernel persists the next signed Access
  Object/Event. A cold registry reconstructs every policy addition from the
  **initial pinned trust root** and verifies each original issuer signature.
  An unsigned policy/key insertion is rejected.
- `readProofCredential()` allows authoritative recovery after a lost ACK,
  without repeating the admission.

This is the original Access owner, not a second IAM, Vault, Kernel, Journal,
Exchange, enrollment issuer or alternate package format. The same employee
may then call `begin()`/`complete()` to receive separate signed work and
export grants. Original Organization Operation JIT now recognizes
`IWXA_PERSONAL_AGENT` as a consumer and does not grant it ADMINISTRATION.

After grant issuance the exact signed `OrganizationEnrollment` can be
reconstructed from the original Kernel after a cold restart, including the
same original employee key binding and unchanged signed claims. Signed
recovery never mints replacement grants or signs a second Task/Result.

## Concrete remaining production boundaries

1. The installed **original T3 Host** must mount these existing bounded
   operations, run the employee's independent local encrypted original Vault
   proof under that Windows user's profile, and deliver authenticated signed
   invitation and STATUS evidence. The Node qualification is not a second
   user account or installed native credential ceremony.
2. The original installed Host must mount this trusted Node-only operation and
   route the employee-held proof from a genuinely separate OS user, then bind
   its existing Exchange to the original invitation carrier. This library
   itself is not a UI, server, invitation serializer or credential installer.
3. Original Admin Center D3 must target a **specific employee** for signed Task
   issuance and proof of manager assignment. Historical `grant:task` is
   addressed to the first manager/worker. A changed recipient requires the
   original issuer's separate authorization, not rewriting package metadata.
4. Original employee signed Result `interop.result.v2` and original
   Reconciliation must receive the exact Task revision, then independent Human
   ACCEPT/APPLY and two cold Kernel readbacks must be qualified.
5. Windows installed Employee/Manager, real model execution, original Exchange
   and full native D3 remain NOT_RUN. No production acceptance is asserted.

## Executable regression

`node --test packages/t3-core/tests/t3-d3-independent-employee-original-enrollment.test.mjs`

The test uses separately generated original Ed25519 issuer, manager and employee
keys. All scopes, authorizations, signed STATUS, Kernel Object/Event and
receipt readbacks run in public test process; no real employee credentials or
private T3 repository source are involved.

Source stage passing does not count as an installed production employee.
`T3_READY=false`, `D3_END_TO_END=NOT_ACCEPTED`.
