"""Check the pinned original executable scope before native Mesa qualification."""
import json
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
PACKAGE = ROOT / "research/akis/qualitative_mesa"
REPO = Path(subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True
).strip())
PREFIX = PACKAGE.relative_to(REPO).as_posix()

def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)

def included(path):
    p = PurePosixPath(path)
    return (p.suffix == ".py" or path.startswith(("fixtures/", "experiments/"))
            or path == "requirements.txt")

def main():
    manifest = json.loads((ROOT / "source_scope_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != "AKIS_NATIVE_SOURCE_SCOPE/1":
        raise SystemExit("Unexpected manifest schema")
    expected = dict(manifest["source_files"])
    extra = manifest["retained_stand_only"]
    if set(expected) & set(extra):
        raise SystemExit("Stand-only entries overlap original source")
    expected.update(extra)
    actual = {}
    for item in git("ls-tree", "-r", "-z", "HEAD", "--", PREFIX).split(b"\0"):
        if not item:
            continue
        meta, raw_path = item.split(b"\t", 1)
        path = raw_path.decode("utf-8")[len(PREFIX)+1:]
        mode, kind, sha = meta.decode("ascii").split()
        if included(path):
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise SystemExit("Non-regular source file: " + path)
            actual[path] = sha
    missing = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    changed = sorted(k for k in expected.keys() & actual.keys() if expected[k] != actual[k])
    if missing or unexpected or changed:
        raise SystemExit(f"Source scope mismatch: missing={missing}, unexpected={unexpected}, changed={changed}")
    for path, sha in sorted(expected.items()):
        repo_path = PREFIX + "/" + path
        actual_sha = git("hash-object", "--path=" + repo_path, repo_path).decode().strip()
        if actual_sha != sha:
            raise SystemExit("Checkout bytes mismatch: " + path)
    catalog = manifest["catalog_fixture"]
    cp = ROOT / catalog["path"]
    rp = cp.relative_to(REPO).as_posix()
    if git("hash-object", "--path=" + rp, rp).decode().strip() != catalog["sha"]:
        raise SystemExit("Synthetic catalog fixture mismatch")
    data = json.loads(cp.read_text(encoding="utf-8"))
    if data.get("synthetic_qualification_fixture") is not True or data.get("not_the_doctoral_canonical_author_catalog") is not True:
        raise SystemExit("Catalog must remain explicitly synthetic")
    print(f"Original executable scope: {len(manifest['source_files'])}/{len(manifest['source_files'])} exact Git blobs; retained stand-only: {len(extra)}; synthetic catalog only; source {manifest['source_revision']}")

if __name__ == "__main__":
    main()
