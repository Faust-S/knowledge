# Exact installed candidate qualification, K036 canonical Event merge

The accepted K036 artifact registry and normal product profiles remain unchanged.
Candidate ID: iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1.
Candidate ZIP digest: 5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a.
Source qualification: https://github.com/Faust-S/knowledge/actions/runs/45596499435.
Archive staging qualification: https://github.com/Faust-S/knowledge/actions/runs/45611967597.

The original native Admin and Agent materializers and One Dist assembler accept an
explicit trailing CLI pair `--qualification-kernel-candidate <exact-id>` only in
the allowlisted disposable public qualification runners. No inferred selection,
no accepted-release registry entry, no fixture bypass, no new Kernel or Store.
The input and output are verified against the fixed four-file inventory. The
ordinary original product profiles continue to declare the accepted baseline.
Candidate receipts set the legacy qualified artifact field to null, carry the
candidate identity and ZIP digest separately, and mark release acceptance false.

The source roundtrip test uses the candidate as the input to the actual product
materializers and the actual Agent receipt builder; it no longer overwrites
runtime.js after assembling a previously accepted artifact. Candidate tests
require a genuinely compiled T3 UI, while execution still uses the Node
IndexedDB platform fixture. No native Windows or commercial release claim.

Private T3/Agent installer admission and same-runner Windows installed GUI
qualification remain required before the candidate can replace the accepted
baseline. Do not publish any private candidate ZIP, logs or installers from CI.
