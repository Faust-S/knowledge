"""Read-only acceptance of the delivered ArtBazy ZIP, without rebuilding it."""
import argparse
import hashlib
import json
import re
import stat
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit

ORIGIN = 'https://artbazy.ru'
PINS = {
    'indexed': 847, 'calculators': 447, 'methods': 49,
    'sitemap_blob': '26f00b6f0d3e4354af0002e985574edb8da7535d',
    'catalog_blob': 'd0dc8fe262c446d1b7c6e54b3137f0d19d8b2d92',
    'kernel': 'e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78',
    'skills': '9e863df7c46b0b66c1d9ff9bcbd7ec240b469d8f',
    'proofs': {'google16dce79d77367d6f.html': 'e00d88abdf9eac6d343e8f90163f165886f5034e',
               'yandex_95e23e45501e02eb.html': '98101d34a80c463b6ad8c7e2a7feb5cbc51f020c'},
}
SITE_COMMIT = '8b6ae98c6d596017086626b8961fd356d7d2c13e'
KERNEL = '_iwxa/runtime/0.3.6/runtime.js'
SKILLS = 'assets/artbazy-assistant-skills.json'
MANIFEST = 't3-offline-manifest.json'
ENTRIES = ('404.html', '.htaccess', 'workspace/.htaccess', 'workspace/index.html',
           'workspace/exchange/index.html', 'workspace/lifecycle/index.html',
           'workspace/studio/index.html', 't3-sw.js', 't3-domain-mode.mjs',
           't3-app-manifest.json', 'assets/artbazy-t3-tools.css', KERNEL, SKILLS)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(stream, algorithm='sha256'):
    h = hashlib.new(algorithm)
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def git_blob(data):
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()


def safe_name(name):
    return (bool(name) and not name.startswith('/') and not any(c in name for c in '\\:\x00?#')
            and all(p not in ('', '.', '..') for p in name.split('/')))


def routes(xml):
    paths = []
    for loc in ET.fromstring(xml).iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc'):
        url = loc.text or ''
        require(re.fullmatch(re.escape(ORIGIN) + r'/(?:[a-z0-9-]+/)*', url), 'SITEMAP_URL')
        paths.append(url[len(ORIGIN):])
    require(bool(paths) and len(paths) == len(set(paths)), 'SITEMAP_DUPLICATE_OR_EMPTY')
    return set(paths)


class LocalAnchors(HTMLParser):
    """Audit actual anchor destinations, not text that looks like HTML."""
    def __init__(self, route):
        super().__init__(convert_charrefs=True)
        self.route = route
        self.paths = set()
        self.count = 0

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        href = next((value for name, value in attrs if name == 'href'), None)
        if href is None:
            return
        target = urlsplit(urljoin(ORIGIN + self.route, href))
        if target.scheme not in ('http', 'https') or target.hostname not in ('artbazy.ru', 'www.artbazy.ru'):
            return
        require(target.scheme == 'https' and target.netloc == 'artbazy.ru',
                'OFFLINE_LINK_ORIGIN:' + self.route + '->' + target.netloc)
        self.count += 1
        self.paths.add(target.path or '/')


def source_bytes(value):
    return value if isinstance(value, bytes) else Path(value).read_bytes()


def check(zip_path, source_sitemap, catalog, pins=PINS):
    zip_path = Path(zip_path)
    with zip_path.open('rb') as stream:
        checksum = digest(stream)
    require(Path(str(zip_path) + '.sha256').read_text().strip() == checksum + '  ' + zip_path.name,
            'ZIP_CHECKSUM')
    sitemap_bytes, catalog_bytes = source_bytes(source_sitemap), source_bytes(catalog)
    require(git_blob(sitemap_bytes) == pins['sitemap_blob'], 'SOURCE_SITEMAP_IDENTITY')
    require(git_blob(catalog_bytes) == pins['catalog_blob'], 'SOURCE_CATALOG_IDENTITY')
    expected = routes(sitemap_bytes)
    require(len(expected) == pins['indexed'] and '/poisk/' not in expected, 'SOURCE_SITEMAP_COUNT')
    registry = json.loads(catalog_bytes)
    calculators = registry['calculators']
    methods = [m for m in registry['methods'] if m.get('public_service') is True]
    service_routes = {r['route'] for r in calculators + methods}
    require(len(calculators) == pins['calculators'] and len(methods) == pins['methods']
            and len(service_routes) == len(calculators) + len(methods)
            and service_routes <= expected, 'SOURCE_CATALOG')
    with zipfile.ZipFile(zip_path) as z:
        files = {}
        seen = set()
        for info in z.infolist():
            name = info.filename.removeprefix('./').rstrip('/')
            if not name and info.is_dir():
                continue
            require(safe_name(name) and name.casefold() not in seen, 'ZIP_ENTRY_NAME')
            seen.add(name.casefold())
            require(not stat.S_ISLNK(info.external_attr >> 16), 'ZIP_SYMLINK')
            if not info.is_dir():
                files[name] = info
        def read(name):
            require(name in files, 'MISSING_ENTRY:' + name)
            return z.read(files[name])
        require(routes(read('sitemap.xml')) == expected, 'SITEMAP_ROUTE_SET')
        page_routes = expected | {'/poisk/'}
        report = json.loads(read('readability-report.json'))
        observed = [r['route'].rstrip('/') + '/' for r in report['routes']]
        require(report['total'] == len(page_routes) == report['ok'] and report['fail'] == 0
                and len(observed) == len(set(observed)) == len(page_routes)
                and set(observed) == page_routes and all(r['status'] == 'ok' for r in report['routes']),
                'PRERENDER_REPORT')
        anchors = {}
        anchor_count = 0
        for route in sorted(page_routes):
            html = read(route.lstrip('/') + 'index.html').decode('utf-8')
            require('<h1' in html.lower() and 'data-artbazy-workspace-results="1"' in html
                    and 'data-iwxa-t3-domain-mode' in html
                    and html.count('data-artbazy-original-assistant') == 1
                    and html.count('data-iwxa-domain-assistant') == 1, 'PUBLIC_PAGE:' + route)
            require(re.search(r'<link\b[^>]*\brel=[\"\']canonical[\"\'][^>]*\bhref=[\"\']'
                              + re.escape(ORIGIN + route) + r'[\"\']', html, re.I), 'CANONICAL:' + route)
            parser = LocalAnchors(route)
            parser.feed(html)
            parser.close()
            anchors[route] = parser.paths
            anchor_count += parser.count
        for path in ENTRIES:
            require(path in files, 'MISSING_ENTRY:' + path)
        manifest = json.loads(read(MANIFEST))
        require(manifest['schema'] == 'iwxa.t3.domain-offline/1' and manifest['domain_origin'] == ORIGIN
                and manifest['complete_static_tree'] is True, 'OFFLINE_MANIFEST')
        physical = {}
        aliases = []
        paths = set()
        version = []
        total = 0
        for row in manifest['files']:
            path = row['path']
            source = row.get('source', path)
            require(path.startswith('/') and path not in paths and source.startswith('/')
                    and safe_name(source[1:]) and source[1:] in files
                    and source[1:] not in pins['proofs'] and source[1:] != MANIFEST,
                    'OFFLINE_PATH')
            paths.add(path)
            require(type(row['bytes']) is int and row['bytes'] >= 0
                    and re.fullmatch(r'[0-9a-f]{64}', row['sha256']), 'OFFLINE_ROW')
            identity = (row['bytes'], row['sha256'])
            if 'source' in row:
                require(path.endswith('/') and source == path + 'index.html', 'OFFLINE_ALIAS')
                aliases.append((source, identity))
            else:
                with z.open(files[source[1:]]) as stream:
                    require(files[source[1:]].file_size == row['bytes']
                            and digest(stream) == row['sha256'], 'OFFLINE_BYTES:' + source)
                physical[source] = identity
            version.append('\0'.join((path, row.get('source', ''), row['sha256'], str(row['bytes']))))
            total += row['bytes']
        require(all(physical.get(source) == identity for source, identity in aliases), 'OFFLINE_ALIAS_BYTES')
        require(manifest['version'] == hashlib.sha256('\n'.join(version).encode()).hexdigest()
                and manifest['total_bytes'] == total, 'OFFLINE_IDENTITY')
        require(page_routes <= paths and '/' + SKILLS in physical and '/' + KERNEL in physical,
                'OFFLINE_PUBLIC_COVERAGE')
        for route, targets in anchors.items():
            missing = targets - paths
            require(not missing, 'OFFLINE_LINK:' + route + '->' + min(missing, default=''))
        require(all('/' + p in physical or p == MANIFEST or p in pins['proofs']
                    or PurePosixPath(p).name == '.htaccess' for p in files), 'UNDECLARED_FILE')
        require(physical['/' + KERNEL][1] == pins['kernel'], 'ORIGINAL_KERNEL')
        require(git_blob(read(SKILLS)) == pins['skills'], 'ORIGINAL_SKILLS')
        for path, blob in pins['proofs'].items():
            require(git_blob(read(path)) == blob, 'HOSTING_PROOF:' + path)
        return {'status': 'DELIVERED_ZIP_STATIC_PASS_NOT_PRODUCT_ACCEPTED', 'sha256': checksum,
                'indexed_pages': len(expected), 'public_pages': len(page_routes),
                'service_routes': len(service_routes), 'offline_resources': len(paths),
                'local_anchor_occurrences': anchor_count,
                'local_anchor_pairs': sum(len(targets) for targets in anchors.values()),
                'zip_files': len(files), 'productAccepted': False}


def checkout_inputs(checkout):
    def git(*args):
        return subprocess.check_output(['git', '-C', checkout, *args], stderr=subprocess.DEVNULL)
    # Read tracked bytes at the exact candidate, not potentially modified working files.
    return (git('show', SITE_COMMIT + ':public/sitemap.xml'),
            git('show', SITE_COMMIT + ':runtime/artbazy-module/service-catalog.json'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip')
    parser.add_argument('source_sitemap', nargs='?')
    parser.add_argument('source_catalog', nargs='?')
    parser.add_argument('--site-checkout', help='Local ArtBazy.ru Git checkout containing the pinned commit')
    args = parser.parse_args()
    if bool(args.site_checkout) == bool(args.source_sitemap or args.source_catalog):
        parser.error('choose --site-checkout OR both source file paths')
    if not args.site_checkout and not (args.source_sitemap and args.source_catalog):
        parser.error('both source file paths required')
    try:
        source_inputs = checkout_inputs(args.site_checkout) if args.site_checkout else (args.source_sitemap, args.source_catalog)
        print(json.dumps(check(args.zip, *source_inputs), indent=2))
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, ET.ParseError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'ARTBAZY_DELIVERY_FAIL: {exc}\n')
