import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
VECTOR = ROOT / "consumers" / "cross_language_vector.mjs"
INSTRUCTION = ROOT / "skills" / "exact-source-audit.instructions.json"
CONTRACT = "IWXA.K02.INTEROP/0.1.0"
BINDING = "IWXA.K02.PLAN_BINDING/0.1.0"
HEX64 = re.compile(r"^[a-f0-9]{64}$")


def unique_pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate_json_key")
        out[key] = value
    return out


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_pairs,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError("nonfinite")))


def canonical(value):
    if value is None or type(value) in (str, bool, int):
        pass
    elif type(value) is float:
        if not (-float("inf") < value < float("inf")):
            raise ValueError("nonfinite")
    elif type(value) is list:
        for item in value:
            canonical(item)
    elif type(value) is dict:
        for key in value:
            if not isinstance(key, str):
                raise ValueError("non_string_key")
            canonical(value[key])
    else:
        raise ValueError("non_json_value")
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def check(flag, label):
    if not flag:
        raise ValueError(label)


def verify(vector, instruction_bytes, trusted_digest):
    check(type(vector) is dict and set(vector) == {"schema", "plan", "descriptors", "skill"}, "vector_shape")
    check(vector["schema"] == "IWXA.K02.CROSS_LANGUAGE_VECTOR/0.1.0", "vector_schema")
    plan = vector["plan"]
    check(type(plan) is dict, "plan_type")
    check(plan.get("contractVersion") == CONTRACT and plan.get("bindingVersion") == BINDING, "contract_version")
    check(type(trusted_digest) is str and HEX64.fullmatch(trusted_digest) is not None, "trusted_digest_type")
    check(plan.get("planDigest") == trusted_digest, "trusted_digest_mismatch")
    body = dict(plan)
    body.pop("planDigest", None)
    check(digest(body) == trusted_digest, "plan_digest_mismatch")
    check(type(plan.get("steps")) is list and type(plan.get("skills")) is list, "plan_entries")

    providers = {}
    for desc in vector["descriptors"]:
        check(type(desc) is dict and desc.get("contractVersion") == CONTRACT, "descriptor_contract")
        pid = desc["providerId"]
        check(type(pid) is str and pid not in providers, "duplicate_provider")
        check(desc.get("availability") == "available", "provider_unavailable")
        providers[pid] = desc

    ids = set()
    for step in plan["steps"]:
        check(type(step) is dict, "step_type")
        ident = step.get("requirementId")
        check(type(ident) is str and ident not in ids, "duplicate_requirement")
        ids.add(ident)
        check(step.get("hostApprovalRequired") is True and step.get("invocationAuthority") == "HOST_ONLY"
              and step.get("invocationState") == "NOT_INVOKED" and step.get("proofOfInvoke") is None,
              "not_a_host_only_plan")
        pid = step.get("providerId")
        check(pid in providers, "provider_missing")
        cap = next((cap for cap in providers[pid]["capabilities"]
                    if cap["kind"] == step["kind"] and cap["capabilityId"] == step["capabilityId"]), None)
        check(cap is not None and cap.get("supported") is True, "capability_unsupported")
        check(cap["effectClass"] == step["effectClass"], "effect_changed")
        if step["kind"] == "model":
            check(cap.get("modelPin") == step.get("modelPin"), "model_pin_changed")
            if "modelPin" in step:
                pin = step["modelPin"]
                check(type(pin) is dict and set(pin) == {"name", "digest"}, "model_pin_shape")
                check(type(pin["name"]) is str, "model_name_type")
                check(type(pin["digest"]) is str and HEX64.fullmatch(pin["digest"]), "model_pin_digest")
            check(type(cap.get("inputModes")) is list and
                  type(cap.get("outputModes")) is list, "model_modes_missing")

        check(canonical(cap["inputSchema"]) == canonical(step["inputSchema"]), "input_schema_changed")
        check(canonical(cap["outputSchema"]) == canonical(step["outputSchema"]), "output_schema_changed")
        bound = {"contractVersion": CONTRACT, "providerId": pid, "capability": cap}
        check(step.get("capabilityDigest") == digest(bound), "capability_digest_mismatch")

    skill = vector["skill"]
    check(type(skill) is dict and skill.get("schema") == "IWXA.K02.SKILL/0.1.0", "skill_schema")
    selected = next((s for s in plan["skills"] if s["skillId"] == skill["skillId"]), None)
    check(selected is not None, "skill_not_selected")
    check(selected["descriptorDigest"] == digest(skill), "skill_descriptor_changed")
    check(selected["instructionRef"] == skill["instructionRef"], "skill_ref_changed")
    check(selected["instructionDigest"] == skill["instructionDigest"], "skill_digest_changed")
    check(hashlib.sha256(instruction_bytes).hexdigest() == selected["instructionDigest"], "skill_bytes_changed")
    return {"status": "MATCHED_NOT_AUTHORIZED", "planDigest": trusted_digest,
            "verifiedSteps": len(ids), "verifiedSkills": 1, "contractVersion": CONTRACT}


def expect_reject(base, instruction_bytes, trusted, mutate, label):
    vector = copy.deepcopy(base)
    mutate(vector)
    try:
        verify(vector, instruction_bytes, trusted)
    except (ValueError, KeyError, TypeError, IndexError):
        return
    raise AssertionError("accepted_mutation:" + label)


def main():
    run = subprocess.run(["node", str(VECTOR)], cwd=ROOT, capture_output=True,
                         text=True, encoding="utf-8", timeout=30, check=True)
    vector = parse(run.stdout)
    trusted = vector["plan"]["planDigest"]  # in production this MUST come from the owning host, not a received vector
    instruction = INSTRUCTION.read_bytes()
    receipt = verify(vector, instruction, trusted)
    expect_reject(vector, instruction, trusted,
                  lambda v: v["plan"].update(taskId="CHANGED"), "plan_tamper")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["descriptors"][0].update(providerId="substitute"), "provider_swap")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["descriptors"][0]["capabilities"][0].update(providerFeeUsd=12), "cost_change")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["descriptors"][0]["capabilities"][0].update(supported=False), "unsupported")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["skill"].update(status="CHANGED"), "skill_descriptor_change")
    expect_reject(vector, bytes([instruction[0] ^ 1]) + instruction[1:], trusted,
                  lambda v: None, "instruction_bytes_change")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["plan"]["steps"][0].update(invocationAuthority="SELF"), "authority_changed")
    expect_reject(vector, instruction, trusted,
                  lambda v: v["plan"]["steps"][0].update(proofOfInvoke={"faked": True}), "fake_proof")
    try:
        parse('{"x":1,"x":2}')
    except ValueError:
        pass
    else:
        raise AssertionError("duplicate_json_key_accepted")
    print(json.dumps({**receipt, "negativeCases": 9,
                      "runtime": "INDEPENDENT_PYTHON_CONSUMER_NOT_EXECUTION",
                      "modelInvoked": False, "taskCreated": False}, sort_keys=True))


if __name__ == "__main__":
    main()
