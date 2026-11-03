"""Static checks for SPECIALIZED AGENT SOLUTIONS, not for agent software platforms."""
from pathlib import Path
import json
import re

ROOT=Path(__file__).resolve().parents[1]
STATUSES={"LISTING_SCREENED","SOURCE_INSPECTED","ADAPTED_NOT_EXECUTED","TASK_TESTED","IWXA_VERIFIED"}
HEX40=re.compile(r"^[0-9a-f]{40}$")
MARKET_URL=re.compile(r"^https://(marketplace[.]dify[.]ai|github[.]com)/")
REQUIRED={"id","title","agent_kind","status","source","task_and_result","structure","requirements","qualification","installable"}

def insist(ok,code):
    if not ok: raise ValueError(code)

def load(path):
    def no_dupes(pairs):
        x={}
        for k,v in pairs:
            insist(k not in x,"DUPLICATE_JSON_KEY")
            x[k]=v
        return x
    return json.loads(Path(path).read_text("utf-8"),object_pairs_hook=no_dupes)

def check_solution(x):
    insist(isinstance(x,dict) and set(x)==REQUIRED,"AGENT_FIELDS")
    insist(re.fullmatch(r"[a-z][a-z0-9-]{2,70}",x["id"]) is not None,"AGENT_ID")
    insist(x["agent_kind"]=="specialized_workflow","NOT_SPECIALIZED_AGENT")
    insist(x["status"] in STATUSES,"STATUS")
    src=x["source"]
    insist(MARKET_URL.match(src["url"]) is not None,"SOURCE_URL")
    insist(src["source_rights"]!="CLEARED_WITHOUT_EVIDENCE","SOURCE_RIGHTS")
    insist(src["third_party_code_redistributed"] is False,"UNLICENSED_COPY")
    if "files_verified" in src:
        insist(src.get("native_workflow_acquired") is True and HEX40.fullmatch(src["commit"]) is not None,"SOURCE_NOT_PINNED")
        insist(len(src["files_verified"])>=2 and all(HEX40.fullmatch(y["git_blob"]) for y in src["files_verified"]),"SOURCE_FILES")
    else:
        insist(src.get("native_workflow_acquired") is False,"UNVERIFIED_SOURCE_FILE")
    task=x["task_and_result"]
    for field in ("user_request","input_slots","expected_result","not_for"):
        insist(bool(task[field]),"TASK_SUBSTANCE_"+field)
    struct=x["structure"]
    insist(len(struct["process_steps"])>=3 and len(set(struct["process_steps"]))==len(struct["process_steps"]),"NO_WORKFLOW")
    insist(bool(struct["algorithms"]) and bool(struct["external_effects"]),"NO_ALGORITHM_OR_EFFECTS")
    q=x["qualification"]
    insist(type(q["iwxa_verified"]) is bool and type(q["execution_receipts"]) is list,"BAD_RECEIPTS")
    insist(type(x["installable"]) is bool,"INSTALLABLE")
    if x["status"]=="LISTING_SCREENED":
        insist(not src["native_workflow_acquired"] and struct["definition_file"] is None and not q["execution_receipts"],"FALSE_LISTING_CLAIM")
    if x["status"]=="ADAPTED_NOT_EXECUTED":
        insist(src["native_workflow_acquired"] and struct["definition_file"] and
               (ROOT/struct["definition_file"]).is_file() and struct["prompts"] and
               not q["execution_receipts"],"ADAPTED_AGENT_SHELL")
        check_definition(load(ROOT/struct["definition_file"]))
    if x["status"] in {"LISTING_SCREENED","SOURCE_INSPECTED","ADAPTED_NOT_EXECUTED"}:
        insist(not q["iwxa_verified"] and not x["installable"],"PREMATURE_VERIFIED")
    if x["status"] in {"TASK_TESTED","IWXA_VERIFIED"}:
        insist(len(q["execution_receipts"])>=6,"REAL_EXECUTIONS_REQUIRED")
    if x["status"]=="IWXA_VERIFIED":
        insist(q["iwxa_verified"] is True and x["installable"] is True and
               len(q["execution_receipts"])>=9 and
               all(y.get("status")=="PASS" and y.get("readback") is True and
                   re.fullmatch(r"[0-9a-f]{64}",y.get("evidence_sha256","")) for y in q["execution_receipts"]),
               "NO_IWXA_TEST_EVIDENCE")
    return x

def check_definition(d):
    insist(d["schema"]=="iwxa.specialized-agent-definition/0.1","DEFINITION_SCHEMA")
    insist(d["status"]=="SPEC_COMPLETE_NOT_EXECUTED","FALSE_RUNTIME_RESULT")
    insist(len(d["state_machine"])>=4 and len(d["prompts"])>=2 and len(d["acceptance"])>=5,"DEFINITION_TOO_THIN")
    insist(not d["allowed_external_effects"] and not d["external_tools"],"UNAUTHORIZED_EFFECTS")
    insist("APPROVAL_PENDING" in [x["produces"] for x in d["state_machine"]],"MISSING_HUMAN_REVIEW")
    insist("transcript_text" in d["inputs"] and "reviewable_draft" in d["outputs"],"MISSING_TASK_IO")
    return d

def scan():
    files=sorted((ROOT/"catalog/solutions").glob("*.json"))
    insist(files,"NO_SOLUTIONS")
    rows=[check_solution(load(p)) for p in files]
    insist(len({x["id"] for x in rows})==len(rows),"DUPLICATED_AGENT_ID")
    insist(all((ROOT/"catalog/solutions"/(x["id"]+".json")).exists() for x in rows),"INVALID_FILE_NAME")
    return rows

if __name__=="__main__":
    x=scan()
    print(json.dumps({"total_solutions":len(x),"iwxa_verified":sum(r["qualification"]["iwxa_verified"] for r in x),"status":{r["id"]:r["status"] for r in x}},ensure_ascii=False))
