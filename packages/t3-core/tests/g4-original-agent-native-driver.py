"""Public Windows source qualification of the original T3 employee Agent.

One original signed corporate Task enters the EXISTING Personal Agent Core.
The Core invokes an observed LOCAL model, saves its immutable Result, records
an explicitly chosen source-test Human Review, and verifies the accepted
artifact. Only OriginalEmployeePort.prepare(engine,...) can create the signed
T3 disclosure. This is NOT installed native GUI or real human acceptance.
No private data, model text, Task contents or private source is printed.
"""
import json
import os
import re
import sys
from pathlib import Path

from runtime.t3_original_employee_port import OriginalEmployeePort, CorporateT3Error

phase = "OPEN"
HEX = re.compile(r"^[0-9a-f]{64}$")


def require(condition, code):
    if not condition:
        raise AssertionError(code)


def original_port():
    return OriginalEmployeePort(
        worker=Path(os.environ["PYTHONPATH"]) / "runtime" /
        "t3_original_employee_worker.mjs",
        env=os.environ.copy(),
    )


def core_config():
    root = Path(os.environ["G4_AGENT_CORE_ROOT"])
    root.mkdir(parents=True, exist_ok=True)
    path = root / "source-qualification-config.json"
    if not path.exists():
        source = Path(os.environ["PYTHONPATH"]) / "config" / "daily-driver.example.json"
        profile = json.loads(source.read_text(encoding="utf-8"))
        # Only the selected LOCAL provider changes in the existing config.
        # DEMO_REPLAY_V1 is not a local model and is forbidden by the signed
        # corporate WorkArea. Do not mark demo output as accepted inference.
        profile["slots"]["model"]["active_provider"] = "OLLAMA_LOCAL_V1"
        profile["instance_root"] = str(root / "instance")
        profile["defaults"]["max_output_tokens"] = 512
        profile["defaults"]["max_output_words"] = 256
        with path.open("x", encoding="utf-8") as out:
            json.dump(profile, out, ensure_ascii=False, sort_keys=True)
    saved = json.loads(path.read_text(encoding="utf-8"))
    require(saved["slots"]["model"]["active_provider"] == "OLLAMA_LOCAL_V1",
            "G4_AGENT_MODEL_BINDING_CHANGED")
    require(Path(saved["instance_root"]).resolve() == (root / "instance").resolve(),
            "G4_AGENT_CORE_ROOT_CHANGED")
    return path


def open_verified_core():
    from runtime.daily_driver_engine import DailyDriverEngine

    engine = DailyDriverEngine(core_config())
    endpoint = os.environ["G4_AGENT_OLLAMA_BASE_URL"]
    model = os.environ["G4_AGENT_OLLAMA_MODEL"]
    # Source test uses one bounded on-machine Ollama endpoint. Never permit
    # a remote provider, a local HTTP proxy, or automatic fallback.
    require(endpoint == "http://127.0.0.1:11434",
            "G4_AGENT_LOCAL_MODEL_ENDPOINT_REQUIRED")
    require(model == "qwen3:0.6b",
            "G4_AGENT_REAL_LOCAL_MODEL_REQUIRED")
    if engine.local_ai.selection.get("source_confirmed") is not True:
        engine.local_ai_connect_source("USER_LOOPBACK_ENDPOINT",
                                       endpoint=endpoint, confirmed=True)
    status = engine.local_ai.status()
    rows = [row for row in status.get("local_models", [])
            if row.get("name") == model and HEX.fullmatch(str(row.get("digest", "")))]
    require(len(rows) == 1 and status.get("daemon_ready") is True,
            "G4_AGENT_OBSERVED_LOCAL_WEIGHTS_REQUIRED")
    digest = rows[0]["digest"]
    if (engine.local_ai.selection.get("name") != model or
            engine.local_ai.selection.get("digest") != digest):
        engine.local_ai_select_model(name=model, digest=digest,
                                     mode="USER_SELECTED_LOCAL", confirmed=True)
    ready = engine.local_ai.status()
    require(ready.get("ready_for_activation") is True and
            ready.get("selected_model") == model and
            ready.get("selected_identity_matches") is True,
            "G4_AGENT_REAL_MODEL_ACTIVATION_REQUIRED")
    require(engine.registry.current_binding("model")["provider_id"] ==
            "OLLAMA_LOCAL_V1", "G4_AGENT_MODEL_PROVIDER_CHANGED")
    return engine


try:
    require("T3_READ_TOKEN" not in os.environ, "TOKEN_NOT_ISOLATED")
    require("AGENT_READ_TOKEN" not in os.environ, "TOKEN_NOT_ISOLATED")
    employee_root = os.environ["G4_CONTROL_ROOT"]
    invite = os.environ["G4_INVITE_PATH"]
    task_path = os.environ["G4_TASK_PATH"]
    result_path = os.environ["G4_RESULT_PATH"]

    port = original_port()
    try:
        phase = "CONNECT"
        require(port.call("connect", {"root": employee_root}).get("context") ==
                "PERSONAL", "PERSONAL_REQUIRED")
        phase = "ORIGINAL_SIGNED_INVITE"
        port.call("import_invite", {"path": invite}, consequential=True)
        port.call("select", {"context": "ORGANIZATION"})
        phase = "ORIGINAL_SIGNED_TASK_RECEIVE"
        received = port.call("receive_task", {"path": task_path}, consequential=True)
        phase = "ORIGINAL_SIGNED_TASK_READ"
        original = port.task()
        require(received.get("taskRevisionId") == original.get("taskRevisionId"),
                "TASK_REVISION_REQUIRED")
        require(original.get("taskId", "").startswith("task:"),
                "SIGNED_TASK_REQUIRED")

        if os.environ.get("G4_SOURCE_EXPECT_NO_KERNEL") == "1":
            # Legacy signed TEST carrier has no original T2 Host. The
            # released 0.6.2 must refuse actual Task execution here rather
            # than accepting a synthetic company Workspace.
            phase = "ORIGINAL_SIGNED_NO_KERNEL_MUST_REFUSE"
            require(port.status().get("originalCompanyWorkspaceAuthority")
                    != "ORIGINAL_T2_KERNEL_ATTACHED",
                    "G4_SOURCE_LEGACY_TEST_UNEXPECTED_KERNEL_AUTHORITY")
            try:
                port.submit(object())
            except CorporateT3Error as error:
                require(str(error) ==
                        "T3_COMPANY_ORIGINAL_T2_KERNEL_NOT_ATTACHED",
                        "G4_SOURCE_MISSING_KERNEL_DENIAL_CHANGED")
            else:
                raise AssertionError("G4_SOURCE_MISSING_KERNEL_ADMITTED_TASK")
            print("G4_AGENT_ORIGINAL_KERNEL_MISSING_REFUSAL_PASS")
            sys.exit(0)

        phase = "AGENT_CORE_REAL_LOCAL_MODEL_READY"
        engine = open_verified_core()
        phase = "AGENT_CORE_SIGNED_TASK_ADMISSION"
        admitted = port.submit(engine)
        task_id = admitted.get("task_id")
        require(admitted.get("accepted") is True and
                isinstance(task_id, str) and task_id.startswith("TASK-"),
                "G4_AGENT_ORIGINAL_TASK_ADMISSION_UNCONFIRMED")
        require(port.recover_agent_task(engine).get("agentTaskId") == task_id,
                "G4_AGENT_ORIGINAL_TASK_CORE_BINDING_CHANGED")

        phase = "AGENT_CORE_REAL_LOCAL_INFERENCE"
        runs = engine.automation_run_due(limit=1)
        require(isinstance(runs, dict) and runs.get("claimed") == 1 and
                any(row.get("status") == "SUCCEEDED"
                    for row in runs.get("results", [])),
                "G4_AGENT_REAL_MODEL_EXECUTION_REQUIRED")
        detail = engine.task_detail(task_id)
        require(detail.get("status") == "result_imported" and
                detail.get("provider", {}).get("id") == "OLLAMA_LOCAL_V1" and
                detail.get("provider", {}).get("model") == "qwen3:0.6b" and
                bool(detail.get("summary", "").strip()) and
                detail.get("performed_external_actions") is False,
                "G4_AGENT_REAL_MODEL_RESULT_UNVERIFIED")
        phase = "AGENT_CORE_HUMAN_REVIEW_SOURCE_TEST"
        # Explicit test-selected decision on the saved model Result. This is
        # a SOURCE harness choice, NEVER a claim of a native UI human click.
        engine.review(task_id, "approve")
        reviewed = engine.task_detail(task_id)
        require(reviewed.get("status") == "closed" and
                reviewed.get("review_decision", {}).get("decision") ==
                "approve_draft" and
                HEX.fullmatch(str(reviewed.get("accepted_artifact_digest", ""))),
                "G4_AGENT_HUMAN_REVIEW_CORE_READBACK_REQUIRED")

        phase = "AGENT_ACCEPTED_RESULT_PROJECTION"
        selection = {"summary": True, "claims": [], "uncertainties": [],
                     "draft_artifacts": [], "evidence_refs": False}
        projected = port.accepted_projection(engine, task_id, selection)
        require(projected.get("status") == "PREVIEW_ONLY" and
                projected.get("t3_signed") is False and
                projected.get("exported") is False,
                "G4_AGENT_ACCEPTED_CORE_PROJECTION_UNVERIFIED")
        prepared = port.prepare(engine, task_id, selection)
        require(prepared.get("state") == "RESULT_PREPARED" and
                prepared.get("sourceAgentTaskId") == task_id and
                prepared.get("sourceAgentResultId") == projected["result_id"] and
                HEX.fullmatch(str(prepared.get("sourceAcceptedDigest", ""))) and
                HEX.fullmatch(str(prepared.get("sourceResultSha256", ""))),
                "G4_AGENT_ACCEPTED_CORE_ORIGIN_CHANGED")
        phase = "ORIGINAL_SIGNED_RESULT_PREVIEW"
        preview = port.call("preview")
        require(preview.get("state") == "HUMAN_REVIEW_REQUIRED" and
                preview.get("signed") is False, "HUMAN_PREVIEW_REQUIRED")
        phase = "ORIGINAL_SIGNED_RESULT"
        saved = port.call("export", {
            "path": result_path, "previewDigest": preview["previewDigest"],
            "confirmed": True,
        }, consequential=True)
        require(saved.get("signed") is True and saved.get("exported") is True,
                "SIGNATURE_REQUIRED")
        require(saved.get("taskRevisionId") == original["taskRevisionId"],
                "RESULT_TASK_BINDING_INVALID")
    finally:
        port.close()

    phase = "ORIGINAL_EMPLOYEE_COLD_RESTART"
    # Cold Core object and original worker. There is no inference or new
    # Human Review during this readback. Installed process-cold still HOLD.
    cold_engine = open_verified_core()
    cold = original_port()
    try:
        cold.call("connect", {"root": employee_root})
        cold.call("select", {"context": "ORGANIZATION"})
        cold.call("select_task", {"taskId": original["taskId"]})
        require(cold.task()["taskRevisionId"] == original["taskRevisionId"],
                "COLD_TASK_MISMATCH")
        require(cold.recover_agent_task(cold_engine)["agentTaskId"] == task_id,
                "G4_AGENT_ACCEPTED_TASK_COLD_READBACK_REQUIRED")
        try:
            cold.prepare(cold_engine, task_id, selection)
        except CorporateT3Error as error:
            require(str(error) == "T3_PRIOR_RESULT_EXPORT_RECONCILIATION_REQUIRED",
                    "COLD_REEXPORT_DENIAL_WRONG_REASON")
        else:
            raise AssertionError("COLD_REEXPORT_NOT_BLOCKED")
    finally:
        cold.close()

    print("G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_TASK_PASS")
    print("G4_ORIGINAL_NATIVE_EMPLOYEE_SIGNED_RESULT_PASS")
    print("G4_ORIGINAL_NATIVE_EMPLOYEE_COLD_NO_REEXPORT_PASS")
    print("G4_ORIGINAL_AGENT_CORE_REAL_LOCAL_MODEL_SOURCE_PASS")
    print("G4_ORIGINAL_AGENT_CORE_ACCEPTED_RESULT_PROOF_SOURCE_PASS")
except Exception as error:
    print("G4_NATIVE_FAILURE_PHASE", phase)
    message = str(error).strip()
    machine = re.fullmatch(r"[A-Z][A-Z0-9_]{2,119}", message)
    embedded = re.search(
        r"(?<![A-Z0-9_])(?:T3|INTEROP|WINDOWS|G4)_[A-Z0-9_]{3,110}(?![A-Z0-9_])",
        message)
    code = machine.group(0) if machine else (
        embedded.group(0) if embedded else "UNCLASSIFIED")
    print("G4_NATIVE_FAILURE_CODE", code)
    print("G4_NATIVE_FAILURE_CODE_SHAPE",
          "CANONICAL" if machine else
          "EMBEDDED_MACHINE_CODE" if embedded else
          "EMPTY" if not message else "NONCANONICAL_TEXT")
    permitted = {"KeyError", "TypeError", "ValueError", "AssertionError",
                 "CorporateT3Error", "OSError", "TimeoutError",
                 "AttributeError", "RuntimeError", "IndexError"}
    print("G4_NATIVE_FAILURE_CLASS",
          type(error).__name__ if type(error).__name__ in permitted
          else "UNCLASSIFIED")
    raise SystemExit(1)
