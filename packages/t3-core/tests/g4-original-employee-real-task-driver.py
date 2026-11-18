"""Real original T3 invitation and Task into the EXISTING Agent Node/Python IPC.

Public Windows qualification only; original private code remains staged and
deleted on the public CI runner. No second interpreter of .iwxa is implemented.
No Agent engine submission or artificial Result is performed here.
"""
import json
import os
import re
from pathlib import Path

from runtime.t3_original_employee_port import OriginalEmployeePort

CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,119}$")
FIELDS = (
    "organizationId", "workspaceId", "executorId", "taskId",
    "taskRevisionId", "packageSha256",
)


def load_expected():
    path = Path(os.environ["G4_AGENT_EMPLOYEE_EXPECTED_FILE"])
    value = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(value, dict) and all(
        isinstance(value.get(k), str) and value[k] for k in FIELDS
    ), "G4_AGENT_VERIFIED_TASK_EXPECTED_REQUIRED"
    return value


def verify(port, expected):
    actual = port.task()
    assert all(actual[k] == expected[k] for k in FIELDS), (
        "G4_AGENT_ORIGINAL_EMPLOYEE_TASK_BINDING_CHANGED"
    )
    assert isinstance(actual["task"], str) and actual["task"], (
        "G4_AGENT_ORIGINAL_EMPLOYEE_SIGNED_TEXT_REQUIRED"
    )
    # The existing Agent's deterministic submission binding must survive
    # process-cold reopening. This is NOT a new Task ID or a second registry.
    submission = port.submission_id(actual)
    assert isinstance(submission, str) and re.fullmatch(r"[a-f0-9]{32}", submission), (
        "G4_AGENT_ORIGINAL_TASK_SUBMISSION_BINDING_INVALID"
    )
    return True


def main():
    mode = os.environ["G4_AGENT_EMPLOYEE_TASK_MODE"]
    root = Path(os.environ["G4_EMPLOYEE_BOOTSTRAP_ROOT"])
    worker = Path(os.environ["PYTHONPATH"]) / "runtime" / "t3_original_employee_worker.mjs"
    expected = load_expected()
    port = OriginalEmployeePort(worker=worker, env=os.environ.copy())
    try:
        candidate = port.employee_candidate(root)
        assert candidate["employeePersonId"] == expected["executorId"], (
            "G4_AGENT_ORIGINAL_EMPLOYEE_CANDIDATE_CHANGED"
        )
        connected = port.call("connect", {"root": str(root)})
        assert connected["context"] == "PERSONAL"
        if mode == "IMPORT_RECEIVE":
            invite = os.environ["G4_AGENT_ORIGINAL_INVITATION_PATH"]
            task = os.environ["G4_AGENT_ORIGINAL_TASK_PATH"]
            port.call("import_invite", {"path": invite}, consequential=True)
            switched = port.call("select", {"context": "ORGANIZATION"})
            assert switched["context"] == "ORGANIZATION", (
                "G4_AGENT_ORIGINAL_ORG_SELECTION_REQUIRED"
            )
            received = port.call("receive_task", {"path": task}, consequential=True)
            assert received["state"] == "TASK_RECEIVED"
            assert verify(port, expected)
        elif mode == "COLD_READBACK":
            switched = port.call("select", {"context": "ORGANIZATION"})
            assert switched["context"] == "ORGANIZATION"
            selected = port.call(
                "select_task", {"taskId": expected["taskId"]})
            assert selected["state"] == "TASK_RECEIVED"
            assert verify(port, expected)
        else:
            raise ValueError("G4_AGENT_EMPLOYEE_TASK_MODE_INVALID")
        # Task content and private proofs never enter the public CI log.
        print(json.dumps({"verified": True, "mode": mode},
                         separators=(",", ":")))
    finally:
        port.close()


try:
    main()
except Exception as error:
    code = str(error)
    print("G4_AGENT_EMPLOYEE_TASK_FAILURE_CODE",
          code if CODE.fullmatch(code) else "UNCLASSIFIED")
    raise SystemExit(1)
