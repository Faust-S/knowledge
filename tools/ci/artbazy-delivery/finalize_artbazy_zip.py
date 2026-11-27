"""Apply the qualified hosting-only revision to an authenticated ArtBazy build.
No source reconstruction, bundle edits, new offline manifest or deployment.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
import zipfile
from pathlib import Path

BUILD_SITE = 'a6ad6a7a90d97e04a931c8f33598373a5336c1a2'
FINAL_SITE = '91ce9dc83a0836eb4e40a2c2746e647588413713'
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


def finalize(archive, header, output, witness=False):
    archive, header, output = map(Path, (archive, header, output))
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
            manifest = json.loads(z.read('t3-offline-manifest.json'))
            need(manifest['complete_static_tree'] is True and manifest['domain_origin'] == 'https://artbazy.ru', 'MANIFEST')
            need(all(PureName(r.get('source', r['path'])) != '.htaccess' for r in manifest['files']), 'APACHE_MANIFEST_SCOPE')
            new_apache = fix_apache(z.read('.htaccess'))
            with zipfile.ZipFile(staged, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
                for info in z.infolist():
                    data = new_apache if info.filename == '.htaccess' else z.read(info)
                    row = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                    row.create_system = 3
                    row.external_attr = ((stat.S_IFDIR | 0o755) << 16 | 0x10) if info.is_dir() else ((stat.S_IFREG | 0o644) << 16)
                    row.compress_type = zipfile.ZIP_STORED if info.is_dir() else zipfile.ZIP_DEFLATED
                    target.writestr(row, data)
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
                        expected = new_apache if key == '.htaccess' else z.read(original)
                        need(out.read(revised) == expected, 'ARCHIVE_BYTES')
                        unchanged += key != '.htaccess'
                need(files == unchanged + 1, 'ARCHIVE_DELTA')
                need(out.testzip() is None, 'ARCHIVE_CRC')
        final_sha = sha_file(staged)
        result = {'status': 'HOSTING_DELTA_WITNESS_ONLY' if witness else 'FINAL_SITE_ZIP_NOT_PRODUCT_ACCEPTED',
                  'buildSite': site, 'buildRun': run,
                  'targetSite': None if witness else FINAL_SITE, 'qualifiedHostingDelta': FINAL_SITE,
                  'sourceZipSha256': before_sha, 'sha256': final_sha,
                  'files': files, 'unchangedFiles': unchanged, 'changedFiles': ['.htaccess'],
                  'directories': dirs, 'fileMode': '0644', 'directoryMode': '0755',
                  'offlineManifestUnchanged': True, 'productAccepted': False}
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


def PureName(path):
    return path.rstrip('/').rsplit('/', 1)[-1]


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('authenticated_header', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--witness', action='store_true', help='Exercise earlier known build; never label it final')
    args = parser.parse_args()
    try:
        print(json.dumps(finalize(args.archive, args.authenticated_header, args.output, args.witness), indent=2))
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as exc:
        parser.exit(1, f'ARTBAZY_FINALIZATION_FAIL: {exc}\n')
