"""Optional local worker for the EXISTING Agent program invocation.
Run original Presidio Analyzer and installed spaCy models; no own PII algorithm,
no remote recognizer, no runtime download, no write to Workspace or publication.
stdin: exact local Activity disclosure candidate artifact. stdout: one JSON.
"""
from hashlib import sha256
from importlib.metadata import version
import json
import logging
import math
import re
import sys
import warnings

VERSION = "2.2.366"
MODELS = {"en": ("en_core_web_sm", "3.8.0"), "ru": ("ru_core_news_sm", "3.8.0")}
LIMIT = 8 * 1024 * 1024
FIELD_LIMIT = 2048
CHAR_LIMIT = 256_000
FINDING_LIMIT = 8192
THRESHOLD = 0.3
REGIONS = ("RU", "US", "GB", "DE", "FR")
SKIP = {"operation_id", "check_id", "predecessors", "kind", "control_type", "mode", "field", "use", "status"}
PATH = re.compile(r"technology\.(?:terms\.(?:purpose|inputs|outputs|applicability|adaptation_guidance|local_context_guidance)|"
                  r"route_parameters\.\d+\.(?:value|guidance)|"
                  r"operations\.\d+\.(?:label|role|equipment_requirement|material_requirement|parameters\.\d+\.(?:value|guidance))|"
                  r"quality_checks\.\d+\.(?:title|responsible_role|declared_fields\.\d+\.value))")
TOP = {"status", "technology", "text_review_fields", "parameter_summary", "pending_parameter_decisions",
       "missing_proposal_fields", "unresolved_source_requirements", "source_quality_status",
       "domain_validation", "disclosure_review", "anonymity", "export_allowed", "iwxa_package"}


class Hold(Exception):
    pass


def need(condition, code):
    if not condition:
        raise Hold(code)


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "PRESIDIO_DUPLICATE_KEY")
        value[key] = item
    return value


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def text_inventory(technology):
    fields = []
    def walk(value, path, depth):
        need(depth <= 10, "PRESIDIO_CANDIDATE_STRUCTURE")
        if isinstance(value, str) and value:
            need(PATH.fullmatch(path) and len(value) <= 4096, "PRESIDIO_TEXT_FIELD_INVALID")
            fields.append({"path": path, "text": value})
        elif isinstance(value, list):
            for i, item in enumerate(value):
                walk(item, f"{path}.{i}", depth + 1)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key not in SKIP:
                    walk(item, f"{path}.{key}", depth + 1)
        else:
            need(value is None or type(value) in (str, int, bool), "PRESIDIO_CANDIDATE_STRUCTURE")
    walk(technology, "technology", 0)
    need(0 < len(fields) <= FIELD_LIMIT and sum(len(f["text"]) for f in fields) <= CHAR_LIMIT,
         "PRESIDIO_TEXT_LIMIT")
    return sorted(fields, key=lambda field: field["path"])


def load_candidate(payload):
    try:
        candidate = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=unique_object,
                               parse_constant=lambda _: (_ for _ in ()).throw(Hold("PRESIDIO_CANDIDATE_JSON")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise Hold("PRESIDIO_CANDIDATE_JSON") from exc
    need(isinstance(candidate, dict) and set(candidate) == TOP and
         candidate["status"] in ("LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW", "LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT") and
         candidate["export_allowed"] is False and candidate["anonymity"] == "NOT_ESTABLISHED" and
         candidate["disclosure_review"] == "NOT_PERFORMED" and candidate["iwxa_package"] is None,
         "PRESIDIO_CANDIDATE_PROFILE")
    technology = candidate["technology"]
    need(isinstance(technology, dict) and set(technology) == {"terms", "route_parameters", "operations", "quality_checks"},
         "PRESIDIO_CANDIDATE_STRUCTURE")
    fields = text_inventory(technology)
    supplied = candidate["text_review_fields"]
    need(isinstance(supplied, list) and len(supplied) == len(fields) and all(
        isinstance(f, dict) and set(f) == {"path", "text"} and isinstance(f["path"], str) and isinstance(f["text"], str)
        for f in supplied), "PRESIDIO_INVENTORY_MISMATCH")
    need(sorted(supplied, key=lambda f: f["path"]) == fields and len({f["path"] for f in fields}) == len(fields),
         "PRESIDIO_INVENTORY_MISMATCH")
    return technology, fields


def load_product(payload):
    try:
        preview = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=unique_object,
                             parse_constant=lambda _: (_ for _ in ()).throw(Hold("PRESIDIO_PRODUCT_JSON")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise Hold("PRESIDIO_PRODUCT_JSON") from exc
    need(type(preview) is dict and preview.get("status") == "LOCAL_TECHNOLOGY_PRODUCT_PREVIEW"
         and preview.get("schema_id") == "iwxa.activity.technology"
         and preview.get("schema_version") == "1.0.0"
         and preview.get("export_allowed") is False and preview.get("iwxa_package") is None
         and preview.get("anonymity") == "NOT_ESTABLISHED"
         and preview.get("disclosure_status") == "REQUIRES_OWNER_REVIEW", "PRESIDIO_PRODUCT_PROFILE")
    product = preview.get("object_data")
    need(type(product) is dict and set(product) == {"title", "target", "technology"}
         and product.get("target") in ("PERSONAL_AGENT_TASK_PROMPT", "D05_OPERATION_ROUTE_QUALITY")
         and type(product.get("title")) is str and type(product.get("technology")) is dict
         and sha256(canonical(product)).hexdigest() == preview.get("product_sha256"),
         "PRESIDIO_PRODUCT_PROFILE")
    fields = []
    def walk(value, path, depth):
        need(depth <= 12, "PRESIDIO_PRODUCT_STRUCTURE")
        if isinstance(value, str):
            if value:
                need(len(value) <= 16000, "PRESIDIO_PRODUCT_TEXT_LIMIT")
                fields.append({"path": path, "text": value})
        elif isinstance(value, list):
            for i, item in enumerate(value):
                walk(item, f"{path}.{i}", depth + 1)
        elif isinstance(value, dict):
            for k, item in value.items():
                need(re.fullmatch(r"[a-z][a-z0-9_]*", k), "PRESIDIO_PRODUCT_STRUCTURE")
                walk(item, f"{path}.{k}", depth + 1)
        else:
            need(value is None or type(value) in (bool, int), "PRESIDIO_PRODUCT_STRUCTURE")
    walk(product, "object_data", 0)
    need(0 < len(fields) <= FIELD_LIMIT and sum(len(f["text"]) for f in fields) <= CHAR_LIMIT,
         "PRESIDIO_PRODUCT_TEXT_LIMIT")
    return product, sorted(fields, key=lambda f: f["path"])


def analyzer(language):
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import SpacyNlpEngine
    from presidio_analyzer.predefined_recognizers import (
        SpacyRecognizer, EmailRecognizer, PhoneRecognizer, IpRecognizer, UrlRecognizer,
        IbanRecognizer, DateRecognizer,
    )
    import spacy
    import tldextract
    model, expected = MODELS[language]
    need(version("presidio-analyzer") == VERSION and version(model) == expected and
         spacy.util.is_package(model) and version("spacy").startswith("3.8."),
         "PRESIDIO_PROFILE_NOT_INSTALLED")
    # Original EmailRecognizer uses tldextract; use its packaged offline
    # suffix snapshot. No network update or private text leaves this worker.
    tldextract.extract = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=(), fallback_to_snapshot=True)
    nlp = SpacyNlpEngine(models=[{"lang_code": language, "model_name": model}])
    registry = RecognizerRegistry(supported_languages=[language])
    for recognizer in (
        SpacyRecognizer(supported_language=language),
        EmailRecognizer(supported_language=language),
        PhoneRecognizer(supported_language=language, supported_regions=REGIONS),
        IpRecognizer(supported_language=language),
        UrlRecognizer(supported_language=language),
        IbanRecognizer(supported_language=language),
        DateRecognizer(supported_language=language),
    ):
        registry.add_recognizer(recognizer)
    engine = AnalyzerEngine(registry=registry, nlp_engine=nlp, supported_languages=[language],
                            log_decision_process=False, default_score_threshold=THRESHOLD)
    return engine, model, expected


def run(payload, language, product=False):
    technology, fields = load_product(payload) if product else load_candidate(payload)
    # A candidate from another local source does not become authenticated by
    # computing a digest; it only ties the scan to these exact bytes/fields.
    digest = sha256(canonical(technology)).hexdigest()
    inventory_digest = sha256(canonical(fields)).hexdigest()
    engine, model, model_version = analyzer(language)
    output = []
    total = 0
    entities = sorted(engine.get_supported_entities(language))
    for row in fields:
        text = row["text"]
        results = engine.analyze(text=text, language=language, score_threshold=THRESHOLD,
                                 return_decision_process=False)
        found = []
        for item in results:
            need(item.entity_type in entities and type(item.start) is int and type(item.end) is int and
                 0 <= item.start < item.end <= len(text) and math.isfinite(item.score) and
                 THRESHOLD <= item.score <= 1, "PRESIDIO_RESULT_INVALID")
            found.append({"entity_type": item.entity_type, "start": item.start, "end": item.end, "score": item.score})
        total += len(found)
        need(total <= FINDING_LIMIT, "PRESIDIO_FINDING_LIMIT")
        found.sort(key=lambda x: (x["start"], x["end"], x["entity_type"], -x["score"]))
        output.append({"path": row["path"], "text_length": len(text), "findings": found})
    return {"status": "LOCAL_TEXT_SCREENING_COMPLETE", "engine": "Presidio Analyzer",
            "version": VERSION, "language": language, "model": model, "model_version": model_version,
            "spacy_version": version("spacy"), "score_threshold": THRESHOLD,
            "supported_entities": entities, "phone_regions": list(REGIONS),
            "input_sha256": sha256(payload).hexdigest(), ("product_sha256" if product else "technology_sha256"): digest,
            "text_inventory_sha256": inventory_digest, "offset_unit": "UNICODE_CODE_POINT",
            "fields": output, "field_count": len(output), "finding_count": total,
            "scope": "PRODUCT_IDENTIFYING_TEXT_SCREENING_ONLY" if product else "IDENTIFYING_TEXT_SCREENING_ONLY", "anonymity": "NOT_ESTABLISHED",
            "export_allowed": False, "iwxa_package": None}


def main():
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    try:
        need(len(sys.argv) in (3, 4) and sys.argv[1] == "--language" and sys.argv[2] in MODELS and\n             (len(sys.argv) == 3 or sys.argv[3] == "--product"),
             "PRESIDIO_ARGUMENTS_INVALID")
        payload = sys.stdin.buffer.read(LIMIT + 1)
        need(0 < len(payload) <= LIMIT, "PRESIDIO_INPUT_LIMIT")
        result = run(payload, sys.argv[2], product=len(sys.argv) == 4)
        out = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        need(len(out) <= LIMIT, "PRESIDIO_OUTPUT_LIMIT")
        sys.stdout.buffer.write(out + b"\n")
        return 0
    except Hold as exc:
        code = str(exc)
    except (ImportError, ModuleNotFoundError):
        code = "PRESIDIO_PROFILE_NOT_INSTALLED"
    except Exception:
        code = "PRESIDIO_LOCAL_SCAN_FAILED"
    # Never include exception text, paths, input fields or recognized values.
    sys.stdout.write(json.dumps({"status": "HOLD", "code": code, "anonymity": "NOT_ESTABLISHED",
                                 "export_allowed": False, "iwxa_package": None}) + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
