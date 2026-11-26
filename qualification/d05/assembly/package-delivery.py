"""Package only the qualified distribution and retained build inputs."""
import hashlib
import json
import os
import stat
import sys
import zipfile
from pathlib import Path

PREFIX = Path('runtime/t3-platform/0.3.1-rc.1')
EXPECTED_TREE = '34ce805156b5e81807a5ee2614c65c57a7464f94'
PLATFORM_SHA = 'b778474d011b34a77cd60b945f02295fb24654c833f3ab12ff36bd3c0bdd8863'
SITE = '5e3ff328f7b31d7fa69b86a0759b914148c921df'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def inventory(root):
    assert root.is_dir() and not root.is_symlink(), 'ROOT'
    result = []
    for path in sorted(root.rglob('*')):
        assert not path.is_symlink(), 'SYMLINK'
        if path.is_dir():
            continue
        assert stat.S_ISREG(path.stat().st_mode), 'REGULAR_FILE'
        rel = path.relative_to(root).as_posix()
        assert all(part not in ('', '.', '..') for part in rel.split('/')), 'PATH'
        result.append({'path': rel, 'bytes': path.stat().st_size, 'sha256': digest(path)})
    return result

def make_zip(root, rows, dest):
    assert not dest.exists(), 'OUTPUT_EXISTS'
    with zipfile.ZipFile(dest, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for row in rows:
            path = root / row['path']
            assert path.is_file() and not path.is_symlink(), 'ZIP_SOURCE'
            data = path.read_bytes()
            assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], 'ZIP_BYTES'
            info = zipfile.ZipInfo(row['path'], (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            out.writestr(info, data)
    with zipfile.ZipFile(dest) as check:
        assert check.namelist() == [row['path'] for row in rows] and check.testzip() is None, 'ZIP_INVENTORY'
        for row in rows:
            assert hashlib.sha256(check.read(row['path'])).hexdigest() == row['sha256'], 'ZIP_READBACK'


def main(site, identity_path, out):
    site, identity_path, out = map(Path, (site, identity_path, out))
    identity = json.loads(identity_path.read_text())
    assert identity['status'] == 'D05_T3_HOST_IDENTITY_PASS' and identity['head'] == SITE
    assert identity['tree'] == EXPECTED_TREE and identity['expectedTreeMatched'] is True
    assert identity['inputFiles'] == 92 and identity['executableFiles'] == 0
    assert identity['contentInventorySha256'] == 'de71e27b4b331a34aa4e5df0cd6db47f07f17ae2bdadee8f387cf7c2448f3171'
    assert identity['hostReceiptSha256'] == '85c1e80986aea58ba925cd89bebcb6e0c7322ec9ceefdd2bd4957fe09f246a5f'
    platform = site / PREFIX / 'platform-inputs.zip'
    assert digest(platform) == PLATFORM_SHA, 'PLATFORM_SHA'
    host_rows = inventory(site / PREFIX / 'cehovod-host')
    assert len(host_rows) == 91, 'HOST_COUNT'
    host_receipt = site / PREFIX / 'cehovod-host/cehovod-t3-host-input.json'
    assert digest(host_receipt) == identity['hostReceiptSha256'], 'HOST_RECEIPT_SHA'
    retained = [{'path': (PREFIX / 'platform-inputs.zip').as_posix(), 'bytes': platform.stat().st_size, 'sha256': PLATFORM_SHA}]
    retained += [{**row, 'path': (PREFIX / 'cehovod-host' / row['path']).as_posix()} for row in host_rows]
    retained.sort(key=lambda row: row['path'])
    dist = inventory(site / 'dist')
    assert len(dist) == 224 and any(row['path'] == '.htaccess' for row in dist), 'DIST_COUNT_OR_ROOT'
    assert not any(any(part in ('.git', 'node_modules', '.native-build') for part in row['path'].split('/')) or row['path'].endswith(('.gguf', '.safetensors', '.onnx')) for row in dist), 'DIST_FORBIDDEN'
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    hosting = out / 'cehovod-t3-1.6.0-hosting.zip'
    inputs = out / 'cehovod-t3-1.6.0-retained-inputs.zip'
    make_zip(site / 'dist', dist, hosting)
    make_zip(site, retained, inputs)
    receipt = {'schema': 'IWXA_D05_T3_ENCRYPTED_DELIVERY/1', 'siteCommit': SITE, 'retainedTree': EXPECTED_TREE, 'identity': identity,
               'hosting': {'name': hosting.name, 'bytes': hosting.stat().st_size, 'sha256': digest(hosting), 'files': dist},
               'retained': {'name': inputs.name, 'bytes': inputs.stat().st_size, 'sha256': digest(inputs), 'files': retained},
               'functionalQualificationRun': 45780282826, 'independentIdentityRun': 45790502240, 'deliveryRun': int(os.environ['GITHUB_RUN_ID']),
               'productTestsRepeated': False, 'remotePublicationVerified': False}
    (out / 'delivery-receipt.json').write_text(json.dumps(receipt, ensure_ascii=True, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'status': 'D05_T3_DELIVERY_PACKAGED', 'tree': EXPECTED_TREE, 'distFiles': len(dist), 'inputFiles': len(retained), 'hostingSha256': receipt['hosting']['sha256'], 'retainedSha256': receipt['retained']['sha256'], 'hostingBytes': receipt['hosting']['bytes'], 'retainedBytes': receipt['retained']['bytes']}))

if __name__ == '__main__':
    main(*sys.argv[1:])
