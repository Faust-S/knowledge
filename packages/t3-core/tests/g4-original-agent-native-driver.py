"""Public Windows qualification script; original signers are loaded by Node worker."""
import hashlib
import os
import re
from pathlib import Path
from runtime.t3_original_employee_port import OriginalEmployeePort,CorporateT3Error

phase="OPEN"
def require(condition,label):
    if not condition:
        raise AssertionError(label)

def owner():
    return OriginalEmployeePort(
        worker=Path(__file__).parents[2] / "unused" if False else
          Path(os.environ["PYTHONPATH"]) / "runtime" / "t3_original_employee_worker.mjs",
        env=os.environ.copy())

try:
    require("T3_READ_TOKEN" not in os.environ,"TOKEN_NOT_ISOLATED")
    require("AGENT_READ_TOKEN" not in os.environ,"TOKEN_NOT_ISOLATED")
    employee_root=os.environ["G4_CONTROL_ROOT"]
    invite=os.environ["G4_INVITE_PATH"]
    task_path=os.environ["G4_TASK_PATH"]
    result_path=os.environ["G4_RESULT_PATH"]
    port=owner()
    try:
        phase="CONNECT"
        initial=port.call("connect",{"root":employee_root})
        require(initial.get("context")=="PERSONAL","PERSONAL_REQUIRED")
        phase="ORIGINAL_SIGNED_INVITE"
        port.call("import_invite",{"path":invite},consequential=True)
        port.call("select",{"context":"ORGANIZATION"})
        phase="ORIGINAL_SIGNED_TASK_RECEIVE"
        received=port.call("receive_task",{"path":task_path},consequential=True)
        phase="ORIGINAL_SIGNED_TASK_READ"
        task=port.task()
        phase="ORIGINAL_SIGNED_TASK_BINDING"
        require(received.get("taskRevisionId")==task.get("taskRevisionId"),
                "TASK_REVISION_REQUIRED")
        require(task.get("taskId","").startswith("task:"),"SIGNED_TASK_REQUIRED")
        phase="AGENT_ACCEPTED_RESULT_PROJECTION"
        text='{"acceptedSummary":"Equipment comparison completed; evidence checked."}'
        digest=hashlib.sha256(text.encode("utf-8")).hexdigest()
        prepared=port.call("prepare",{"text":text,"projectionSha256":digest},
                           consequential=True)
        require(prepared.get("state")=="RESULT_PREPARED","RESULT_PREPARE_REQUIRED")
        review=port.call("preview")
        require(review.get("state")=="HUMAN_REVIEW_REQUIRED" and
                review.get("signed") is False,"HUMAN_PREVIEW_REQUIRED")
        phase="ORIGINAL_SIGNED_RESULT"
        saved=port.call("export",{"path":result_path,
            "previewDigest":review["previewDigest"],"confirmed":True},
            consequential=True)
        require(saved.get("signed") is True and
                saved.get("exported") is True,"SIGNATURE_REQUIRED")
        require(saved.get("taskRevisionId")==task["taskRevisionId"],
                "RESULT_TASK_BINDING_INVALID")
    finally:
        port.close()
    phase="ORIGINAL_EMPLOYEE_COLD_RESTART"
    cold=owner()
    try:
        cold.call("connect",{"root":employee_root})
        cold.call("select",{"context":"ORGANIZATION"})
        cold.call("select_task",{"taskId":task["taskId"]})
        require(cold.task()["taskRevisionId"]==task["taskRevisionId"],
                "COLD_TASK_MISMATCH")
        try:
            cold.call("prepare",{"text":text,"projectionSha256":digest},
                      consequential=True)
        except CorporateT3Error as error:
            require(str(error)=="T3_PRIOR_RESULT_EXPORT_RECONCILIATION_REQUIRED",
                    "COLD_REEXPORT_DENIAL_WRONG_REASON")
        else:
            raise AssertionError("COLD_REEXPORT_NOT_BLOCKED")
    finally:
        cold.close()
    print("G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_TASK_PASS")
    print("G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_RESULT_PASS")
    print("G4_ORIGINAL_NATIVE_EMPLOYEE_COLD_NO_REEXPORT_PASS")
except Exception as error:
    print("G4_NATIVE_FAILURE_PHASE",phase)
    code=str(error)
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,119}",code):
        code="UNCLASSIFIED"
    print("G4_NATIVE_FAILURE_CODE",code)
    permitted={"KeyError","TypeError","ValueError","AssertionError",
      "CorporateT3Error","OSError","TimeoutError","AttributeError",
      "RuntimeError","IndexError"}
    print("G4_NATIVE_FAILURE_CLASS",
      type(error).__name__ if type(error).__name__ in permitted
      else "UNCLASSIFIED")
    raise SystemExit(1)
