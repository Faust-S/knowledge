#!/usr/bin/env python3
"""SOURCE CATALOG validation only. Not an agent safety / execution test."""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
STAGES={"DISCOVERED","SOURCE_SCREENED","INSTALL_TESTED","TASK_TESTED","IWXA_VERIFIED","REJECTED"}
FIELDS={"schema","id","name","kind","source","selection","iwxa","verification"}
SOURCE_FIELDS={"repository","commit","license","license_file","license_blob","readme_blob"}
SELECTION_FIELDS={"task_families","advertised_functions","requires","not_for"}
IWXA_FIELDS={"adapter","integration","currently_allowed_privacy","tool_execution_verified"}
VERIFY_FIELDS={"status","verified_functions","trial_receipts","known_blockers"}
HEX=re.compile(r"^[a-f0-9]{40}$")
ID=re.compile(r"^[a-z0-9-]{2,64}$")

def require(ok,msg):
    if not ok: raise ValueError(msg)

def read_json(path):
    def reject_dupes(pairs):
        out={}
        for k,v in pairs:
            require(k not in out,"DUPLICATE_JSON_KEY:"+k)
            out[k]=v
        return out
    def invalid_constant(c):raise ValueError("NON_FINITE_JSON:"+c)
    return json.loads(Path(path).read_text("utf-8"),object_pairs_hook=reject_dupes,
                      parse_constant=invalid_constant)

def validate(row):
    require(type(row) is dict and set(row)==FIELDS,"INVALID_AGENT_FIELDS")
    require(row["schema"]=="iwxa.verified-agent-candidate/0.1","INVALID_SCHEMA")
    require(type(row["id"]) is str and ID.fullmatch(row["id"]) is not None,"INVALID_ID")
    require(type(row["name"]) is str and len(row["name"])>=3,"INVALID_NAME")
    require(row["kind"] in {"agent_program","terminal_agent","editor_agent_extension","tested_agent_configuration"},"NOT_AN_AGENT")
    s=row["source"]
    require(type(s) is dict and set(s)==SOURCE_FIELDS,"INVALID_SOURCE_FIELDS")
    require(type(s["repository"]) is str and re.fullmatch(r"[\w.-]+/[\w.-]+",s["repository"]) is not None,"INVALID_REPO")
    for key in ("commit","license_blob","readme_blob"):
        require(type(s[key]) is str and HEX.fullmatch(s[key]) is not None,"UNPINNED_"+key)
    require(type(s["license"]) is str and s["license"] not in ("","UNKNOWN"),"UNKNOWN_LICENSE")
    require(type(s["license_file"]) is str and not s["license_file"].startswith("/") and ".." not in s["license_file"],"UNSAFE_LICENSE_PATH")
    q=row["selection"]
    require(type(q) is dict and set(q)==SELECTION_FIELDS,"INVALID_SELECTION_FIELDS")
    for field in SELECTION_FIELDS:
        require(type(q[field]) is list and q[field] and all(type(v) is str and len(v.strip())>=3 for v in q[field]),"EMPTY_SELECTION_"+field)
    i=row["iwxa"]
    require(type(i) is dict and set(i)==IWXA_FIELDS,"INVALID_IWXA_FIELDS")
    require(i["integration"] in ("NOT_IMPLEMENTED","SOURCE_OBSERVED_PROPOSAL_ONLY","REAL_INTEGRATION_TESTED"),"INVALID_INTEGRATION")
    require(i["adapter"] is None or type(i["adapter"]) is str and ID.fullmatch(i["adapter"].replace("_","-")),"INVALID_ADAPTER")
    require(type(i["currently_allowed_privacy"]) is list and set(i["currently_allowed_privacy"])<={"PUBLIC","SYNTHETIC","PRIVATE"},"INVALID_PRIVACY")
    require(type(i["tool_execution_verified"]) is bool,"INVALID_TOOL_VERIFICATION")
    if i["integration"]=="NOT_IMPLEMENTED":
        require(i["adapter"] is None and not i["currently_allowed_privacy"] and not i["tool_execution_verified"],"FALSE_RUNTIME_CLAIM")
    if i["integration"]=="SOURCE_OBSERVED_PROPOSAL_ONLY":
        require(i["adapter"] is not None and set(i["currently_allowed_privacy"])<={"PUBLIC","SYNTHETIC"} and not i["tool_execution_verified"],"FALSE_PROPOSAL_AUTHORITY")
    v=row["verification"]
    require(type(v) is dict and set(v)==VERIFY_FIELDS,"INVALID_VERIFICATION_FIELDS")
    require(v["status"] in STAGES,"INVALID_STAGE")
    require(type(v["verified_functions"]) is list and type(v["trial_receipts"]) is list and type(v["known_blockers"]) is list,"INVALID_EVIDENCE")
    if v["status"] in ("DISCOVERED","SOURCE_SCREENED","INSTALL_TESTED"):
        require(not v["verified_functions"] and not v["trial_receipts"],"FAKE_VERIFIED_RESULTS")
    if v["status"] in ("TASK_TESTED","IWXA_VERIFIED"):
        require(v["trial_receipts"] and v["verified_functions"],"REAL_TRIALS_REQUIRED")
    if v["status"]=="IWXA_VERIFIED":
        require(i["integration"]=="REAL_INTEGRATION_TESTED" and i["tool_execution_verified"],"IWXA_INTEGRATION_NOT_TESTED")
        require(not v["known_blockers"],"BLOCKERS_OPEN")
        trials=v["trial_receipts"]
        require(len(trials)>=9 and sum(x.get("case_class")=="positive" for x in trials)>=6
                and sum(x.get("case_class")=="negative" for x in trials)>=3,"INSUFFICIENT_REAL_TRIALS")
        require(all(type(x) is dict and x.get("status")=="PASS"
              and type(x.get("evidence_sha256")) is str
              and re.fullmatch(r"[0-9a-f]{64}",x["evidence_sha256"])
              and type(x.get("runtime_sha256")) is str
              and re.fullmatch(r"[0-9a-f]{64}",x["runtime_sha256"])
              and x.get("readback") is True for x in trials),"UNVERIFIED_TRIAL")
    return row

def load_catalog(folder=None):
    folder=Path(folder or ROOT/"catalog/agents")
    items=[]
    seen=set()
    for path in sorted(folder.glob("*.json")):
        row=validate(read_json(path))
        require(path.stem==row["id"],"MISNAMED_AGENT_RECORD")
        require(row["id"] not in seen,"DUPLICATE_AGENT_ID")
        seen.add(row["id"])
        items.append(row)
    require(items,"EMPTY_CATALOG")
    return items

def index(rows):
    rows=[validate(x) for x in rows]
    return {"schema":"iwxa.agent-library-index/0.1",
            "count":len(rows),
            "verified_count":sum(x["verification"]["status"]=="IWXA_VERIFIED" for x in rows),
            "agents":[{"id":x["id"],"name":x["name"],"status":x["verification"]["status"],
                       "task_families":x["selection"]["task_families"],
                       "verified_functions":x["verification"]["verified_functions"]}
                      for x in sorted(rows,key=lambda a:a["id"])]}
if __name__=="__main__":
    print(json.dumps(index(load_catalog()),ensure_ascii=False,indent=2))
