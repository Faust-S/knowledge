import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / "consumers" / "agent-port-vector.mjs"
REVIEW = ROOT / "consumers" / "python_cross_language_verify.py"
spec = importlib.util.spec_from_file_location("k02_python_verifier", REVIEW)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HEX64 = re.compile(r"^[a-f0-9]{64}$")
NATIVE_MODEL_PROVIDERS = {"OLLAMA_LOCAL_V1", "IWXA_BASIC_RUNTIME_V1"}
MODEL_PORT = "PA.PORT.MODEL_PROVIDER"
TOOL_PORT = "PA.PORT.TOOL_PROVIDER"


def insist(flag, label):
    if not flag:
        raise ValueError(label)


def keys(obj, expected, label):
    insist(type(obj) is dict and set(obj) == set(expected), label + "_shape")


def digest(value):
    insist(type(value) is str and HEX64.fullmatch(value) is not None, "digest_invalid")


def validate_draft_header(draft, expected_port, plan):
    keys(draft, ["schema", "contractVersion", "bindingVersion", "status",
                 "targetPort", "selected", "nativeBindingVerified",
                 "hostAuthorityGranted", "resultProduced", "portRequest"], "handoff")
    insist(draft["schema"] == "IWXA.K02.AGENT_PORT_HANDOFF/0.1.0", "handoff_schema")
    insist(draft["contractVersion"] == "IWXA.K02.INTEROP/0.1.0", "handoff_contract")
    insist(draft["bindingVersion"] == "IWXA.K02.PLAN_BINDING/0.1.0", "handoff_binding")
    insist(draft["status"] == "REQUEST_DRAFT_NOT_AUTHORIZED", "handoff_status")
    insist(draft["nativeBindingVerified"] is False and
           draft["hostAuthorityGranted"] is False and
           draft["resultProduced"] is False, "authority_misrepresented")
    keys(draft["targetPort"], ["contractId", "contractVersion"], "target_port")
    insist(draft["targetPort"]["contractId"] == expected_port, "target_port_id")
    insist(draft["targetPort"]["contractVersion"] == "1.0.0", "target_port_version")
    selected = draft["selected"]
    keys(selected, ["requirementId", "providerId", "capabilityId",
                    "capabilityDigest", "k02PlanDigest"], "selected")
    digest(selected["capabilityDigest"])
    insist(selected["k02PlanDigest"] == plan["planDigest"], "selected_plan_digest")
    matches = [s for s in plan["steps"]
               if s["requirementId"] == selected["requirementId"]]
    insist(len(matches) == 1, "selected_requirement")
    step = matches[0]
    for field in ["providerId", "capabilityId", "capabilityDigest"]:
        insist(selected[field] == step[field], "selected_" + field)
    insist(step["kind"] == ("model" if expected_port == MODEL_PORT else "tool"),
           "selected_kind")
    return step


def validate_model(draft, plan, expected_input, expected_digest):
    step = validate_draft_header(draft, MODEL_PORT, plan)
    insist(step["effectClass"] == "MODEL_INFERENCE", "model_effect")
    request = draft["portRequest"]
    keys(request, ["logical_provider_id", "binding_ref", "payload", "request_id"],
         "model_request")
    logical = request["logical_provider_id"]
    insist(logical in NATIVE_MODEL_PROVIDERS, "native_model_provider")
    keys(request["binding_ref"], ["slot_id", "provider_id", "binding_digest"],
         "model_binding")
    binding = request["binding_ref"]
    insist(binding["slot_id"] == "model" and binding["provider_id"] == logical,
           "model_slot")
    digest(binding["binding_digest"])
    insist(binding["binding_digest"] not in
           (plan["planDigest"], step["capabilityDigest"]), "model_digest_reused")
    insist(type(request["request_id"]) is str and bool(request["request_id"]),
           "model_request_id")
    payload = request["payload"]
    keys(payload, ["system", "prompt", "max_output_tokens", "local_model"],
         "model_payload")
    insist(type(payload["system"]) is str and type(payload["prompt"]) is str,
           "model_prompt_type")
    insist(type(payload["max_output_tokens"]) is int and
           1 <= payload["max_output_tokens"] <= 65536, "max_output_tokens")
    for key in ["system", "prompt", "max_output_tokens"]:
        insist(payload[key] == expected_input[key], "model_input_changed")
    keys(payload["local_model"], ["name", "digest"], "local_model")
    insist(payload["local_model"]["name"] == "smollm2:135m-instruct-q2_K",
           "model_name_changed")
    insist(payload["local_model"]["digest"] == expected_digest,
           "model_pin_changed")
    return True


def validate_tool(draft, plan, expected_input):
    step = validate_draft_header(draft, TOOL_PORT, plan)
    request = draft["portRequest"]
    keys(request, ["logical_provider_id", "tool_descriptor_ref", "operation",
                   "target", "arguments", "idempotency_key_or_none",
                   "request_id", "tool_plan_digest_or_none"], "tool_request")
    insist(type(request["logical_provider_id"]) is str and
           bool(request["logical_provider_id"]), "tool_provider")
    desc = request["tool_descriptor_ref"]
    keys(desc, ["tool_id", "descriptor_digest", "provider_slot",
                "provider_binding_digest"], "tool_binding")
    insist(desc["tool_id"] == step["capabilityId"] ==
           request["operation"], "tool_operation")
    insist(type(desc["provider_slot"]) is str and bool(desc["provider_slot"]),
           "tool_slot")
    digest(desc["descriptor_digest"])
    digest(desc["provider_binding_digest"])
    for value in (desc["descriptor_digest"], desc["provider_binding_digest"]):
        insist(value not in (plan["planDigest"], step["capabilityDigest"]),
               "tool_digest_reused")
    insist(request["target"] is None and
           request["idempotency_key_or_none"] is None, "tool_target_or_idempotency")
    insist(request["arguments"] == expected_input, "tool_arguments_changed")
    insist(type(request["arguments"]) is dict, "tool_arguments_type")
    insist(type(request["request_id"]) is str and
           bool(request["request_id"]), "tool_request_id")
    native = request["tool_plan_digest_or_none"]
    if native is not None:
        digest(native)
        insist(native not in (plan["planDigest"], step["capabilityDigest"]),
               "native_tool_plan_reused")
    return True


def reject(vector, mutator, title, trusted_digest, instructions):
    changed = copy.deepcopy(vector)
    mutator(changed)
    try:
        verify(changed, trusted_digest, instructions)
    except (ValueError, KeyError, TypeError, IndexError):
        return
    raise AssertionError("mutated_handoff_accepted:" + title)


def verify(vector, trusted_digest, instructions):
    keys(vector, ["schema", "mode", "plan", "descriptors", "skill",
                  "modelInput", "toolInput", "modelDraft", "toolDraft"], "vector")
    insist(vector["schema"] == "IWXA.K02.AGENT_PORT_VECTOR/0.1.0",
           "vector_schema")
    insist(vector["mode"] in ("SYNTHETIC_MODEL_DESCRIPTOR",
                             "LIVE_OLLAMA_PROBED_NOT_INVOKED"), "vector_mode")
    # Use the independent Python implementation for source-plan capability and
    # Skill verification; it does not execute any native Agent port.
    result = module.verify(
        {key: vector[key] for key in ("plan", "descriptors", "skill")} |
        {"schema": "IWXA.K02.CROSS_LANGUAGE_VECTOR/0.1.0"},
        instructions, trusted_digest)
    insist(result["status"] == "MATCHED_NOT_AUTHORIZED", "plan_status")
    insist(result["verifiedSteps"] == 2 and result["verifiedSkills"] == 1,
           "plan_counts")
    model = vector["modelDraft"]
    tool = vector["toolDraft"]
    insist(model["selected"]["requirementId"] !=
           tool["selected"]["requirementId"], "duplicate_draft_requirement")
    validate_model(model, vector["plan"], vector["modelInput"],
                   "888e2e49aff1c1ff0c073a0c46afa26f54f4fad02f31bb5ad911b0124830852b")
    validate_tool(tool, vector["plan"], vector["toolInput"])
    return {"status": "MATCHED_NOT_AUTHORIZED", "verifiedSteps": 2,
            "verifiedSkills": 1, "verifiedPortDrafts": 2,
            "planDigest": trusted_digest, "mode": vector["mode"]}


def main():
    cmd = ["node", str(NODE)]
    if len(sys.argv) > 1 and sys.argv[1] == "--live":
        cmd.append("--live")
    output = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                            cwd=ROOT, check=True, timeout=20)
    vector = module.parse(output.stdout)
    trusted = vector["plan"]["planDigest"]
    instructions = (ROOT / "skills" /
                    "exact-source-audit.instructions.json").read_bytes()
    result = verify(vector, trusted, instructions)

    cases = [
        ("forged_approval", lambda v: v["modelDraft"].update(hostAuthorityGranted=True)),
        ("forged_result", lambda v: v["toolDraft"].update(resultProduced=True)),
        ("native_verified", lambda v: v["toolDraft"].update(nativeBindingVerified=True)),
        ("port_version", lambda v: v["modelDraft"]["targetPort"].update(contractVersion="9.0.0")),
        ("model_pin", lambda v: v["modelDraft"]["portRequest"]["payload"]["local_model"].update(digest="f"*64)),
        ("model_binding", lambda v: v["modelDraft"]["portRequest"]["binding_ref"].update(binding_digest=v["plan"]["planDigest"])),
        ("tool_descriptor", lambda v: v["toolDraft"]["portRequest"]["tool_descriptor_ref"].update(descriptor_digest=v["plan"]["planDigest"])),
        ("tool_plan", lambda v: v["toolDraft"]["portRequest"].update(tool_plan_digest_or_none=v["plan"]["planDigest"])),
        ("tool_operation", lambda v: v["toolDraft"]["portRequest"].update(operation="another.tool")),
        ("model_provider", lambda v: v["modelDraft"]["portRequest"].update(logical_provider_id="REMOTE_MODEL")),
        ("tool_arguments", lambda v: v["toolDraft"]["portRequest"]["arguments"].update(extra="evil")),
        ("selected_capability", lambda v: v["modelDraft"]["selected"].update(capabilityDigest="0"*64)),
        ("plan_tamper", lambda v: v["plan"].update(taskId="DIFFERENT_TASK")),
        ("false_invoke", lambda v: v["plan"]["steps"][0].update(invocationState="DONE")),
    ]
    for label, mutate in cases:
        reject(vector, mutate, label, trusted, instructions)
    try:
        module.parse('{"plan":1,"plan":2}')
    except ValueError:
        pass
    else:
        raise AssertionError("duplicate_keys_accepted")
    print(json.dumps({
        **result, "negativeCases": len(cases) + 1,
        "modelInvoked": False, "taskCreated": False,
        "nativePortInvoked": False,
        "conformance": "NODE_TO_PYTHON_PORT_REQUEST_DRAFT_NOT_AGENT_EXECUTION",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
