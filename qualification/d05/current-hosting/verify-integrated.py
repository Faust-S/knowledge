import json
import pathlib
import sys

temp=pathlib.Path(sys.argv[1])
run=json.loads((temp/"d05-qualified-integrated-run.json").read_text())
job=json.loads((temp/"d05-qualified-integrated-job.json").read_text())
assert run["head_sha"]=="da02d2e9ca477b2266b8dba98e7d1ced50c3d2e7"
assert job["id"]==140967926402 and job["run_id"]==46141394525
assert job["name"]=="linux" and job["status"]=="completed"
messages=[line.split("Z ",1)[1].strip() for line in (temp/"d05-qualified-integrated.log").read_text(errors="replace").splitlines() if "Z " in line]
markers=set(messages)
for key in ("source_gate","preview_gate","t3_production_gate","apache_gate","assistant_gate","link_gate"):
    assert "D05_FINAL_GATE "+key+"=success" in markers, key
for marker in ("D05_SOURCE_QUALIFIED_TREE=50e93d12e0a0648674fb83aad9f20be1c5e46247",
               "D05_T3_CASE001_OFFLINE_PRODUCTION_CLOSED=PASS",
               "D05_T3_CASE001_OFFLINE_PHYSICAL_EXCHANGE=PASS",
               "D05_T3_CASE001_COLD_OFFLINE_COMPLETE=PASS",
               "D05_CURRENT_T3_OFFLINE_PRODUCTION_PASS",
               "D05_CURRENT_RENDERED_LINKS_PASS",
               "D05_BROWSER_WITNESS check-t3-assistant-browser PASS",
               "D05_BROWSER_WITNESS check-t3-assistant-dynamic PASS",
               "D05_BROWSER_WITNESS check-t3-public-offline PASS"):
    assert marker in markers, marker
reports={}
for m in messages:
    if m.startswith('{"status":"CEHOVOD_T3_') or m.startswith('{"status":"D05_T3_RENDERED'):
        row=json.loads(m)
        reports[row["status"]]=row
routes=reports["D05_T3_RENDERED_LINK_AUDIT_PASS_NOT_PRODUCT_ACCEPTED"]
assert routes["clicks"]==routes["plannedClicks"]==262
assert routes["declaredPages"]==45 and routes["publicPages"]==42
assert routes["freshDocumentPerVisit"] and routes["browserCacheDisabled"] and routes["serviceWorkerBypassed"]
assert reports["CEHOVOD_T3_ASSISTANT_NO_MODEL_PASS"]["routes"]==22
assert reports["CEHOVOD_T3_ASSISTANT_NO_MODEL_PASS"]["forms"]==20
assert reports["CEHOVOD_T3_DYNAMIC_CONTEXT_PASS"]["sameAssistant"]
assert reports["CEHOVOD_T3_ALL_SITE_COLD_PASS"]["siteRoutes"]==42
assert reports["CEHOVOD_T3_PUBLIC_COLD_OFFLINE_PASS"]["serverStopped"]
external=[json.loads(m.split(" ",1)[1]) for m in messages if m.startswith("D05_EXTERNAL_LINK_RESULT ")]
assert len(external)==5
broken=[row for row in external if row["status"]!="PASS"]
assert len(broken)==1 and broken[0]["http"]==404 and broken[0]["sha256"]=="ad6ab7b161016778dbaad3e71a6c5c8611971b92f17fd6aacd18df7e250a0230"
receipt={"siteCommit":"a9ead59a8db271209112a200bf7a8816b8449e0c","sourceTree":"50e93d12e0a0648674fb83aad9f20be1c5e46247","run":46141394525,"job":140967926402,"currentSiteCommit":"75eddb38289b5b10bffad82e2a6c2fc277101617","changeBoundary":"one public external reference removed, no executable changes","T3AutonomousProduction":"PASS","assistantAndNavigation":reports,"priorExternal":external}
(temp/"d05-integrated-evidence.json").write_text(json.dumps(receipt,indent=2)+"\n")
print("D05_REUSE_PROTECTED_T3_PRODUCTION_22_ASSISTANT_ROUTES_20_FORMS_262_NAVIGATION_ACTIONS")
