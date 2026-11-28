import json
import pathlib
import sys
temp=pathlib.Path(sys.argv[1])
run=json.loads((temp/"d05-qualified-predecessor-run.json").read_text())
job=json.loads((temp/"d05-qualified-predecessor-job.json").read_text())
assert run["head_sha"]=="94bb4b45f7262d6fc28f49001b5a48c73ebc8460"
assert job["id"]==140960744989 and job["run_id"]==46139054634
log=(temp/"d05-qualified-predecessor.log").read_text(errors="replace")
messages=[line.split("Z ",1)[1].strip() for line in log.splitlines() if "Z " in line]
markers=set(messages)
for key in ["source_gate","public_static","preview_gate","t2_production_gate","apache_gate"]:
    assert "D05_FINAL_GATE "+key+"=success" in markers, key
assert "D05_SOURCE_QUALIFIED_TREE=d89dd6a39c9e983d02b31b66339d587f10f626c6" in markers
assert "D05_FIRST_USE_REAL_T2_CROSS_SERVICE=PASS" in markers
assert "D05_CASE001_IWXA_CLEAN_PROFILE_27_RESULTS_AND_EVENTS=PASS" in markers
source=[json.loads(m.split(" ",1)[1]) for m in messages if m.startswith("D05_SOURCE_GATE {")]
assert len(source)==13 and all(r["status"]=="PASS" for r in source)
reg=next(r for r in source if r["name"]=="regression-coverage")
assert reg["tests"]=={"total":1584,"passed":1584,"failed":0,"pending":0}
t2=next(r for r in source if r["name"]=="t2-module")
assert t2["nodeCounts"]=={"tests":130,"pass":130,"fail":0}
static=[m.split()[1] for m in messages if m.startswith("D05_STATIC_GATE ") and m.endswith(" PASS")]
assert len(static)==15 and len(set(static))==15
receipt={"previousSiteCommit":"a6b3a9a0dea273f134268670e8abdc0321d8368e","previousTree":"d89dd6a39c9e983d02b31b66339d587f10f626c6","previousRun":46139054634,"previousJob":140960744989,"previousSource":source,"previousStatic":static,"previousT2Production":"PASS","currentSiteCommit":"a9ead59a8db271209112a200bf7a8816b8449e0c"}
if len(sys.argv)>2:
    result=json.loads((temp/"d05-current-targeted-tests.json").read_text())
    counts={k:result[k] for k in ("numTotalTests","numPassedTests","numFailedTests","numPendingTests")}
    print("D05_CURRENT_TARGETED_TEST_COUNTS "+json.dumps(counts))
    assert counts["numTotalTests"]>0 and counts["numFailedTests"]==0 and counts["numPendingTests"]==0
    assert counts["numPassedTests"]==counts["numTotalTests"]
    receipt["currentTargetedTests"]=counts
    (temp/"d05-source-gates.json").write_text(json.dumps(receipt,indent=2)+"\n")
print("D05_REUSE_CONFIRMED_1584_ALGORITHM_130_T2_15_STATIC_AND_REAL_T2_PRODUCTION")
