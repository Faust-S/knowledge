"""G4 installed second Windows SID: genuine installed Agent Python -> original T3
employee Node owner. No synthetic signer, second kernel, manager private keys,
test-granted membership, repeated consequential command or public private logs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import uuid
from pathlib import Path
from runtime.t3_original_employee_port import OriginalEmployeePort

CODE = re.compile(r"^[A-Z][A-Z0-9_]{3,119}$")


def require(ok: bool, code: str) -> None:
    if not ok:
        raise RuntimeError(code)


def load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(type(value) is dict, "G4_INSTALLED_EMPLOYEE_JSON_INVALID")
    return value


def digest(data: dict) -> str:
    return hashlib.sha256(json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    for name in ("phase", "program", "owner", "node", "profile", "root", "receipt", "proof"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    require(os.name == "nt", "G4_INSTALLED_EMPLOYEE_WINDOWS_REQUIRED")
    require(args.phase in ("create", "readback"), "G4_INSTALLED_EMPLOYEE_PHASE_INVALID")
    program, owner, node = Path(args.program), Path(args.owner), Path(args.node)
    root, receipt, proof = Path(args.root), Path(args.receipt), Path(args.proof)
    require(all(path.is_absolute() for path in (program, owner, node, root, receipt, proof)),
            "G4_INSTALLED_EMPLOYEE_ABSOLUTE_PATH_REQUIRED")
    worker = program / "runtime" / "t3_original_employee_worker.mjs"
    require(worker.is_file() and (program / "explorer-install-receipt.json").is_file(),
            "G4_INSTALLED_EMPLOYEE_ORIGINAL_AGENT_NOT_INSTALLED")
    require(node.is_file() and (owner / "interop" / "native-employee-d3.mjs").is_file(),
            "G4_INSTALLED_EMPLOYEE_ORIGINAL_OWNER_UNAVAILABLE")
    require(root.parent.is_dir() and receipt.parent == root.parent and
            proof.parent == root.parent and root != program,
            "G4_INSTALLED_EMPLOYEE_USER_DATA_SCOPE_INVALID")
    env = os.environ.copy()
    env["IWXA_T3_ORIGINAL_OWNER_DIR"] = str(owner)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    port = OriginalEmployeePort(node=str(node), worker=worker, env=env)
    try:
        if args.phase == "create":
            require(not root.exists() and not receipt.exists() and not proof.exists(),
                    "G4_INSTALLED_EMPLOYEE_FIRST_USE_ALREADY_EXISTS")
            profile = load(Path(args.profile))
            candidate = port.employee_first_use(root, profile, confirmed=True)
            require(candidate.get("schema") ==
                    "IWXA_T3_ORIGINAL_EMPLOYEE_WINDOWS_CANDIDATE/1" and
                    candidate.get("state") == "AWAITING_ORIGINAL_MANAGER_ENROLLMENT" and
                    candidate.get("originalKernelEnrollment") is False and
                    candidate.get("organizationId") == profile["organizationId"] and
                    candidate.get("workspaceId") == profile["workspaceId"] and
                    candidate.get("managerPersonId") == profile["managerPersonId"] and
                    candidate.get("employeePersonId") != profile["managerPersonId"] and
                    candidate.get("credentialKeyId"),
                    "G4_INSTALLED_EMPLOYEE_FIRST_USE_READBACK_INVALID")
            observed = port.employee_candidate(root)
            require(observed == candidate, "G4_INSTALLED_EMPLOYEE_ORIGINAL_CANDIDATE_CHANGED")
            receipt.write_text(json.dumps({
                "schema": "IWXA_G4_INSTALLED_EMPLOYEE_CANDIDATE_READBACK/1",
                "digest": digest(candidate),
                "employeePersonId": candidate["employeePersonId"],
                "credentialKeyId": candidate["credentialKeyId"],
                "organizationId": profile["organizationId"],
                "workspaceId": profile["workspaceId"],
            }, separators=(",", ":")), encoding="utf-8")
            print("G4_INSTALLED_EMPLOYEE_ORIGINAL_NATIVE_FIRST_USE_PASS")
        else:
            require(receipt.is_file() and not proof.exists(),
                    "G4_INSTALLED_EMPLOYEE_COLD_RECEIPT_REQUIRED")
            expected = load(receipt)
            profile = load(Path(args.profile))
            candidate = port.employee_candidate(root)
            require(expected.get("schema") ==
                    "IWXA_G4_INSTALLED_EMPLOYEE_CANDIDATE_READBACK/1" and
                    expected.get("digest") == digest(candidate) and
                    expected.get("employeePersonId") == candidate.get("employeePersonId") and
                    expected.get("credentialKeyId") == candidate.get("credentialKeyId") and
                    expected.get("organizationId") == profile.get("organizationId") and
                    expected.get("workspaceId") == profile.get("workspaceId") and
                    candidate.get("originalKernelEnrollment") is False,
                    "G4_INSTALLED_EMPLOYEE_ORIGINAL_DPAPI_COLD_CHANGED")
            request = {
                "id": "proof-key:employee:" + str(uuid.uuid4()),
                "actorId": candidate["employeePersonId"],
                "principalId": profile["organizationId"],
                "roleId": "worker",
                "grantId": "proof-key:prospective",
                "audience": "t3.employee.enrollment",
                "resource": profile["workspaceId"],
                "action": "work.prepare",
                "purpose": "work",
                "realmId": profile["realmId"],
                "operationDigest": hashlib.sha256(
                    b"g4-installed-employee-first-use-proof"
                ).hexdigest(),
            }
            challenge = secrets.token_hex(32)
            signed = port.employee_proof(root, request, challenge, confirmed=True)
            original = signed.get("proof", {})
            require(signed.get("schema") == "IWXA_T3_ORIGINAL_EMPLOYEE_PROOF/1" and
                    signed.get("employeePersonId") == candidate["employeePersonId"] and
                    signed.get("credentialKeyId") == candidate["credentialKeyId"] and
                    signed.get("grantIssued") is False and
                    signed.get("originalKernelWriteAttempted") is False and
                    original.get("keyId") == candidate["credentialKeyId"] and
                    original.get("payload", {}).get("kind") == "PROOF" and
                    original.get("payload", {}).get("challenge") == challenge,
                    "G4_INSTALLED_EMPLOYEE_ORIGINAL_SIGNED_PROOF_INVALID")
            # Proof contains ONLY the public key, public request and its signed
            # challenge. Native Node verifies the Ed25519 signature separately.
            proof.write_text(json.dumps({
                "schema": "IWXA_G4_INSTALLED_EMPLOYEE_PUBLIC_PROOF/1",
                "publicKey": candidate["employeeProofKeyRecord"]["publicKey"],
                "employeePersonId": candidate["employeePersonId"],
                "credentialKeyId": candidate["credentialKeyId"],
                "request": request,
                "challenge": challenge,
                "proof": original,
            }, separators=(",", ":")), encoding="utf-8")
            print("G4_INSTALLED_EMPLOYEE_ORIGINAL_DPAPI_COLD_READBACK_PASS")
            print("G4_INSTALLED_EMPLOYEE_SIGNED_PROOF_CREATED_UNVERIFIED")
    finally:
        port.close()


try:
    main()
except Exception as exc:
    code = str(exc)
    print("G4_INSTALLED_EMPLOYEE_FAILURE_CODE " +
          (code if CODE.fullmatch(code) else "UNCLASSIFIED"))
    raise SystemExit(1)
