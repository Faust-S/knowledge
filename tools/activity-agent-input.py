"""Translate an existing approved U01 temporary source file to fixed Activity stdin.
No Task/Store, installer, program discovery, shell, arbitrary operation or export.
The Agent owner MUST verify the source belongs to the accepted Task and plan
before constructing the temporary file. This bridge does not grant that right.
"""
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import json
import os
import re
import runpy
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
INPUT_LIMIT = 8 * 1024 * 1024
OUTPUT_LIMIT = 4 * 1024 * 1024  # Original Agent U01 owner ceiling.
WORKER_TIMEOUT = 18  # Original U01 outer timeout is 20 seconds.
# Runtime, original local entry point, fixed worker flags.
OPERATIONS = {
    "contextual_generalization_request": ("node", "activity-technology-product.mjs", ("--contextual-generalization-request",)),
    "contextual_generalization_review": ("node", "activity-technology-product.mjs", ("--contextual-generalization-review",)),
    "contextual_generalization_plan": ("node", "activity-technology-product.mjs", ("--contextual-generalization-plan",)),
    "contextual_generalization_plan_review": ("node", "activity-technology-product.mjs", ("--contextual-generalization-plan-review",)),
    "personal_extraction_request": ("node", "activity-technology-product.mjs", ("--personal-extraction-request",)),
    "personal_extraction_review": ("node", "activity-technology-product.mjs", ("--personal-extraction-review",)),
    "personal_routine_group": ("node", "activity-technology-product.mjs", ("--personal-group",)),
    "personal_product_prepare": ("node", "activity-technology-product.mjs", ("--personal-product",)),
    "d05_product_prepare": ("node", "activity-technology-product.mjs", ("--d05-product",)),
    "personal_recipient_prepare": ("node", "activity-technology-product.mjs", ("--personal-recipient",)),
    "d05_recipient_prepare": ("node", "activity-technology-product.mjs", ("--d05-recipient",)),
    "route_compare": ("node", "activity-d05-route-review.mjs", ()),
    "technology_draft": ("node", "activity-d05-route-review.mjs", ("--technology-draft",)),
    "technology_proposal": ("node", "activity-d05-route-review.mjs", ("--technology-proposal",)),
    "disclosure_candidate": ("node", "activity-d05-route-review.mjs", ("--disclosure-candidate",)),
    "presidio_en_product": ("python", "activity-presidio-scan.py", ("--language", "en", "--product")),
    "presidio_ru_product": ("python", "activity-presidio-scan.py", ("--language", "ru", "--product")),
    "presidio_en": ("python", "activity-presidio-scan.py", ("--language", "en")),
    "presidio_ru": ("python", "activity-presidio-scan.py", ("--language", "ru")),
    "observation_prepare": ("node", "activity-observation-request.mjs", ("--prepare",)),
    "observation_review": ("node", "activity-observation-request.mjs", ("--review",)),
    "arx_review": ("python", "activity-observation-review.py", ("--arx",)),
    "opendp_preview": ("python", "activity-observation-review.py", ("--opendp",)),
    "simpy_compare": ("python", "activity-d05-simpy.py", ()),
    "simpy_review": ("node", "activity-d05-simpy-review.mjs", ()),
}


class Hold(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Hold(code)


def token(operation):
    return "iwxa-activity-" + operation.replace("_", "-") + "-v1"


def command(operation):
    need(operation in OPERATIONS, "ACTIVITY_BRIDGE_OPERATION_INVALID")
    runtime, script, flags = OPERATIONS[operation]
    worker = ROOT / script
    need(worker.is_file() and not worker.is_symlink(), "ACTIVITY_BRIDGE_PROFILE_MISSING")
    if runtime == "python":
        executable = Path(sys.executable).resolve()
        return [str(executable), "-I", str(worker), *flags]
    configured = os.environ.get("IWXA_ACTIVITY_NODE")
    node = configured or shutil.which("node")
    need(node and Path(node).is_file(), "ACTIVITY_BRIDGE_NODE_REQUIRED")
    p = subprocess.run([node, "--version"], capture_output=True, timeout=3, check=False)
    need(p.returncode == 0 and re.fullmatch(rb"v(?:2[2-9]|[3-9][0-9])\.\d+\.\d+\s*", p.stdout),
         "ACTIVITY_BRIDGE_NODE_REQUIRED")
    return [str(Path(node).resolve()), str(worker), *flags]


def probe(operation):
    cmd = command(operation)
    if operation.startswith("presidio_"):
        source = runpy.run_path(str(ROOT / "activity-presidio-scan.py"))
        language = operation.split("_")[1]
        model, model_version = source["MODELS"][language]
        need(version("presidio-analyzer") == source["VERSION"] and version(model) == model_version and
             version("spacy").startswith("3.8."), "ACTIVITY_BRIDGE_PROFILE_MISSING")
    elif operation == "opendp_preview":
        source = runpy.run_path(str(ROOT / "activity-observation-review.py"))
        need(version("opendp") == source["DP_VERSION"], "ACTIVITY_BRIDGE_PROFILE_MISSING")
    elif operation == "arx_review":
        source = runpy.run_path(str(ROOT / "activity-observation-review.py"))
        jar = os.environ.get("IWXA_ACTIVITY_ARX_JAR")
        java = os.environ.get("IWXA_ACTIVITY_JAVA") or shutil.which("java")
        need(jar and java and Path(jar).is_file() and Path(java).is_file(), "ACTIVITY_BRIDGE_PROFILE_MISSING")
        path = Path(jar)
        need(path.stat().st_size <= 200 * 1024 * 1024, "ACTIVITY_BRIDGE_PROFILE_MISSING")
        need(sha256(path.read_bytes()).hexdigest() == source["ARX_SHA256"], "ACTIVITY_BRIDGE_PROFILE_MISSING")
        p = subprocess.run([java, "-version"], capture_output=True, timeout=3, check=False)
        major = source["java_major"]((p.stdout+p.stderr).decode("utf-8", errors="replace"))
        need(p.returncode == 0 and major >= 21, "ACTIVITY_BRIDGE_PROFILE_MISSING")
    elif operation == "simpy_compare":
        source = runpy.run_path(str(ROOT / "activity-d05-simpy.py"))
        need(version("simpy") == source["VERSION"], "ACTIVITY_BRIDGE_PROFILE_MISSING")
    return token(operation)


def read_verified_temp(path, expected):
    need(type(expected) is str and re.fullmatch(r"[0-9a-f]{64}", expected), "ACTIVITY_BRIDGE_DIGEST_INVALID")
    source = Path(path)
    # The original Agent adapter constructs this path; never take it directly
    # from a user's Task parameters. The digest binds the bytes, not authority.
    need(source.is_absolute() and source.name == "input.json" and
         source.parent.name.startswith("iwxa-activity-") and not source.is_symlink() and
         not source.parent.is_symlink() and source.is_file(), "ACTIVITY_BRIDGE_SOURCE_INVALID")
    with source.open("rb") as stream:
        payload = stream.read(INPUT_LIMIT + 1)
    need(0 < len(payload) <= INPUT_LIMIT, "ACTIVITY_BRIDGE_INPUT_LIMIT")
    need(sha256(payload).hexdigest() == expected, "ACTIVITY_BRIDGE_SOURCE_CHANGED")
    return payload


def run(operation, path, expected):
    payload = read_verified_temp(path, expected)
    cmd = command(operation)
    result = subprocess.run(cmd, input=payload, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=WORKER_TIMEOUT, check=False)
    need(len(result.stdout) <= OUTPUT_LIMIT, "ACTIVITY_BRIDGE_OUTPUT_LIMIT")
    try:
        value = json.loads(result.stdout.decode("utf-8"))
    except (ValueError, UnicodeError):
        raise Hold("ACTIVITY_BRIDGE_WORKER_RESULT_INVALID")
    need(type(value) is dict and value.get("export_allowed", False) is False and
         value.get("iwxa_package") is None, "ACTIVITY_BRIDGE_WORKER_RESULT_INVALID")
    if result.returncode != 0:
        need(result.returncode == 2 and value.get("status") == "HOLD" and
             type(value.get("code")) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{1,100}", value["code"]),
             "ACTIVITY_BRIDGE_WORKER_FAILED")
        # Keep the actual HOLD exit code. U01 must not mark it executed.
        return 2, result.stdout
    need(value.get("status") != "HOLD", "ACTIVITY_BRIDGE_WORKER_RESULT_INVALID")
    # Forward byte-for-byte, including trailing LF; downstream digests depend on it.
    return 0, result.stdout


def main():
    try:
        args = sys.argv[1:]
        if len(args) == 2 and args[0] == "--probe":
            sys.stdout.write(probe(args[1]) + "\n")
            return 0
        need(len(args) == 4 and args[0] == "--run" and args[1] in OPERATIONS,
             "ACTIVITY_BRIDGE_ARGUMENTS_INVALID")
        code, output = run(args[1], args[2], args[3])
        sys.stdout.buffer.write(output)
        return code
    except Hold as exc:
        code = str(exc)
    except subprocess.TimeoutExpired:
        code = "ACTIVITY_BRIDGE_TIMEOUT"
    except (ImportError, ModuleNotFoundError):
        code = "ACTIVITY_BRIDGE_PROFILE_MISSING"
    except Exception:
        code = "ACTIVITY_BRIDGE_LOCAL_FAILURE"
    sys.stdout.write(json.dumps({"status": "HOLD", "code": code, "anonymity": "NOT_ESTABLISHED",
                                 "export_allowed": False, "iwxa_package": None}) + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
