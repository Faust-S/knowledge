import hashlib
import json
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path
from verify_artbazy_zip import check, git_blob, ENTRIES, KERNEL, SKILLS, MANIFEST, ORIGIN


def sha(b):
    return hashlib.sha256(b).hexdigest()


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.zip = self.root / 'site.zip'
        self.sitemap = self.root / 'sitemap.xml'
        self.catalog = self.root / 'catalog.json'
        self.routes = ['/', '/tools/a/', '/diagnostiki/b/']
        self.xml = ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(
            f'<url><loc>{ORIGIN}{p}</loc></url>' for p in self.routes) + '</urlset>').encode()
        self.sitemap.write_bytes(self.xml)
        self.catalog.write_text(json.dumps({'calculators': [{'route': '/tools/a/'}],
            'methods': [{'route': '/diagnostiki/b/', 'public_service': True}, {'public_service': False}]}))
        self.pages = self.routes + ['/poisk/']
        self.files = {p: b'fixture' for p in ENTRIES}
        self.files.update({'sitemap.xml': self.xml, 'google-proof.html': b'hosting proof'})
        self.files['readability-report.json'] = json.dumps({'total': 4, 'ok': 4, 'fail': 0,
            'routes': [{'route': p.rstrip('/') or '/', 'status': 'ok'} for p in self.pages]}).encode()
        for p in self.pages:
            self.files[p.lstrip('/') + 'index.html'] = (
                f'<html data-artbazy-workspace-results="1"><head><link rel="canonical" href="{ORIGIN}{p}"></head>'
                '<body><h1>Test</h1><div data-iwxa-t3-domain-mode></div><div hidden data-iwxa-domain-assistant data-assistant-dynamic-dom data-assistant-strict-forms data-assistant-label="Консультант ArtBazy"></div>'
                '<script data-artbazy-original-assistant></script></body></html>').encode()
        self.pins = {'indexed': 3, 'calculators': 1, 'methods': 1, 'kernel': sha(self.files[KERNEL]),
                     'sitemap_blob': git_blob(self.sitemap.read_bytes()), 'catalog_blob': git_blob(self.catalog.read_bytes()),
                     'skills': git_blob(self.files[SKILLS]),
                     'delivery_blobs': {p: git_blob(self.files[p]) for p in ('t3-domain-mode.mjs', 't3-sw.js')},
                     'proofs': {'google-proof.html': git_blob(b'hosting proof')}}
        self.manifest = self.make_manifest()

    def make_manifest(self):
        rows = []
        for p, data in sorted(self.files.items()):
            if p in self.pins['proofs'] or p.endswith('.htaccess') or p == MANIFEST:
                continue
            row = {'path': '/' + p, 'bytes': len(data), 'sha256': sha(data)}
            rows.append(row)
            if p.endswith('index.html'):
                rows.append({**row, 'path': row['path'][:-10], 'source': row['path']})
        return {'schema': 'iwxa.t3.domain-offline/1', 'domain_origin': ORIGIN,
                'complete_static_tree': True, 'files': rows, 'total_bytes': sum(r['bytes'] for r in rows),
                'version': sha('\n'.join('\0'.join((r['path'], r.get('source', ''), r['sha256'], str(r['bytes']))) for r in rows).encode())}

    def write(self, update_manifest=False, duplicate=False):
        if update_manifest:
            self.manifest = self.make_manifest()
        with zipfile.ZipFile(self.zip, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for p, data in self.files.items():
                z.writestr(p, data)
            z.writestr(MANIFEST, json.dumps(self.manifest))
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    z.writestr('index.html', b'duplicate')
        Path(str(self.zip) + '.sha256').write_text(sha(self.zip.read_bytes()) + '  site.zip\n')

    def check(self):
        return check(self.zip, self.sitemap, self.catalog, self.pins)

    def reject(self, code, update_manifest=False, duplicate=False):
        self.write(update_manifest, duplicate)
        with self.assertRaisesRegex(ValueError, code):
            self.check()

    def test_good(self):
        self.write()
        r = self.check()
        self.assertEqual((r['indexed_pages'], r['public_pages'], r['service_routes']), (3, 4, 2))
        self.assertFalse(r['productAccepted'])

    def test_checksum(self):
        self.write()
        Path(str(self.zip) + '.sha256').write_text('0' * 64 + '  site.zip\n')
        with self.assertRaisesRegex(ValueError, 'ZIP_CHECKSUM'):
            self.check()

    def test_missing_search(self):
        del self.files['poisk/index.html']
        self.reject('MISSING_ENTRY:poisk/index.html')

    def test_incomplete_sitemap(self):
        self.files['sitemap.xml'] = self.xml.replace(b'<url><loc>https://artbazy.ru/tools/a/</loc></url>', b'')
        self.reject('SITEMAP_ROUTE_SET', True)

    def test_invalid_canonical(self):
        self.files['tools/a/index.html'] = self.files['tools/a/index.html'].replace(b'/tools/a/', b'/tools/c/')
        self.reject('CANONICAL:/tools/a/', True)

    def test_render_report(self):
        report = json.loads(self.files['readability-report.json'])
        report['fail'] = 1
        self.files['readability-report.json'] = json.dumps(report).encode()
        self.reject('PRERENDER_REPORT', True)

    def test_changed_bytes(self):
        self.files[SKILLS] = b'tampered'
        self.reject('OFFLINE_BYTES')

    def test_changed_kernel_consistent_manifest(self):
        self.files[KERNEL] = b'other kernel'
        self.reject('ORIGINAL_KERNEL', True)

    def test_changed_skills_consistent_manifest(self):
        self.files[SKILLS] = b'other skills'
        self.reject('ORIGINAL_SKILLS', True)

    def test_changed_proof(self):
        self.files['google-proof.html'] = b'tampered'
        self.reject('HOSTING_PROOF')

    def test_invalid_alias(self):
        next(r for r in self.manifest['files'] if r.get('source') == '/index.html')['sha256'] = '0' * 64
        self.reject('OFFLINE_ALIAS_BYTES')

    def test_undeclared_file(self):
        self.files['unexpected.txt'] = b'not declared'
        self.reject('UNDECLARED_FILE')

    def test_duplicate_zip_entry(self):
        self.reject('ZIP_ENTRY_NAME', duplicate=True)

    def test_missing_assistant(self):
        self.files['tools/a/index.html'] = self.files['tools/a/index.html'].replace(b'data-iwxa-domain-assistant', b'data-other')
        self.reject('PUBLIC_PAGE:/tools/a/', True)

    def test_obsolete_inline_controls(self):
        self.add_anchors('<div data-iwxa-assistant-context-slot></div>')
        self.reject('LEGACY_INLINE_CONTROLS:', True)

    def test_missing_corner_mount(self):
        self.files['tools/a/index.html'] = self.files['tools/a/index.html'].replace(b'<div hidden data-iwxa-domain-assistant', b'<div data-iwxa-domain-assistant')
        self.reject('CONSULTANT_MOUNT:', True)

    def test_changed_bound_controller_consistent_manifest(self):
        self.files['t3-domain-mode.mjs'] = b'other controller'
        self.reject('ORIGINAL_T3_BOUND_RESOURCE:', True)

    def test_changed_bound_worker_consistent_manifest(self):
        self.files['t3-sw.js'] = b'other worker'
        self.reject('ORIGINAL_T3_BOUND_RESOURCE:', True)

    def add_anchors(self, html):
        self.files['tools/a/index.html'] = self.files['tools/a/index.html'].replace(b'</body>', html.encode() + b'</body>')

    def test_local_anchor_resolution(self):
        self.add_anchors('<a href="/diagnostiki/b/?x=1&amp;y=2#result">A</a>'
                         '<a href="../../poisk/">B</a><a href="#result">C</a>'
                         '<a href="https://artbazy.ru/">D</a><a href="/assets/artbazy-assistant-skills.json">E</a>'
                         '<a href="https://example.org/missing">F</a><a href="mailto:test@example.org">G</a>'
                         '<script>const x = \'<a href="/missing">\';</script>')
        self.write(True)
        report = self.check()
        self.assertEqual(report['local_anchor_occurrences'], 5)
        self.assertEqual(report['local_anchor_pairs'], 5)

    def test_no_slash_offline_target(self):
        self.add_anchors('<a href="/diagnostiki/b?x=1#result">A</a>')
        self.reject('OFFLINE_LINK:/tools/a/->/diagnostiki/b', True)

    def test_missing_offline_asset(self):
        self.add_anchors('<a href="/assets/absent.pdf">A</a>')
        self.reject('OFFLINE_LINK:/tools/a/->/assets/absent.pdf', True)

    def test_legacy_origin(self):
        self.add_anchors('<a href="http://artbazy.ru/diagnostiki/b/">A</a>')
        self.reject('OFFLINE_LINK_ORIGIN:', True)

    def test_www_origin(self):
        self.add_anchors('<a href="https://www.artbazy.ru/">A</a>')
        self.reject('OFFLINE_LINK_ORIGIN:', True)

    def test_source_sitemap_identity(self):
        self.sitemap.write_bytes(self.xml + b'\n')
        self.reject('SOURCE_SITEMAP_IDENTITY')

    def test_source_catalog_identity(self):
        self.catalog.write_bytes(self.catalog.read_bytes() + b'\n')
        self.reject('SOURCE_CATALOG_IDENTITY')


if __name__ == '__main__':
    unittest.main()
