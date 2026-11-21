# IWXA AI-context public isolated QA

Test-only copies of the exact three Python modules from private `Faust-S/iwxa` commit `1897f8c08814fbbc6319257ff4ba14abe280c519`, authorized by the owner on 2026-11-21; search.py updated from private commit `d7f3aa7a42f621e824f055c06b960096305263e6`. Private `Faust-S/iwxa` remains the only implementation owner and deployment source.

| Copied module | Original Git blob SHA |
|---|---|
| `source/read_policy.py` | `e03d06fca047cf15eae790fc2abc0374ac1968ee` |
| `source/search.py` | `d2b487864c82b9e2b14200a8606ad1ac3a7112f5` |
| `source/system.py` | `8f738dd901d46b99f0c16b0aa39ffa34b7d908b7` |

All source registries, graph entries, policies, local files and sync states in tests are synthetic, created temporarily at runtime. No private knowledge graph, science corpus, customer data, tokens or proprietary evidence is published. No private GitHub Actions and no GitHub authentication in test jobs.

Run: `python -m unittest discover -s experiments/ai-context-qa/tests -p "test_*.py" -v`.

Tests check archived source exclusion, deliberate archive opt-in, drift recovery, SHA and CRLF handling, externally cached source validation, graph visibility, historical sync filtering and scoped context assembly. In the context test only, full model verification is deliberately stubbed: this does not constitute a native private-checkout `system.py render/verify`, a full knowledge-integrity qualification, nor product acceptance.

Fixes, if required, must be made in the private owner then re-copied from the exact owning revision. This branch is disposable test infrastructure, not another IWXA product.

Additional focused excerpt checks: source-vs-window character offsets, title-only hit fallback, 420-character excerpt budget, metadata-only references without fake source-body offsets.
