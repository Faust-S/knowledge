import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / "consumers" / "portable-plan-session.mjs"
SPEC = importlib.util.spec_from_file_location("verifier", ROOT / "consumers" / "python_cross_language_verify.py")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)
INSTRUCTION = (ROOT / "skills" / "exact-source-audit.instructions.json").read_bytes()

def call(*args):
    return subprocess.run(["node", str(ENTRY), *map(str, args)], cwd=ROOT, capture_output=True,
                          encoding="utf-8", timeout=45)

def main():
    with tempfile.TemporaryDirectory(prefix="k02-session-") as temporary:
        session = Path(temporary) / "plan.json"
        created = call("create", session)
        assert created.returncode == 0, created.stderr
        initial = VERIFIER.parse(created.stdout)
        trusted = initial["trustedDigest"]
        bundle = VERIFIER.parse(session.read_text(encoding="utf-8"))
        check = VERIFIER.verify({
            "schema": "IWXA.K02.CROSS_LANGUAGE_VECTOR/0.1.0",
            "plan": bundle["plan"],
            "descriptors": bundle["descriptors"],
            "skill": bundle["skill"],
        }, INSTRUCTION, trusted)
        assert check["verifiedSteps"] == 3 and check["verifiedSkills"] == 1
        restored = call("resume", session, trusted, *sys.argv[1:])
        assert restored.returncode == 0, restored.stderr
        output = VERIFIER.parse(restored.stdout)
        assert output["status"] == "RESTORED_NOT_AUTHORIZED"
        assert output["steps"] == 3 and output["skills"] == 1
        assert output["modelPin"] == initial["modelPin"]
        assert output["invocations"] == 0
        assert output["taskCreated"] is False and output["resultProduced"] is False
        negative = 0
        def reject(change, label, expected):
            nonlocal negative
            copied = json.loads(json.dumps(bundle))
            change(copied)
            path = Path(temporary) / (label + ".json")
            path.write_text(json.dumps(copied), encoding="utf-8")
            result = call("resume", path, trusted)
            assert result.returncode != 0, label
            assert json.loads(result.stderr)["errorCode"] == expected, label
            negative += 1
        reject(lambda x:x["plan"].update(taskId="different"),"task","INVALID_PLAN")
        reject(lambda x:x["plan"]["steps"][0].update(invocationAuthority="SELF"),"authority","INVALID_PLAN")
        reject(lambda x:x["skill"].update(status="changed"),"skill","BINDING_CHANGED")
        reject(lambda x:x["descriptors"][0].update(providerId="different"),"provider","BINDING_CHANGED")
        reject(lambda x:x["descriptors"][2]["capabilities"][0].update(providerFeeUsd=5),"price","BINDING_CHANGED")
        reject(lambda x:x["descriptors"][2]["capabilities"][0]["modelPin"].update(digest="b"*64),"model","BINDING_CHANGED")
        for args, expected in [
            ((session,"b"*64),"INVALID_PLAN"),
            ((session,trusted,"--changed-model"),"BINDING_CHANGED"),
            ((session,trusted,"--missing-model"),"PROVIDER_UNAVAILABLE"),
        ]:
            result = call("resume", *args)
            assert result.returncode != 0 and json.loads(result.stderr)["errorCode"] == expected
            negative += 1
        print(json.dumps({"status":output["status"],"planDigest":trusted,
                          "steps":output["steps"],"skills":output["skills"],
                          "negativeCases":negative,"invocations":0,
                          "mode":"NODE_SAVE_PYTHON_VERIFY_NODE_RESUME"},sort_keys=True))

if __name__ == "__main__":
    main()
