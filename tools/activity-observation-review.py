"""Local Activity worker for existing Agent program invocation.
ARX: evaluate a declared cohort with approved hierarchy bounds, no row export.
OpenDP: single aggregate preview, not a published release or budget ledger.
Neither operation receives or changes the normative technology.
"""
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import json
import math
import os
import re
import shutil
import subprocess
import sys

LIMIT = 8 * 1024 * 1024
MAX_ROWS = 5000
ARX_VERSION = "3.9.2"
ARX_SHA256 = "18040108e95ca7955d806bf32354b20601d664495653b8ee169d249f43f58d44"
DP_VERSION = "0.16.0"
HEX = re.compile(r"[0-9a-f]{64}")
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")
COLUMN = re.compile(r"[a-z][a-z0-9_]{0,47}")
SOURCE_KINDS = ("DECLARED_MODEL", "DECLARED_EXECUTION")
METRICS = ("CONTRIBUTING_ORGANIZATIONS", "ACCEPTED_ORDER_COUNT", "TOTAL_OPERATION_MINUTES")


class Hold(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Hold(code)


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "OBSERVATION_DUPLICATE_KEY")
        result[key] = value
    return result


def invalid_constant(_):
    raise Hold("OBSERVATION_JSON_INVALID")


def exact(obj, keys):
    return type(obj) is dict and set(obj) == set(keys.split())


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def token(value):
    return type(value) is str and TOKEN.fullmatch(value) is not None


def load_request(payload, engine):
    need(0 < len(payload) <= LIMIT, "OBSERVATION_INPUT_LIMIT")
    try:
        request = json.loads(payload.decode("utf-8"), object_pairs_hook=unique,
                             parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise Hold("OBSERVATION_JSON_INVALID") from exc
    common = "profile technology_sha256 observation_unit source_kind rows"
    need(exact(request, common + (" k columns" if engine == "arx" else " metric public_bound epsilon_milli")),
         "OBSERVATION_PROFILE_INVALID")
    need(request["profile"] == ("ACTIVITY_ARX_COHORT_V1" if engine == "arx" else "ACTIVITY_DP_AGGREGATE_V1")
         and type(request["technology_sha256"]) is str and HEX.fullmatch(request["technology_sha256"])
         and request["observation_unit"] == "ORGANIZATION" and request["source_kind"] in SOURCE_KINDS
         and type(request["rows"]) is list and len(request["rows"]) <= MAX_ROWS,
         "OBSERVATION_PROFILE_INVALID")
    seen = set()
    for row in request["rows"]:
        need(exact(row, "unit_id values" if engine == "arx" else "unit_id value")
             and token(row["unit_id"]) and row["unit_id"] not in seen, "OBSERVATION_UNIT_INVALID")
        seen.add(row["unit_id"])
    if engine == "arx":
        validate_arx(request)
    else:
        validate_dp(request)
    return request


def validate_arx(req):
    rows, columns, k = req["rows"], req["columns"], req["k"]
    need(integer(k, 2, 100) and len(rows) >= k and type(columns) is list and 1 <= len(columns) <= 8,
         "ARX_COHORT_INVALID")
    names = set()
    for idx, col in enumerate(columns):
        need(exact(col, "key hierarchy max_level") and type(col["key"]) is str and COLUMN.fullmatch(col["key"])
             and col["key"] not in names and type(col["hierarchy"]) is list and 1 <= len(col["hierarchy"]) <= MAX_ROWS,
             "ARX_HIERARCHY_INVALID")
        names.add(col["key"])
        hierarchy = col["hierarchy"]
        need(type(hierarchy[0]) is list and 1 <= len(hierarchy[0]) <= 5
             and integer(col["max_level"], 0, len(hierarchy[0]) - 1), "ARX_HIERARCHY_INVALID")
        width = len(hierarchy[0])
        leaves, parents = set(), {}
        for path in hierarchy:
            need(type(path) is list and len(path) == width and all(token(v) for v in path)
                 and path[0] not in leaves, "ARX_HIERARCHY_INVALID")
            leaves.add(path[0])
            for level in range(width - 1):
                key = (level, path[level])
                need(key not in parents or parents[key] == path[level + 1], "ARX_HIERARCHY_INVALID")
                parents[key] = path[level + 1]
        for row in rows:
            need(type(row["values"]) is list and len(row["values"]) == len(columns)
                 and token(row["values"][idx]) and row["values"][idx] in leaves, "ARX_ROW_INVALID")


def validate_dp(req):
    need(req["metric"] in METRICS and integer(req["public_bound"], 1, 100000)
         and integer(req["epsilon_milli"], 50, 1000), "OPENDP_POLICY_INVALID")
    is_count = req["metric"] == "CONTRIBUTING_ORGANIZATIONS"
    need(not is_count or req["public_bound"] == 1, "OPENDP_POLICY_INVALID")
    for row in req["rows"]:
        need(integer(row["value"], 0, 2_000_000_000) and (not is_count or row["value"] == 1),
             "OPENDP_CONTRIBUTION_INVALID")


def base(req, payload):
    return {"input_sha256": sha256(payload).hexdigest(), "technology_sha256": req["technology_sha256"],
            "observation_unit": req["observation_unit"], "source_kind": req["source_kind"],
            "source_authority": "UNVERIFIED_DECLARED_COHORT", "anonymity": "NOT_ESTABLISHED",
            "export_allowed": False, "iwxa_package": None}


def arx(req, payload):
    # Runtime is provisioned by Agent, never selected by input data. Check the exact official jar.
    jar_setting = os.environ.get("IWXA_ACTIVITY_ARX_JAR")
    java = shutil.which("java")
    need(jar_setting and java, "ARX_PROFILE_NOT_INSTALLED")
    jar = Path(jar_setting).resolve()
    need(jar.is_file() and jar.stat().st_size <= 200 * 1024 * 1024, "ARX_PROFILE_NOT_INSTALLED")
    with jar.open("rb") as stream:
        need(sha256(stream.read()).hexdigest() == ARX_SHA256, "ARX_PROFILE_DIGEST_MISMATCH")
    rows, cols = req["rows"], req["columns"]
    lines = [f'{len(rows)}\t{len(cols)}\t{req["k"]}']
    # Values are categorical tokens, not paths, and unit identifiers never reach ARX.
    lines.extend("\t".join(row["values"]) for row in rows)
    for col in cols:
        h = col["hierarchy"]
        lines.append(f'{len(h)}\t{len(h[0])}\t{col["max_level"]}')
        lines.extend("\t".join(path) for path in h)
    source = Path(__file__).resolve().with_name("ActivityArxCohort.java")
    result = subprocess.run([java, "-Xmx512m", "--class-path", str(jar), str(source)],
                            input=("\n".join(lines) + "\n").encode(), stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=90, check=False)
    need(result.returncode == 0 and len(result.stdout) <= 8192, "ARX_ENGINE_FAILED")
    raw = json.loads(result.stdout, object_pairs_hook=unique, parse_constant=invalid_constant)
    need(type(raw) is dict and type(raw.get("available")) is bool, "ARX_ENGINE_RESULT_INVALID")
    before = raw.get("before")
    need(type(before) in (int, float) and 0 < before <= 1, "ARX_ENGINE_RESULT_INVALID")
    levels, after = [], None
    if raw["available"]:
        after = raw.get("after")
        need(exact(raw, "available before after levels") and type(after) in (int, float)
             and 0 < after <= 1 / req["k"] + 1e-12 and after <= before + 1e-12
             and type(raw["levels"]) is list and len(raw["levels"]) == len(cols), "ARX_ENGINE_RESULT_INVALID")
        for col, level in zip(cols, raw["levels"]):
            need(integer(level, 0, col["max_level"]), "ARX_ENGINE_RESULT_INVALID")
            levels.append({"key": col["key"], "level": level, "max_level": col["max_level"]})
    else:
        need(exact(raw, "available before"), "ARX_ENGINE_RESULT_INVALID")
    return {**base(req, payload), "status": "LOCAL_ARX_COHORT_REVIEW", "engine": "ARX",
            "version": ARX_VERSION, "scope": "DECLARED_QUASI_IDENTIFIER_SAMPLE_ONLY",
            "row_count": len(rows), "k": req["k"], "suppression_limit": 0,
            "before_highest_sample_risk": before, "after_highest_sample_risk": after,
            "result_available": raw["available"], "levels": levels}


def opendp(req, payload):
    need(version("opendp") == DP_VERSION, "OPENDP_PROFILE_NOT_INSTALLED")
    import opendp.prelude as dp
    dp.enable_features("contrib")
    space = (dp.vector_domain(dp.atom_domain(T=int)), dp.symmetric_distance())
    epsilon = req["epsilon_milli"] / 1000
    bound = req["public_bound"]
    count = req["metric"] == "CONTRIBUTING_ORGANIZATIONS"
    transformation = space >> dp.t.then_count() if count else space >> dp.t.then_clamp((0, bound)) >> dp.t.then_sum()
    # Account for conservative floating-point rounding in the original privacy map.
    scale = math.nextafter(bound / epsilon, math.inf)
    for _ in range(16):
        measurement = transformation >> dp.m.then_laplace(scale=scale)
        loss = measurement.map(1)
        if math.isfinite(loss) and 0 < loss <= epsilon and measurement.check(1, epsilon):
            break
        scale *= 1.000001
    else:
        raise Hold("OPENDP_PRIVACY_MAP_FAILED")
    values = [r["value"] for r in req["rows"]]
    noisy = measurement(values)
    need(type(noisy) is int and -2**31 <= noisy < 2**31, "OPENDP_ENGINE_RESULT_INVALID")
    # No exact count/sum, private rows or unit keys are returned. This entire
    # artifact (including input digest) remains LOCAL. Repeated previews spend
    # privacy budget if disclosed; no persistent accounting is claimed here.
    return {**base(req, payload), "status": "LOCAL_OPENDP_AGGREGATE_PREVIEW", "engine": "OpenDP",
            "version": DP_VERSION, "scope": "ONE_DECLARED_ORGANIZATION_CONTRIBUTION",
            "metric": req["metric"], "public_bound": bound, "epsilon_milli": req["epsilon_milli"],
            "adjacency": "ADD_OR_REMOVE_ONE_ROW", "delta": 0, "privacy_map_at_one": loss,
            "scale": scale, "noisy_value": noisy, "budget_accounting": "NOT_PERFORMED"}


def main():
    try:
        need(len(sys.argv) == 2 and sys.argv[1] in ("--arx", "--opendp"), "OBSERVATION_ARGUMENTS_INVALID")
        engine = sys.argv[1][2:]
        payload = sys.stdin.buffer.read(LIMIT + 1)
        req = load_request(payload, engine)
        result = arx(req, payload) if engine == "arx" else opendp(req, payload)
        sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")) + "\n")
        return 0
    except Hold as exc:
        code = str(exc)
    except (ImportError, ModuleNotFoundError):
        code = "OBSERVATION_ENGINE_NOT_INSTALLED"
    except Exception:
        code = "OBSERVATION_LOCAL_ENGINE_FAILED"
    sys.stdout.write(json.dumps({"status": "HOLD", "code": code, "anonymity": "NOT_ESTABLISHED",
                                 "export_allowed": False, "iwxa_package": None}) + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
