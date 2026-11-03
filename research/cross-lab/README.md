# Cross-Lab public native U1 replication — M2 research slice

**Status:** independently reproducible engineering research, **not** Task Discovery E5 qualification, not a product integration, not an IWXA Task Engine fork.

This directory provides one pinned copy of the owning U1 reader (`Faust-S/iwxa@research/ai-crosslab-practical-pilot`) *only* as a frozen execution dependency for open regression. It has **not** been adapted or maintained as a public runtime. The real code owner remains the original repository; any future U1 change must be qualified at its source, then separately pinned here. No new Task Engine, Context Compiler, Store, Rights or Label Studio evaluator is implemented.

**Передача в проект «Система знаний» (04.11.2026):** [полный Cross-Lab handoff](HANDOFF_SYSTEMA_ZNANIY_2026-11-04_RU.md). В нём приведены актуальные инженерные результаты, владельцы, научные ограничения и следующий предметный gate M3.

## Source-pinned components

| Artifact | Exact original Git blob | Purpose |
|---|---|---|
| `owner_pins/universal_evidence.py` | `eb15aec5ba1a749c29d7c40a868127e1a384b6bf` | Original read-only E1/U1 code, standard-library-only `inspect`/`review_hints` |
| `owner_pins/E5_LABEL_STUDIO_SOURCE_FIRST.xml` | `7b82dbd05b4e28c53446d863c5bb48b72245a10d` | Unmodified original E5 source-first Label Studio format |
| `REAL_PUBLIC_ISSUE_SLICE_20261103.json` | `e22b8b3926889564f6ed70b49471b1057fa2724a` | Eight preselected public issues, exact source hashes, **no text** |

The upstream source is owned by `Faust-S/iwxa` and was published here only in a narrowly scoped, pinned research QA snapshot. A GitHub repository being public is not itself a grant of an open-source license to third parties. The pinned U1's Git history attributes its development to the project owner (and related development tools); the file uses Python's standard library and contains no personal credentials, secrets, or private datasets. The project has no root LICENSE in the inspected upstream snapshot; a general reusable open-source license is **not claimed**.

## Local and public replay

```sh
python -W error::ResourceWarning -m unittest discover -s research/cross-lab/tests -v
python research/cross-lab/replay.py --out /tmp/crosslab-native-receipt.json
```

The second command re-fetches **only eight preselected public GitHub issues** using `api.github.com`, verifies the original issue identity and exact selection-time byte hashes, then calls the pinned *native* U1. If an issue has been edited or API access is unavailable, the replay returns a fixed `HOLD` code, **not** a silently updated source or a fabricated PASS. Source text remains transient in local memory and is **never** uploaded to GitHub Actions artifacts or written to stdout. Public Actions upload only counts, source links/hashes and anonymous timing data.

To review a source-first packet in an **owner-local** existing Label Studio installation (not in public CI), add `--blind-out /PRIVATE/review.json`. This writes the **raw source text** to the explicitly selected local file; do not commit, log, or upload it. The original E5 XML is verified before use. No `predictions` or `annotations` appear in the packet; this program does not score labels or generate independent human gold. Do not mislabel this exploratory developer-selected set as an E5 held-out cohort.

Baselines: direct reading of all eight sources; title-word regex and exact-issue-reference counts. The pinned native U1 adds RawStatement anchors and lexical cues but does not determine independent tasks. The SHA+BFS dependency method is inapplicable until an independently confirmed dependency graph is available. Do not claim task precision/recall, reduced revalidation, human time savings or superiority without two independent subject reviewers, adjudication and a predeclared comparison through the **existing** TASK-EXP-01/Label Studio program at the owner.

**Owner:** source code remains `Faust-S/iwxa`; this directory is a read-only open benchmarking fixture. **Product consumer:** `Faust-S/iwxa-personal-agent` only after a measured advantage and separate integration QA. **Public research coordination:** `Faust-S/knowledge`; **closed integration decisions:** `Faust-S/IWXA-knowledge`.
