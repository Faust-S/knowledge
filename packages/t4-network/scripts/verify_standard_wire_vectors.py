#!/usr/bin/env python3
"""Independent Python canonical byte vectors for the T4 network P1.1 candidate.

No outside dependencies, no GitHub access, no T3 or network execution.
This verifier does not validate Ed25519 signatures: the Node test verifies
those against a fixture-only RFC 8032 public key. It DOES independently
fix canonical UTF-8, body/domain hash, signed-byte hash and wire hash.
"""
import base64
import hashlib
import json
from pathlib import Path

FIXTURE = (Path(__file__).resolve().parents[1] /
           "tests/fixtures/standard-network-wire-independent-vectors.v1.json")
KNOWN_SCHEMA = "IWXA_T4_NETWORK_WIRE_INDEPENDENT_VECTORS_V1"
WIRE_SCHEMA = "IWXA_T4_NETWORK_WIRE_CANDIDATE_V1"
VERSION = "iwxa.t4.net/1-candidate"


def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def run():
    fixtures = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixtures["schema"] == KNOWN_SCHEMA
    assert fixtures["testOnly"] is True
    assert len(fixtures["vectors"]) == 13
    assert [v["sequence"] for v in fixtures["vectors"]] == list(range(1, 14))
    expected = {
        "OBJECT_PUT": [], "ASSET_PUT": [],
        "RELATION_PUT": ["iwxa.relation-event.v1"],
        "ASSET_DELETE": ["iwxa.subject-delete.v1"],
        "RELATION_DELETE": ["iwxa.subject-delete.v1"],
        "OBJECT_DELETE": ["iwxa.object-tombstone.v1"],
    }
    changes = [v for v in fixtures["vectors"] if v["messageType"] == "CHANGE_REF"]
    assert {v["body"]["changeKind"] for v in changes} == set(expected)
    for change in changes:
        kind = change["body"]["changeKind"]
        revision = change["body"]["sourceRevision"]
        assert change.get("criticalExtensions", []) == expected[kind]
        if kind in ("RELATION_PUT", "RELATION_DELETE", "ASSET_DELETE"):
            assert revision is None
        else:
            assert type(revision) is int and revision >= (2 if kind == "OBJECT_DELETE" else 1)
        matches = [v for v in fixtures["vectors"] if v["messageType"] == "APPLIED_ACK"
                   and v["body"]["changeId"] == change["body"]["changeId"]]
        assert len(matches) == 1
        assert matches[0]["body"]["recipientRevision"] == revision
        assert matches[0].get("criticalExtensions", []) == expected[kind]
    checked = []
    for item in fixtures["vectors"]:
        body = item["body"]
        body_digest = ("sha256:" + sha256(
            b"IWXA-T4-CANDIDATE-BODY\x00" + canonical(body)
        ))
        assert body_digest == item["bodyDigest"], item["name"]
        unsigned = {
            **fixtures["sharedFields"],
            "criticalExtensions": item.get("criticalExtensions", fixtures["sharedFields"]["criticalExtensions"]),
            "schema": WIRE_SCHEMA,
            "protocolVersion": VERSION,
            "messageType": item["messageType"],
            "messageId": "message:golden:" + str(item["sequence"]),
            "sequence": item["sequence"],
            "body": body,
            "bodyDigest": body_digest,
        }
        signed = b"IWXA-T4-WIRE-CANDIDATE-V1\x00" + canonical(unsigned)
        assert sha256(signed) == item["signedBytesSha256"], item["name"]
        sig = base64.b64decode(item["signatureBase64"], validate=True)
        assert len(sig) == 64, item["name"]
        frame = {**unsigned, "signatureBase64": item["signatureBase64"]}
        wire = canonical(frame)
        assert sha256(wire) == item["wireSha256"], item["name"]
        checked.append(item["name"])
    print("T4_P1_1_PYTHON_INDEPENDENT_GOLDEN_VECTORS_PASS",
          ",".join(checked))


if __name__ == "__main__":
    run()
