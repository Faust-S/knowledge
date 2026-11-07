# C12–C17: source-bound handoff to K03 and K05

Scope: existing Activity Research. No Task Discovery Engine, evaluation engine, review platform, new event processor or storage.

## Source authority
Pinned Solve4X ZIP central SHA-256: `bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5`.

| Source member | SHA-256 |
| --- | --- |
| scene01/scene01_video_ocel.json | 619f52a0fb845926790388008b505fff5969adcd25cac31f0bb0e62d01980e99 |
| scene01/scene01_sensors_ocel.json | 4f16d799a7ff96b99e25192331fa6ef4edf3dcac876e9f8adc4e570514318918 |
| scene01/scene01_ui.csv | 653e0b52ec64c9f1629eb758091cdad5e5c3cb47d68531b2174ec0c6a6c0a1bb |
| scene01/scene01_reed_switches.csv | 5e469a4bd4f14f831bbdce1048fe4ec963a8c263c05b90c77a167cf0dc5bf5e0 |
| scene01/scene01_ocel.json (C11 lineage, not repeated in handoff) | 5de185ada7d0e8d82e3f43929e594c31a1c52aad334197557cc7c2550d3f1f15 |

## Actual existing APIs

- `solve4x_cross_source_coverage.analyze(video,sensors,ui_csv)` and `probe()`: coverage, one-to-one time-only upper bounds, +90-second and +1-day negative controls, original member hashes. `probe()` now includes `c12_c16_source_bound_handoff`.
- `solve4x_c13_episode_triage.analyze(video,sensors,ui_csv)`: `review_ordinal`, `sensor_signal_class`, `ui_event_classes`, `ui_target_classes`, candidate counts, and explicit `same_human_action=UNKNOWN`; ordinal is NOT the original event ID.
- `solve4x_c14_raw_reed_review.analyze(video,sensors,ui,reed)`: raw recorder count, state/class-compatible temporal candidates, `review_episodes`, C15/C16/C17 subresults. `_outside_video_events` and `parse_raw_reed` are reused; no new event detector.
- `solve4x_c14_raw_reed_review.video_boundary_evidence(video,outside_sensor_events)`: literal author `Enter room`/`Leave room` boundaries, 1/5/15s selection and clock offsets, not observed physical actor truth.
- `solve4x_c16_review_footprint.analyze(video,outside_sensor_events)`: the three baseline counts and footage unions; `actual_human_review_seconds=None`.
- `solve4x_c17_blind_review.prepare(video,outside_sensor_events)`, `public_plan(packet)`, `blank_receipt(packet,role)`, `score(packet,receipts)`: owner-local index with original video event keys; public plan 23/6/3; human scoring only if genuine owner-local receipts exist. Label Studio remains the review infrastructure.

The minimal read-only adapter `solve4x_source_bound_handoff.prepare_owner_local(video_bytes,sensor_bytes,ui_bytes,reed_bytes)` checks the **original byte-level SHA** and yields an **owner-local only** structured packet. Per episode it provides the original sensor `OCEL_EVENT_KEY`, candidate raw reed and browser UI original CSV member record numbers and physical line coordinates, original author video `OCEL_EVENT_KEY` for selected boundaries, source member SHA-256 and modality. It marks record observation as `observed`, author label as `reported`, inferred temporal association as `TIME_CLASS_NEIGHBOR_NOT_CONFIRMED_ACTION`. All physical/human identities, intentions, true cross-source alignment and Task acceptance stay unknown. This packet includes private source keys and **must never be published**. Caller owns access checks; `permissions_attested=False` is deliberate.

`public_summary(packet)` emits **only** source hash pins, closed-class categories, counts and explicit owner-local locator requirement; no original event keys, timestamps, actors, URLs or raw source rows. Example safe output excerpt (synthetic illustration, actual counts come from pinned source replay):

```json
{
  "schema": "IWXA_SOLVE4X_C12_C16_SOURCE_BOUND_HANDOFF/0.1",
  "status": "PUBLIC_ONLY_OWNER_LOCAL_SOURCE_LOCATOR_REQUIRED",
  "episode_count": 3,
  "video_baseline_counts": {"all": 23, "literal_enter_leave": 6, "reed_closed_after_end_5s": 3},
  "episodes": [{"review_ordinal_not_original_id": 1, "type": "SENSOR_DERIVED_OCEL_EVENT", "original_source_locator": "OWNER_LOCAL_REQUIRED", "same_human_action": "UNKNOWN"}],
  "human_gold": "NOT_MEASURED",
  "accepted_tasks": 0
}
```

One private per-episode locator example, **placeholder only**:

```json
{"sensor_observation":{"type":"SENSOR_DERIVED_OCEL_EVENT","source_member":"scene01/scene01_sensors_ocel.json","source_sha256":"4f16d799a7ff96b99e25192331fa6ef4edf3dcac876e9f8adc4e570514318918","locator":{"kind":"OCEL_EVENT_KEY","source_event_key":"<owner-local original key>"}},"temporal_uncertainty":"CROSS_DEVICE_CLOCK_CALIBRATION_UNKNOWN","same_human_action":"UNKNOWN"}
```

## K03 consumer boundary

K03 is the **only** owner of activity observation/evidence/clarification qualification. Consume the owner-local packet only after checking access rights and actual original source locators. Source observation means *record present*, not that a human action occurred. Keep temporal and annotation relationships separate from raw observations. If original bytes, permissions, locator or the source revision are missing, emit `UNKNOWN/HOLD` and request authorized evidence; do not create a Task, identity, source key or source permission. No K03 code is imported or copied.

## K05 consumer boundary

Three C16 baselines: **23 / 6 / 3** video annotations. Union of footage with ±2 seconds context: **361.376 / 51.669 / 24.688 seconds** (source-annotation time, NOT reviewer time). C12-C15 provide denominators, coverage, ambiguous candidates, impossible clock offsets, omissions relative to candidate sets, and state compatibility. C17 provides `public_plan` with `independent_video_reviews=0`, `active_review_seconds=None`, `human_activity_gold=NOT_MEASURED`. Only after genuine independent owner-local review via existing Label Studio, C17 `score` can report `adjudicated_visible_in_selection`, `adjudicated_visible_omitted`, `confident_contradictions_vs_adjudicator`, `unknown_agreement_with_adjudicator`, `reported_active_seconds` and `label_studio_lead_time_seconds`. Distinguish active self-reported time from lead time, retrieval of clips from Task accuracy, and author annotations from independent gold. Avoid causal savings claims.

Negative tests: original bytes absent/mismatched SHA, missing OCEL source key, timezone-aware uncalibrated timestamp, conflicting raw reed state, unsupported promotion to confirmed action, no private content in public projection. Existing C15/C16/C17 tests remain unchanged.

## Verification

```sh
python3 -m unittest discover -s research/activity-research/tests -p 'test_solve4x_source_bound_handoff.py' -v
python3 -m unittest discover -s research/activity-research/tests -p 'test_solve4x_c1*.py' -v
python3 research/activity-research/solve4x_cross_source_coverage.py --out /tmp/solve4x-c12-public.json
```

Existing `.github/workflows/activity-solve4x-source-preflight.yml` runs pinned Solve4X and all existing C13-C17 checks, plus the new adapter tests; raw original sources and owner-local packet must never be uploaded. No source access => HOLD, no synthetic fallback. Status remains `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.

## Follow-up 06.11.2026: negative round-trip qualification

Source locator replay now uses `verify_owner_local_locator(member_bytes, ref)`: exact SHA-256, OCEL source key or CSV original record number/physical lines. This returns only source-record existence, not actual human action or permission. `public_summary(packet)` alone is explicitly `PUBLIC_UNVERIFIED_AGGREGATE` and `original_bytes_sha_verified=false`; passing original `source_files` triggers complete private-packet replay before returning `PUBLIC_SOURCE_RECORDS_REPLAY_VERIFIED`. Pinned Solve4X `probe()` verifies all candidate locators independently. Tests reject duplicate JSON source keys, stale OCEL/CSV locators, wrong member bytes, forged private packet classes/ordinals and metadata leakage.

Compatibility boundary: Current K03 host_discovery accepts authorized UTF-8 text/manifest + U1 owner, not raw OCEL/CSV event members; current K05 source projection verifies GitHub issue byte offsets, not Solve4X semantics. Neither module is modified. C17 remains a research review adapter, not Label Studio replacement. `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.

## Продолжение 06.11.2026 — сверка исходного review scope и целостность C17

`reconcile_with_existing_reports(owner_packet, c13_report, c14_report)` проверяет **совпадение исходных записей и рассчитанных агрегатов** C13/C14 по каждому эпизоду: порядок (не original ID), sensor/state class, число raw reed кандидатов, число кандидатов с совпадающим state, UI count, UI event/target classes. Уникальные исходные CSV record locators дедуплицируются только owner-local, наружу уходят счётчики. Сверяются C13/C14 totals и C16 5s-selected video annotations; расхождение -> `HANDOFF_C13_C14_EPISODE_DRIFT` или `HANDOFF_REVIEW_SCOPE_DRIFT`, не Task.

Pinned Scene 01 ожидает `review_scope={sensor_derived_episode_source_rows:3, distinct_raw_reed_source_rows:6, distinct_browser_ui_source_rows:5, distinct_author_video_annotation_rows:3, source_rows_without_video:14, source_rows_including_video:17}`. Это **количество различных исходных записей для разбирательства**, НЕ количество независимых человеческих действий. K05 может использовать его только как read-only retrieval/effort denominator и подтвердить своим владельческим source-evaluation контрактом; K03 не принимает эти записи как Task.

C17 `_verified_packet` теперь отвергает подмену `blind_tasks` по сравнению с зафиксированными `arms`: удаление, reorder, новые IDs или предварительная подстановка media locator приводят к `C17_BLIND_TASKS_DRIFT`. В `public_plan` явное `source_bytes_verified_by_c17=False`: C17 не проверяет оригинальные байты самостоятельно; это делает pinned C12 до вызова C14/C17. Оператор продолжает связывать медиа и настоящие verdicts **вне этого frozen packet** через действующий owner-local Label Studio. Ключи, время и события источника в public aggregate не попадают.

Инварианты: `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`, `CLOCK_CALIBRATION=UNKNOWN`. Нет нового workflow, оценщика, Task Engine или хранилища.

## Уточнение проверки K03/K05: состояние raw reed и source authority (07.11.2026)

Сверка `reconcile_with_existing_reports()` теперь отвергает дрейф `raw_state_classes` и `ui_context_populated_field_counts` в каждом C14 эпизоде: простого равенства числа raw/UI записей недостаточно. Сопоставление использует уже разобранные C14 исходные строки и не создаёт нового detector.

Публичный `public_summary()` различает `raw_reed_state_compatible_candidates_5s` и `raw_reed_other_state_or_unknown_candidates_5s`; оба типа — **только временные кандидаты**. Состояние raw reed, совпадающее с производной записью sensor OCEL, **не доказывает независимость исходного устройства, личность, действие или синхронизацию часов**: `raw_reed_independent_physical_source_proven=false`. Для pinned Scene 01 в каждом из трёх эпизодов C14 содержит 2 raw reed кандидата: 1 с совпадающим и 1 с иным состоянием. Три state-compatible пары не равны трём человеческим действиям.

Разделены `original_bytes_sha_verified` и `canonical_solve4x_pins_verified`. Оригинальные байты с caller-supplied SHA могут быть корректно перечитаны в синтетическом тесте, но не получают полномочий canonical Solve4X. `canonical_solve4x_pins_verified=true` выставляется только при actual owner-local original replay, неизменных закреплённых SHA из C12 и полном сравнении packet. Даже это не удостоверяет права доступа или независимый human gold.

Контракт K03/K05 по-прежнему **не** является непосредственным входом K03 Task Engine или K05 Evaluation Engine: K03 владеет Task hypotheses и уточнениями, K05 владеет измерением и independent review. Следующая предметная квалификация — реальная owner-local независимая разметка видео в существующей инфраструктуре Label Studio. До неё `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.


## Проверка фактических потребителей (07.11.2026)

K03 (`work/2026-11-05-k03-activity-task-discovery`, HEAD `8f3ce9e58723fff2d51a44cee5b63b4dd15a6441`) уже содержит `modules/k03-activity-task-discovery/solve4x_activity_projection.py`: `project_scene01()`, `verify_projection()`, `replay_scene01()`. Этот потребитель выдаёт `CLARIFICATION_REQUIRED` и 0 Tasks, но `DERIVED_REVIEW_EPISODE_ORDINAL` не является локатором настоящего OCEL event ID. Для owner-local source verification использовать существующие `prepare_owner_local()` и `verify_owner_local_locator()`; не считать числовой ordinal исходным событием.

K05 (`work/2026-11-05-k05-evidence-context-evaluation`, HEAD `5a85e1fe01d842d9cef1388b1088ecb0cdc78c41`) уже содержит `research/cross-lab/k05_c17_projection.py` и `compare_c17_aggregate()`. Он проверяет три baseline 23/6/3 и структуру C17, но `owner_score` остаётся неаттестованным агрегатом. До оценки нужно зафиксировать отдельный `frozen_plan_sha256` из C17 `prepare`; CLI `blank` и `score` теперь требуют `--expected-plan-sha256`. Это предотвращает незамеченную смену плана, но не удостоверяет подлинность разметки. Ни K03, ни K05 не редактируются этой исследовательской веткой. `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.
