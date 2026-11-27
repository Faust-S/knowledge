"""Apply the qualified ArtBazy configuration delta to an authenticated build.
The original T3 materializer regenerates the offline manifest; no bundle edits.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path

BUILD_SITE = 'a6ad6a7a90d97e04a931c8f33598373a5336c1a2'
FINAL_SITE = '3af58d0efa74fb91e22afbddf913f76c6484a3ed'
PLATFORM_SHA = 'c142597c759d6689c0298d0ec6abc7ee66b2eefbb1d5abb086efff6f0dea891e'
PASSPORT = '_iwxa/services/ru.iwxa.artbazy.workspace.json'
CATALOG = '_iwxa/service-catalog.json'
WORKSPACE_APACHE = 'workspace/.htaccess'
MANIFEST = 't3-offline-manifest.json'
PROOFS = ('google16dce79d77367d6f.html', 'yandex_95e23e45501e02eb.html')
CHANGED = {'.htaccess', PASSPORT, CATALOG, WORKSPACE_APACHE, MANIFEST}
BUILD_RUN = '46048600732'
WITNESS_SITE = '5994bc36837beb5534797c5349019d12ed30797c'
WITNESS_RUN = '46040574272'
OLD_APACHE = '3ed0a4b8037c9ae077533cfb76e243931c05f6eb5b86884359d0a61295a1462c'
NEW_APACHE = 'e5fbe4ae4908549bb92393a66496d9773b7f28d31b16a9d7c7a93fc0891a5510'
SLUGS = {b'contribution-margin', b'working-capital', b'payback-period', b'rule-of-40', b'time-to-hire', b'bus-factor'}
RULE = re.compile(rb'^RewriteRule \^slovar/([a-z0-9-]+)/\?\$')


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def sha_file(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def fix_apache(raw):
    need(sha(raw) == OLD_APACHE, 'APACHE_BASE_IDENTITY')
    removed, kept = [], []
    for line in raw.splitlines(keepends=True):
        m = RULE.match(line)
        if m and m[1] in SLUGS:
            removed.append(m[1])
        else:
            kept.append(line)
    result = b''.join(kept)
    need(len(removed) == 6 and set(removed) == SLUGS, 'APACHE_DELTA_SCOPE')
    need(sha(result) == NEW_APACHE, 'APACHE_RESULT_IDENTITY')
    return result


def entries(z):
    result = {}
    for info in z.infolist():
        name = info.filename.rstrip('/')
        need(name and not any(c in name for c in '\\:\x00?#') and
             all(x not in ('', '.', '..') for x in name.split('/')), 'ENTRY_PATH')
        need(name.casefold() not in result, 'ENTRY_DUPLICATE')
        mode = info.external_attr >> 16
        need(not stat.S_ISLNK(mode) and stat.S_IFMT(mode) in
             (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG), 'ENTRY_TYPE')
        result[name.casefold()] = info
    return result


def apply_configuration(root, platform_archive, temp):
    need(sha_file(platform_archive) == PLATFORM_SHA, 'ORIGINAL_PLATFORM_IDENTITY')
    platform = temp / 'platform'
    platform.mkdir()
    with zipfile.ZipFile(platform_archive) as original:
        original.extractall(platform)
    materializer = platform / 'scripts/materialize-t3-domain-mode.mjs'
    need(materializer.is_file(), 'ORIGINAL_MATERIALIZER_MISSING')
    (root / '.htaccess').write_bytes(fix_apache((root / '.htaccess').read_bytes()))
    def patch(path, old, new, replacements):
        raw = (root / path).read_bytes()
        need(sha(raw) == old, 'CONFIG_BASE_IDENTITY:' + path)
        for a, b in replacements:
            need(raw.count(a) == 1, 'CONFIG_DELTA_SCOPE:' + path)
            raw = raw.replace(a, b, 1)
        need(sha(raw) == new, 'CONFIG_RESULT_IDENTITY:' + path)
        (root / path).write_bytes(raw)
    before_passport = '45f5885ef903c520bbb675fdc77dbbd9d79ec9ab0d1d5c162cc24f33ff26ba98'
    after_passport = 'f3d50f1cccf84c4126ce701320ec5a3dd8027c594126956d92d99eab5e4d88ee'
    flags = []
    for schema in ('calculation-result', 'research-draft', 'payment-plan-fact'):
        a = ('"ru.iwxa.artbazy.' + schema + '":{"schema_version":"1.0.0","preserve_unknown":true,').encode()
        flags.append((a, a.replace(b'true,', b'false,')))
    patch(PASSPORT, before_passport, after_passport, flags)
    patch(CATALOG, '2e8fbc1e5dc98b15e33a91a6c76f202bc12af962a99fa92a43d7f1be14e81376',
          '6bf9a8746d44dcdaf4e7b25783aa60211accb923ad65d69a77c71e9585bef033',
          [(before_passport.encode(), after_passport.encode())])
    patch(WORKSPACE_APACHE, '75a3dabe73f7ce802bb63ced7737615ae4e1f7634074b976d96228c4a8bccf86',
          'bcd0e3e5d6fe2c2e99bb11899eb83aa54a9aaaa14c15ac679a8baf3db215f350',
          [(b"script-src 'self' 'wasm-unsafe-eval';", b"script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';")])
    old = json.loads((root / MANIFEST).read_bytes())
    need(old['complete_static_tree'] is True and old['domain_origin'] == 'https://artbazy.ru', 'MANIFEST')
    # Hosting proof files are excluded by the original domain assembly.
    proofs = temp / 'hosting-proofs'
    proofs.mkdir()
    for name in PROOFS:
        (root / name).rename(proofs / name)
    try:
        subprocess.run(['node', str(materializer), str(root)], check=True, capture_output=True, text=True)
    finally:
        for name in PROOFS:
            (proofs / name).rename(root / name)
    new = json.loads((root / MANIFEST).read_bytes())
    need(old['version'] != new['version'], 'OFFLINE_VERSION_NOT_CHANGED')
    need({k:v for k,v in old.items() if k not in ('files','version','total_bytes')} ==
         {k:v for k,v in new.items() if k not in ('files','version','total_bytes')}, 'OFFLINE_METADATA_CHANGED')
    need([r['path'] for r in old['files']] == [r['path'] for r in new['files']], 'OFFLINE_COVERAGE_CHANGED')
    need({a['path'] for a,b in zip(old['files'],new['files']) if a != b} ==
         {'/'+PASSPORT, '/'+CATALOG}, 'OFFLINE_DELTA_SCOPE')
    return old['version'], new['version']


def finalize(archive, header, output, platform_archive, witness=False):
    archive, header, output, platform_archive = map(Path, (archive, header, output, platform_archive))
    need(output.suffix.lower() == '.zip' and output.resolve() != archive.resolve(), 'OUTPUT_PATH')
    checksum = Path(str(output) + '.sha256')
    receipt = Path(str(output) + '.receipt.json')
    need(not any(p.exists() for p in (output, checksum, receipt)), 'OUTPUT_EXISTS')
    site, run = (WITNESS_SITE, WITNESS_RUN) if witness else (BUILD_SITE, BUILD_RUN)
    # Header is from an envelope successfully opened by sealed-release-zip.mjs.
    # An independently verified CI run and the authenticated opening remain prerequisites.
    meta = json.loads(header.read_text())['metadata']
    before_sha = sha_file(archive)
    need(meta['schema'] == 'IWXA_SEALED_RELEASE_ZIP/1' and meta['site'] == site and
         meta['run'] == run and meta['zipSha256'] == before_sha and
         meta['zipBytes'] == archive.stat().st_size, 'BUILD_RECEIPT_IDENTITY')
    need(Path(str(archive) + '.sha256').read_text().strip() == before_sha + '  ' + archive.name,
         'BUILD_CHECKSUM')
    output.parent.mkdir(parents=True, exist_ok=True)
    published = []
    with tempfile.TemporaryDirectory(prefix='.artbazy-final-', dir=output.parent) as temp:
        staged = Path(temp) / 'site.zip'
        with zipfile.ZipFile(archive) as z:
            before = entries(z)
            need('.htaccess' in before and 't3-offline-manifest.json' in before, 'BUILD_ENTRIES')
            deploy = Path(temp) / 'dist'
            deploy.mkdir()
            z.extractall(deploy)
            old_version, new_version = apply_configuration(deploy, platform_archive, Path(temp))
            need({str(p.relative_to(deploy)).replace(os.sep, '/') for p in deploy.rglob('*') if p.is_file()} ==
                 {i.filename for i in before.values() if not i.is_dir()}, 'ARCHIVE_PATHS')
            changed = set()
            with zipfile.ZipFile(staged, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
                for info in z.infolist():
                    data = b'' if info.is_dir() else (deploy / info.filename).read_bytes()
                    if not info.is_dir() and data != z.read(info):
                        changed.add(info.filename)
                    row = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                    row.create_system = 3
                    row.external_attr = ((stat.S_IFDIR | 0o755) << 16 | 0x10) if info.is_dir() else ((stat.S_IFREG | 0o644) << 16)
                    row.compress_type = zipfile.ZIP_STORED if info.is_dir() else zipfile.ZIP_DEFLATED
                    target.writestr(row, data)
            need(changed == CHANGED, 'ARCHIVE_DELTA_SCOPE')
            with zipfile.ZipFile(staged) as out:
                after = entries(out)
                need(set(after) == set(before), 'ARCHIVE_PATHS')
                files = dirs = unchanged = 0
                for key, original in before.items():
                    revised = after[key]
                    need(revised.filename == original.filename and revised.is_dir() == original.is_dir(), 'ARCHIVE_PATHS')
                    need((revised.external_attr >> 16) & 0o777 == (0o755 if revised.is_dir() else 0o644), 'DEPLOY_MODE')
                    if revised.is_dir():
                        dirs += 1
                    else:
                        files += 1
                        expected = (deploy / original.filename).read_bytes()
                        need(out.read(revised) == expected, 'ARCHIVE_BYTES')
                        unchanged += original.filename not in CHANGED
                need(files == unchanged + len(CHANGED), 'ARCHIVE_DELTA')
                need(out.testzip() is None, 'ARCHIVE_CRC')
        final_sha = sha_file(staged)
        result = {'status': 'CONFIGURATION_DELTA_WITNESS_ONLY' if witness else 'FINAL_SITE_ZIP_NOT_PRODUCT_ACCEPTED',
                  'buildSite': site, 'buildRun': run,
                  'targetSite': None if witness else FINAL_SITE, 'qualifiedConfigurationDelta': FINAL_SITE,
                  'sourceZipSha256': before_sha, 'sha256': final_sha,
                  'files': files, 'unchangedFiles': unchanged, 'changedFiles': sorted(CHANGED),
                  'directories': dirs, 'fileMode': '0644', 'directoryMode': '0755',
                  'originalPlatformSha256': PLATFORM_SHA, 'previousOfflineVersion': old_version,
                  'offlineVersion': new_version, 'productAccepted': False}
        try:
            os.link(staged, output)
            published.append(output)
            with checksum.open('x') as f:
                published.append(checksum)
                f.write(final_sha + '  ' + output.name + '\n')
            with receipt.open('x') as f:
                published.append(receipt)
                json.dump(result, f, indent=2)
                f.write('\n')
        except Exception:
            for p in published:
                p.unlink(missing_ok=True)
            raise
    return result



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('authenticated_header', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--platform-archive', required=True, type=Path)
    parser.add_argument('--witness', action='store_true', help='Exercise earlier known build; never label it final')
    args = parser.parse_args()
    try:
        print(json.dumps(finalize(args.archive, args.authenticated_header, args.output, args.platform_archive, args.witness), indent=2))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as exc:
        parser.exit(1, f'ARTBAZY_FINALIZATION_FAIL: {exc}\n')
