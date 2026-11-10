#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, zipfile
SCHEMA="IWXA_T2_K035_RC20_CURRENT_SOURCE_AUTHORITY_V1"
STATUS="CURRENT_CANONICAL_SOURCE_INPUT_AUTHORITY"
RECEIPT="IWXA_T2_K035_RC20_CURRENT_SOURCE_MATERIALIZATION_RECEIPT_V1"
PREFIX=pathlib.PurePosixPath("t2/current/final-successor/canonical-source-inputs/k035-rc20/chunks")
EFFECT="SOURCE_INPUT_ONLY_NO_RELEASE_NO_DEPLOY_NO_PROJECT_PROCESS_WRITE_AUTHORITY"

def fail(msg): raise SystemExit(msg)
def sha256(path):
    h=hashlib.sha256()
    with pathlib.Path(path).open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()
def blobsha(path):
    path=pathlib.Path(path); h=hashlib.sha1(); h.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("authority"); ap.add_argument("repo"); ap.add_argument("out"); ap.add_argument("receipt"); a=ap.parse_args()
    authority_path=pathlib.Path(a.authority).resolve(); repo=pathlib.Path(a.repo).resolve(); out=pathlib.Path(a.out).resolve(); receipt=pathlib.Path(a.receipt).resolve()
    obj=json.loads(authority_path.read_text(encoding="utf-8"))
    if obj.get("schema")!=SCHEMA or obj.get("status")!=STATUS: fail("CURRENT_SOURCE_AUTHORITY_INVALID")
    if obj.get("kernelTarget")!="0.3.5" or obj.get("workspaceTarget")!="0.34.0-rc.20": fail("CURRENT_SOURCE_TARGET_INVALID")
    if obj.get("historicalRecoveryRequired") is not False or obj.get("authorityEffect")!=EFFECT: fail("CURRENT_SOURCE_BOUNDARY_INVALID")
    if obj.get("bytePolicy")!="EXACT_GIT_BLOB_ALIAS_NO_REPACK_NO_BYTE_CHANGE": fail("CURRENT_SOURCE_BYTE_POLICY_INVALID")
    if any(obj.get(k) is not False for k in ("release_ready","productionDeploy","projectProcessWriteActivation")): fail("CURRENT_SOURCE_AUTHORITY_EFFECT_ESCALATION")
    chunks=obj["envelope"]["chunks"]
    if [x.get("ordinal") for x in chunks] != [1,2,3,4]: fail("CURRENT_SOURCE_CHUNK_ORDINAL_INVALID")
    if out.exists() and any(out.iterdir()): fail("CURRENT_SOURCE_OUTPUT_NOT_EMPTY")
    out.mkdir(parents=True,exist_ok=True); receipt.parent.mkdir(parents=True,exist_ok=True)
    envelope=out/obj["envelope"]["artifact"]; rows=[]
    with envelope.open("wb") as dst:
        for row in chunks:
            rel=pathlib.PurePosixPath(str(row.get("path","")))
            if rel.parts[:len(PREFIX.parts)]!=PREFIX.parts or ".." in rel.parts: fail("CURRENT_SOURCE_CHUNK_PATH_INVALID")
            p=repo.joinpath(*rel.parts).resolve()
            try: p.relative_to(repo)
            except ValueError: fail("CURRENT_SOURCE_CHUNK_ESCAPES_REPO")
            if not p.is_file() or p.stat().st_size!=row.get("sizeBytes"): fail("CURRENT_SOURCE_CHUNK_FILE_INVALID")
            actual=blobsha(p)
            if actual!=row.get("gitBlobSha1"): fail(f"CURRENT_SOURCE_CHUNK_GIT_BLOB_MISMATCH:{actual}")
            with p.open("rb") as src:
                for b in iter(lambda:src.read(1024*1024),b""): dst.write(b)
            rows.append({"ordinal":row["ordinal"],"path":row["path"],"gitBlobSha1":actual,"sizeBytes":p.stat().st_size})
    envsha=sha256(envelope)
    if envsha!=obj["envelope"]["sha256"]: fail(f"CURRENT_SOURCE_ENVELOPE_SHA_MISMATCH:{envsha}")
    comps={}
    with zipfile.ZipFile(envelope) as z:
        for key in ("kernel","workspace"):
            spec=obj["components"][key]; names=[n for n in z.namelist() if n.endswith(spec["memberSuffix"])]
            if len(names)!=1: fail(f"CURRENT_SOURCE_COMPONENT_AMBIGUOUS:{key}:{len(names)}")
            data=z.read(names[0]); actual=hashlib.sha256(data).hexdigest()
            if actual!=spec["sha256"]: fail(f"CURRENT_SOURCE_COMPONENT_SHA_MISMATCH:{key}:{actual}")
            target=out/spec["artifact"]; target.write_bytes(data)
            comps[key]={"artifact":spec["artifact"],"member":names[0],"sha256":actual,"sizeBytes":len(data),"path":str(target)}
    result={"schema":RECEIPT,"status":"CURRENT_SOURCE_INPUT_MATERIALIZED_VERIFIED","kernelTarget":"0.3.5","workspaceTarget":"0.34.0-rc.20","historicalRecoveryRequired":False,"authorityEffect":EFFECT,"bytePolicy":obj["bytePolicy"],"sourceAuthoritySha256":sha256(authority_path),"envelope":{"artifact":envelope.name,"sha256":envsha,"sizeBytes":envelope.stat().st_size,"path":str(envelope)},"chunks":rows,"components":comps,"release_ready":False,"productionDeploy":False,"projectProcessWriteActivation":False}
    receipt.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8"); print(json.dumps(result,indent=2))
if __name__=="__main__": main()
