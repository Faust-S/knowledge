"""G4 Windows: the EXISTING Agent Python/Node IPC consumes original T3 employee first use.

The organization profile, original owner source and signed proof never enter a
public CI log. This driver creates no issuer, Kernel, registry, or carrier.
"""
import json
import os
import re
from pathlib import Path
from runtime.t3_original_employee_port import OriginalEmployeePort, CorporateT3Error

CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,119}$")


def main():
    mode = os.environ["G4_EMPLOYEE_BOOTSTRAP_MODE"]
    root = Path(os.environ["G4_EMPLOYEE_BOOTSTRAP_ROOT"])
    worker = Path(os.environ["PYTHONPATH"]) / "runtime" / "t3_original_employee_worker.mjs"
    port = OriginalEmployeePort(worker=worker, env=os.environ.copy())
    try:
        if mode == "CREATE":
            profile_path = Path(os.environ["G4_EMPLOYEE_PUBLIC_PROFILE_PATH"])
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
            try:
                candidate = port.employee_first_use(root, profile, confirmed=True)
                recovered = False
            except CorporateT3Error as error:
                if str(error) != "T3_OUTCOME_UNKNOWN_RECONCILE_FIRST":
                    raise
                # Read the ORIGINAL employee vault only. Never repeat a first-
                # use write after lost ACK: it could have committed already.
                try:
                    candidate = port.employee_candidate(root)
                except CorporateT3Error:
                    raise CorporateT3Error(
                        "T3_EMPLOYEE_FIRST_USE_RECONCILIATION_REQUIRED"
                    ) from None
                recovered = True
            assert candidate["state"] == "AWAITING_ORIGINAL_MANAGER_ENROLLMENT"
            assert candidate["originalKernelEnrollment"] is False
            assert candidate["organizationId"] == profile["organizationId"]
            assert candidate["workspaceId"] == profile["workspaceId"]
            assert candidate["managerPersonId"] == profile["managerPersonId"]
            assert isinstance(candidate.get("credentialKeyId"), str)
            assert candidate["employeeProofKeyRecord"]["subjectId"] == candidate["employeePersonId"]
            print(json.dumps({"candidate": candidate,
                              "readOnlyRecovered": recovered}, separators=(",", ":")))
        elif mode == "READ_CANDIDATE":
            candidate = port.employee_candidate(root)
            assert candidate["state"] == "AWAITING_ORIGINAL_MANAGER_ENROLLMENT"
            assert candidate["originalKernelEnrollment"] is False
            print(json.dumps({"candidate": candidate}, separators=(",", ":")))
        elif mode == "COLD_PROOF":
            request_path = Path(os.environ["G4_EMPLOYEE_PUBLIC_REQUEST_PATH"])
            request = json.loads(request_path.read_text(encoding="utf-8"))
            challenge = os.environ["G4_EMPLOYEE_ORIGINAL_CHALLENGE"]
            candidate = port.employee_candidate(root)
            result = port.employee_proof(root, request, challenge, confirmed=True)
            assert result["originalKernelWriteAttempted"] is False
            assert result["employeePersonId"] == candidate["employeePersonId"]
            assert result["credentialKeyId"] == candidate["credentialKeyId"]
            print(json.dumps({"candidate": candidate, "proof": result["proof"]},
                             separators=(",", ":")))
        else:
            raise ValueError("G4_EMPLOYEE_BOOTSTRAP_MODE_INVALID")
    finally:
        port.close()


try:
    main()
except Exception as error:
    code = str(error)
    print("G4_EMPLOYEE_BOOTSTRAP_FAILURE_CODE",
          code if CODE.fullmatch(code) else "UNCLASSIFIED")
    raise SystemExit(1)
