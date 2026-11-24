# D06. Выбор истории конкретного товара для следующего владельца

24.11.2026. Первый функциональный этап PD.21 после продуктового аудита.

## Точные ревизии

- Site: Faust-S/komplektovod.ru @ fc9dfe2e0a7cb3d82bafd045fa6e6d6d26c528e7, TREE 8b260dfeb17cea0ff76399c6cd0d5d5b4145449e.
- Domain: Faust-S/komplektovod @ 28c72f86d5c686723f2a3bf0b25f4d934fbb2e0b, TREE 2a7f4700cc93c90a2d30f794359dae5f8e3e56fa.
- Working branches: work/2026-11-11-case-driven-entry-and-drill.
- T2 remains read-only: 9c64951cd78411283e8a416641c36d71e169fc1d.

## Implemented

The existing item history panel now selects eligible individual history records, distinguishes the exact item and record families, separates a configuration acceptance plan from an individual acceptance, permits selective disclosure and displays the actual outgoing text before download. The user can exclude individual records and opt in to serial number, financial figures, service providers and source IDs. Changing selection, visible content or recorded revisions invalidates the previous preview; the downloaded file is the reviewed text, not a newly generated unrestricted report.

The canonical membership rule is implemented in the subject repository and synchronized with the site. Tests exercise two separate physical items, multiple journals for the same item, plan-level issues, wrong record types and service identities, foreign and omitted records. The browser witness includes actual creation of items/journals, selective disclosure, preview invalidation and byte-level downloaded text comparison.

This is a readable history disclosure, NOT completion of the structured .iwxa transfer or legal ownership transfer.

## Qualification

- [45350883147](https://github.com/Faust-S/knowledge/actions/runs/45350883147): canonical domain selection test and exact blob match, complete source gate.
- [45350888671](https://github.com/Faust-S/knowledge/actions/runs/45350888671): all canonical rules, selective document tests, full build:static:check.
- [45350897260](https://github.com/Faust-S/knowledge/actions/runs/45350897260): targeted PD09 regressions and actual item history disclosure/download.

At the initial recording, the standalone canonical tests and canonical synchronization succeeded in the source gate. New complete checks remain in progress; do not assign PRODUCT_ACCEPTED or inherit previous full qualification.

## Next functional boundary

The actual Runtime Contract 1.3.0 ExportOptions and original T2 Exchange ExportView/export-machine select whole workspaces with history/assets/relations/schemas options, not arbitrary individual D06 Result IDs. The restricted D06 Host port can select a workspace, create a product solution, and commit/read Results, but cannot create a platform workspace. Consequently the next step must use a user-created, isolated target workspace via the original Host. Do not add new Kernel capabilities or bypass grant checks.

The transfer design must:
1. Re-read the reviewed exact item, its selected record revisions and disclosure choices; reject changed or foreign evidence.
2. Require an independently created empty target workspace, never the entire sender's source workspace.
3. Prepare only allowed item data and history evidence through existing typed D06 Results with explicit origin and preserved physical identity; do not copy unrelated solution records, raw drafts, identities, financial fields, documents or links without the corresponding decision.
4. Distinguish historical evidence supplied by the previous owner from the recipient's own new confirmed events. Never turn a PD21 exit plan or a copied acceptance plan into a factual completed handover.
5. Verify actual original Kernel readback, then original Exchange export/independent import. Verify the recipient sees exactly the intended instance and history and can continue it. Test two items, missing or changed evidence, interrupted copy, duplicate transfer and cold restart.

No new file format, parallel Store or T2 changes. Public knowledge receives only bounded test status and documentation; private source, builds and full logs stay runner-local.
