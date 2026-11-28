import hashlib
import json
import pathlib
import sys
import tempfile
import zipfile

root = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2])
tree = sys.argv[3]
files = sorted(p for p in root.rglob("*") if p.is_file())
assert files and all(not p.is_symlink() for p in root.rglob("*"))
names = [p.relative_to(root).as_posix() for p in files]
assert {"index.html", ".htaccess", "workspace/index.html", "t3-domain-mode.mjs", "t3-sw.js"}.issubset(names)
assert not any(n.startswith((".git/", "node_modules/")) for n in names)
manifest = json.loads((root / "t3-offline-manifest.json").read_text())
assert manifest["domain_origin"] == "https://cehovod.ru"
with tempfile.TemporaryDirectory() as tmp:
    hosting = pathlib.Path(tmp) / "cehovod-t3-0.3.3-dist.zip"
    with zipfile.ZipFile(hosting, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path, name in zip(files, names):
            z.write(path, name)
    with zipfile.ZipFile(hosting) as z:
        assert z.testzip() is None and sorted(z.namelist()) == sorted(names)
        for path, name in zip(files, names):
            assert hashlib.sha256(z.read(name)).digest() == hashlib.sha256(path.read_bytes()).digest()
    receipt = {"siteCommit":"671bb997fe88ac192f20dfee5be8cdf6db6b9f9d","subjectCommit":"6852d55ae8e7100b480b2d5c0a10b92de1c7d467","assistantCommit":"629aaa274f2d6ad915730ee0d817aedc33e53108","platformCommit":"30e3f98f944ffa351f2dfa9922f38bcca8b7d314","platformVersion":"0.3.3","sourceTree":tree,"domainOrigin":"https://cehovod.ru","distFiles":len(files),"distSha256":hashlib.sha256(hosting.read_bytes()).hexdigest(),"previousQualifiedRun":46142673103,"linuxQualification":"PASS","hardwareQualification":"SEE_RELEASE_GATE","productAccepted":False}
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(hosting, hosting.name)
        z.writestr("receipt.json", json.dumps(receipt, indent=2)+"\n")
    with zipfile.ZipFile(output) as z:
        assert z.testzip() is None
print("D05_033_DIST_FILES="+str(len(files)))
print("D05_033_DIST_SHA256="+receipt["distSha256"])
