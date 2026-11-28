"""D11 release-only hosting ZIP verification and recipient encryption.

The crypto module is the original public IWXA delivery implementation
from Faust-S/Center@0842281aa16ca9231c97f2eb2ec81e22b5b21c22, reused without modifications.
Only the encrypted envelope and a public receipt are published.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from delivery_crypto import HEADER, MAGIC, OAEP, MAX_SIZE, encrypt_file, digest_stream
from admit import CANDIDATE_PIN as PIN, CANDIDATE_TREE as TREE

RECIPIENT = "b9f6f34b406311981ccf68184c1eb7ca958d2893357879f201739195f0e22b60"
ORIGIN = "https://advice-logistics.ru"
DOMAIN = "ru.iwxa.advice-logistics"
RUNTIME_SHA = "e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78"
NAME = "Advice-Logistics-T3-0.3.2-"+PIN[:8]+".zip"
REQUIRED = {".htaccess", "index.html", "workspace/index.html", "workspace/exchange/index.html",
            "workspace/lifecycle/index.html", "_iwxa/domain.json", "_iwxa/domain-shell.json",
            "_iwxa/runtime/0.3.6/runtime.js", "t3-sw.js", "t3-domain-mode.mjs",
            "t3-offline-manifest.json", "t3-app-manifest.json"}
BLOCKED_PARTS = {".git", ".github", "node_modules", "__pycache__", "diagnostics", "studio"}
BLOCKED_SUFFIXES = {".map", ".pem", ".key", ".safetensors", ".gguf", ".iwxae", ".zip", ".exe", ".pyc", ".ts", ".tsx", ".rs", ".log"}

def require(ok, code):
    if not ok:
        raise ValueError(code)

def sha(path):
    with path.open("rb") as f:
        return digest_stream(f)

def safe_path(name):
    p = PurePosixPath(name)
    require(bool(name) and not p.is_absolute() and str(p) == name and
            not any(c in name for c in ("\\", ":", "\x00")) and
            not any(x in (".", "..") or x.lower() in BLOCKED_PARTS or x.lower().startswith(".env") for x in p.parts)
            and p.suffix.lower() not in BLOCKED_SUFFIXES, "PATH_SCOPE")
    return p

def inventory(root):
    require(root.is_dir() and not root.is_symlink(), "DIST_ROOT")
    records = {}
    folded = set()
    for p in sorted(root.rglob("*")):
        require(not p.is_symlink(), "DIST_SYMLINK")
        if p.is_dir():
            continue
        require(p.is_file(), "DIST_SPECIAL_FILE")
        name = p.relative_to(root).as_posix()
        safe_path(name)
        require(name.casefold() not in folded, "DIST_DUPLICATE_PATH")
        folded.add(name.casefold())
        records[name] = (p.stat().st_size, sha(p))
    require(REQUIRED <= records.keys(), "MISSING_ROOT_FILES")
    return records

def verify_manifest(root, records, runtime_sha=RUNTIME_SHA):
    for name in ("_iwxa/domain.json", "_iwxa/domain-shell.json"):
        row = json.loads((root/name).read_text(encoding="utf-8"))
        require(row.get("origin") == ORIGIN and row.get("domain_id") == DOMAIN, "DOMAIN_ORIGIN")
        if name == "_iwxa/domain.json":
            require(row.get("release", {}).get("deployment_mode") == "production", "NOT_PRODUCTION")
    require(records["_iwxa/runtime/0.3.6/runtime.js"][1] == runtime_sha, "KERNEL_DIGEST")
    m = json.loads((root/"t3-offline-manifest.json").read_text(encoding="utf-8"))
    require(m.get("schema") == "iwxa.t3.domain-offline/1" and m.get("domain_origin") == ORIGIN and
            m.get("complete_static_tree") is True and bool(re.fullmatch("[0-9a-f]{64}", m.get("version", ""))), "OFFLINE_MANIFEST")
    seen = set()
    for row in m["files"]:
        route = row["path"]
        source = row.get("source", route)
        require(route.startswith("/") and route not in seen and source.startswith("/") and
                (source == route or (route.endswith("/") and source == route+"index.html")), "OFFLINE_PATH")
        seen.add(route)
        name = source[1:]
        safe_path(name)
        require(records.get(name) == (row["bytes"], row["sha256"]), "OFFLINE_DIGEST")
    require({"/", "/workspace/", "/workspace/exchange/", "/workspace/lifecycle/"} <= seen, "OFFLINE_ROUTES")
    require(all("/"+name in seen for name in records if name not in {".htaccess", "t3-offline-manifest.json"}), "OFFLINE_OMISSION")
    return len(m["files"])

def create_and_read_zip(root, target, original):
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name in original:
            archive.write(root/name, name)
    # Read back the complete archive, not only its directory listing.
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        require(len(names) == len(original) and set(names) == set(original), "ZIP_FILE_SET")
        require(archive.testzip() is None, "ZIP_CRC")
        for member in archive.infolist():
            safe_path(member.filename)
            require(not member.is_dir() and not stat.S_ISLNK(member.external_attr >> 16), "ZIP_MEMBER_TYPE")
            with archive.open(member) as stream:
                actual = digest_stream(stream)
            require(original[member.filename] == (member.file_size, actual), "ZIP_READBACK_DIGEST")
    require(inventory(root) == original, "DIST_CHANGED")
    return sha(target)

def verify_recipient():
    pem = Path(__file__).with_name("delivery-recipient.pem").read_bytes()
    require(hashlib.sha256(pem).hexdigest() == RECIPIENT, "RECIPIENT_FINGERPRINT")
    key = serialization.load_pem_public_key(pem)
    require(isinstance(key, rsa.RSAPublicKey) and key.key_size == 3072, "RECIPIENT_TYPE")
    return pem

def check_envelope(path, size, plain_digest, cipher_digest):
    with path.open("rb") as stream:
        header = stream.read(HEADER.size)
        magic, pin, tree, length, digest, nonce, wrapped = HEADER.unpack(header)
        require(magic == MAGIC and pin == PIN.encode("ascii") and tree == TREE.encode("ascii") and
                length == size and 1 <= size <= MAX_SIZE and digest.hex() == plain_digest and
                len(nonce) == 12 and len(wrapped) == 384 and path.stat().st_size == HEADER.size+size+16, "ENVELOPE_HEADER")
        stream.seek(0)
        require(digest_stream(stream) == cipher_digest, "ENVELOPE_DIGEST")

def self_test():
    verify_recipient()
    with tempfile.TemporaryDirectory(prefix="d11-hosting-test-") as tmp:
        root = Path(tmp)/"dist"
        root.mkdir()
        fixture = {n: b"fixture" for n in REQUIRED}
        conf = json.dumps({"origin":ORIGIN,"domain_id":DOMAIN,"release":{"deployment_mode":"production"}}).encode()
        fixture["_iwxa/domain.json"] = fixture["_iwxa/domain-shell.json"] = conf
        rows = [{"path":"/"+n,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}
                for n,b in fixture.items() if n not in {".htaccess","t3-offline-manifest.json"}]
        for route in ("/","/workspace/","/workspace/exchange/","/workspace/lifecycle/"):
            src = route+"index.html"
            b = fixture[src[1:]]
            rows.append({"path":route,"source":src,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()})
        fixture["t3-offline-manifest.json"] = json.dumps({"schema":"iwxa.t3.domain-offline/1",
            "domain_origin":ORIGIN,"complete_static_tree":True,"version":"0"*64,"files":rows}).encode()
        for name, data in fixture.items():
            path = root/name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        records = inventory(root)
        require(verify_manifest(root, records, records["_iwxa/runtime/0.3.6/runtime.js"][1]) == len(rows), "TEST_MANIFEST")
        archive = Path(tmp)/"fixture.zip"
        plain = create_and_read_zip(root, archive, records)
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        sealed = Path(tmp)/"fixture.iwxae"
        a,b = encrypt_file(archive,sealed,pem)
        require(a == plain,"TEST_PLAIN_DIGEST")
        check_envelope(sealed,archive.stat().st_size,a,b)
        raw = sealed.read_bytes()
        header = raw[:HEADER.size]
        *_,nonce,wrapped = HEADER.unpack(header)
        session = key.decrypt(wrapped,OAEP)
        require(AESGCM(session).decrypt(nonce,raw[HEADER.size:],header) == archive.read_bytes(),"TEST_CRYPTO_ROUNDTRIP")
        tampered = raw[:-1]+bytes([raw[-1]^1])
        try:
            AESGCM(session).decrypt(nonce,tampered[HEADER.size:],header)
        except Exception:
            pass
        else:
            raise ValueError("TEST_TAMPER_ACCEPTED")
        try:
            safe_path("../x")
        except ValueError:
            pass
        else:
            raise ValueError("TEST_PATH_TRAVERSAL")
    print("D11_HOSTING_SEAL_SELF_TEST=PASS")

def deliver(root, output):
    root = root.resolve(strict=True)
    require(not output.exists() and not output.is_symlink(), "DELIVERY_ALREADY_EXISTS")
    pem = verify_recipient()
    original = inventory(root)
    paths = verify_manifest(root, original)
    output.mkdir()
    complete = False
    try:
        with tempfile.TemporaryDirectory(prefix="d11-hosting-plain-", dir=output.parent) as tmp:
            zip_path = Path(tmp)/NAME
            plain = create_and_read_zip(root, zip_path, original)
            size = zip_path.stat().st_size
            print("D11_HOSTING_ZIP_READBACK=PASS")
            envelope = output/(NAME+".iwxae")
            plain_check, cipher = encrypt_file(zip_path, envelope, pem)
            require(plain_check == plain, "ENCRYPTION_INPUT_DIGEST")
            check_envelope(envelope,size,plain,cipher)
            receipt = {"schema":"IWXA_D11_HOSTING_DELIVERY/1", "domain":DOMAIN, "origin":ORIGIN,
                "site_commit":PIN,"site_tree":TREE,"subject_commit":"f266bec7e24592b210ea5129001b8fd766199f79",
                "t3_commit":"8e26076ce66f0c26693a647e061fcd568e055b77","assistant_commit":"2c247482306f218a7d5be668de11e98f168862d4","t3_version":"0.3.2",
                "kernel":"0.3.6","recipient_public_sha256":RECIPIENT,
                "zip_filename":NAME,"zip_sha256":plain,"zip_bytes":size,"files":len(original),
                "offline_paths":paths,"encrypted_filename":envelope.name,"encrypted_sha256":cipher,
                "encrypted_bytes":envelope.stat().st_size,"qualification_run":46127206898,
                "build_run":os.environ.get("GITHUB_RUN_ID",""),
                "status":"QUALIFIED_HOSTING_ARCHIVE_ENCRYPTED_NOT_DEPLOYED"}
            (output/"receipt.json").write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
            require(json.loads((output/"receipt.json").read_text()) == receipt, "RECEIPT_READBACK")
        require({p.name for p in output.iterdir()} == {NAME+".iwxae","receipt.json"}, "DELIVERY_SCOPE")
        complete = True
        print("D11_HOSTING_FILES="+str(len(original)))
        print("D11_HOSTING_OFFLINE_PATHS="+str(paths))
        print("D11_HOSTING_ZIP_BYTES="+str(size))
        print("D11_HOSTING_ZIP_SHA256="+plain)
        print("D11_HOSTING_ENCRYPTED_SHA256="+cipher)
        print("D11_HOSTING_ENCRYPTED_BYTES="+str(envelope.stat().st_size))
        print("D11_HOSTING_ENVELOPE_VERIFIED=PASS")
    finally:
        if not complete:
            shutil.rmtree(output,ignore_errors=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--dist",type=Path)
    parser.add_argument("--output",type=Path)
    args = parser.parse_args()
    try:
        if args.self_test:
            self_test()
        else:
            require(args.dist is not None and args.output is not None, "ARGUMENTS")
            deliver(args.dist,args.output)
    except Exception as exc:
        code = str(exc) if isinstance(exc,ValueError) and re.fullmatch("[A-Z0-9_]+",str(exc)) else "UNCLASSIFIED"
        print("D11_HOSTING_FAILED="+code)
        raise SystemExit(1)
