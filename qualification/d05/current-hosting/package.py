import hashlib
import json
import pathlib
import sys
import tempfile
import zipfile

root = pathlib.Path(sys.argv[1]).resolve()
patch = pathlib.Path(sys.argv[2])
output = pathlib.Path(sys.argv[3])
tree = sys.argv[4]
files = sorted(p for p in root.rglob("*") if p.is_file())
assert files and all(not p.is_symlink() for p in root.rglob("*"))
names = [p.relative_to(root).as_posix() for p in files]
assert {"index.html", ".htaccess", "workspace/index.html"}.issubset(names)
assert not any(n.startswith((".git/", "node_modules/")) for n in names)
with tempfile.TemporaryDirectory() as tmp:
    hosting = pathlib.Path(tmp) / "cehovod-t3-0.3.2-dist.zip"
    with zipfile.ZipFile(hosting, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for path, name in zip(files, names):
            z.write(path, name)
    with zipfile.ZipFile(hosting) as z:
        assert z.testzip() is None
        assert sorted(z.namelist()) == sorted(names)
        for path, name in zip(files, names):
            assert hashlib.sha256(z.read(name)).digest() == hashlib.sha256(path.read_bytes()).digest()
    receipt = {"siteCommit":"a9ead59a8db271209112a200bf7a8816b8449e0c","subjectCommit":"6852d55ae8e7100b480b2d5c0a10b92de1c7d467","assistantCommit":"2c247482306f218a7d5be668de11e98f168862d4","platformCommit":"8e26076ce66f0c26693a647e061fcd568e055b77","platformVersion":"0.3.2","sourceTree":tree,"distFiles":len(files),"distSha256":hashlib.sha256(hosting.read_bytes()).hexdigest(),"linuxQualification":"PASS","hardwareQualification":"PASS_ON_UNCHANGED_RUNTIME_PREDECESSOR","hardwareSiteCommit":"b7896f9b74be8b4d5d9e1eeb3c039b1c5098606f","hardwareRunId":46134347428,"hardwareJobId":140946226501,"productAccepted":False}
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(hosting, hosting.name)
        z.write(patch, "qualified-source.patch")
        z.write(pathlib.Path(sys.argv[5]), "external-links.json")
        z.write(pathlib.Path(sys.argv[6]), "source-gates.json")
        z.writestr("receipt.json", json.dumps(receipt, indent=2) + "\n")
    with zipfile.ZipFile(output) as z:
        assert z.testzip() is None
print("D05_CURRENT_PACKAGED_FILES=" + str(len(files)))
print("D05_CURRENT_INNER_DIST_SHA256=" + receipt["distSha256"])
