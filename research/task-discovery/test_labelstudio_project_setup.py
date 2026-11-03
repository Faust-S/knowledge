"""End-to-end local HTTP transport tests; synthetic data, never human gold."""
from __future__ import annotations

import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import labelstudio_project_setup as ls


def fixture():
    items, tasks = [], []
    for i in range(8):
        repo, num = 'synthetic/example', i + 100
        title = f'Case {num}'
        body = f'Text of synthetic case {i}.\n'
        raw = (title + '\n' + body + '\n').encode('utf-8')
        hashref = ls.digest(raw)
        row = {'repository': repo, 'issue_number': num,
               'html_url': f'https://github.com/{repo}/issues/{num}',
               'projection_sha256': hashref.removeprefix('sha256:'),
               'projection_bytes': len(raw),
               'updated_at': '2026-11-03T11:22:00Z',
               'created_at': '2026-11-03T10:00:00Z'}
        items.append(row)
        tasks.append({'data': {
            'source_text': raw.decode(), 'source_sha256': hashref,
            'source_text_sha256': hashref,
            'source_text_origin': 'ORIGINAL_UTF8_TEXT_BYTES',
            'source_docx_main_xml_sha256': None,
            'source_paragraph_locators': [],
            'source_ref': row['html_url'],
            'source_edition': row['updated_at'],
            'source_as_of': '2026-11-03',
            'selection_sha256': 'sha256:' + 'f' * 64}})
    return ({'schema': 'IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1',
             'no_gold': True, 'items': items}, tasks)


CONFIG = b'''<View><Text name="source_text" value="$source_text"/>
<Labels name="taskness" toName="source_text"/>
<Choices name="review_coverage" toName="source_text"/>
<TextArea name="goal" toName="source_text"/>
<TextArea name="expected_result" toName="source_text"/>
<TextArea name="acceptance_criterion" toName="source_text"/>
</View>'''


class FakeLabelStudio(BaseHTTPRequestHandler):
    projects = {}
    next_id = 1
    partial = False

    def log_message(self, format, *args):
        pass

    def response(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        assert self.headers['Authorization'] == 'Token synthetic-key'
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        cls = type(self)
        if self.path == '/api/projects/':
            ident = cls.next_id
            cls.next_id += 1
            cls.projects[ident] = {'config': data['label_config'], 'title': data['title'], 'tasks': []}
            self.response({'id': ident, 'config_has_control_tags': True}, 201)
        elif self.path.endswith('/import?return_task_ids=true'):
            ident = int(self.path.split('/')[3])
            cls.projects[ident]['tasks'] = data
            self.response({'task_count': len(data), 'task_ids': list(range(8))}, 201)
        else:
            self.response({'message': 'unknown'}, 404)

    def do_GET(self):
        assert self.headers['Authorization'] == 'Token synthetic-key'
        if self.path.endswith('/export?exportType=JSON&download_all_tasks=true'):
            ident = int(self.path.split('/')[3])
            original = type(self).projects[ident]['tasks']
            if type(self).partial:
                original = original[:7]
            self.response([{**x, 'annotations': [], 'predictions': []} for x in original])
        else:
            self.response({'message': 'unknown'}, 404)


class LocalLabelStudioSetupTests(unittest.TestCase):
    def test_valid_frozen_input_and_exact_owner_config(self):
        manifest, tasks = fixture()
        self.assertEqual(ls.validate_import(tasks, manifest), tasks)
        self.assertIn('TextArea', ls.validate_owner_xml(
            CONFIG, expected_blob=ls.git_blob(CONFIG)))
        self.assertEqual(ls.digest(tasks[0]['data']['source_text'].encode('utf-8')),
                         tasks[0]['data']['source_sha256'])
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / 'manifest.json'
            p.write_text(json.dumps(manifest), encoding='utf-8')
            self.assertEqual(ls.load_manifest(p, expected_git_blob=ls.git_blob(p.read_bytes())), manifest)

    def test_creates_two_local_projects_and_reads_back_all_eight(self):
        manifest, tasks = fixture()
        ls.validate_import(tasks, manifest)
        FakeLabelStudio.projects = {}
        FakeLabelStudio.next_id = 1
        FakeLabelStudio.partial = False
        server = ThreadingHTTPServer(('127.0.0.1', 0), FakeLabelStudio)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = ls.create_projects(tasks, CONFIG.decode('utf-8'),
                f'http://127.0.0.1:{server.server_port}', 'synthetic-key', slots=2)
            self.assertEqual(result['project_ids'], [1, 2])
            self.assertEqual(result['sources_per_project'], 8)
            self.assertFalse(result['human_gold'])
            self.assertEqual(result['human_reviews_completed'], 0)
            self.assertEqual(len(FakeLabelStudio.projects), 2)
            for project in FakeLabelStudio.projects.values():
                self.assertIn('review_coverage', project['config'])
                self.assertLessEqual(len(project['title']), 50)
                self.assertEqual(len(project['tasks']), 8)
                self.assertFalse(any('predictions' in task for task in project['tasks']))
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_partial_readback_fails_and_reports_only_created_id(self):
        _, tasks = fixture()
        FakeLabelStudio.projects = {}
        FakeLabelStudio.next_id = 1
        FakeLabelStudio.partial = True
        server = ThreadingHTTPServer(('127.0.0.1', 0), FakeLabelStudio)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(ls.SetupHold, 'LABEL_STUDIO_READBACK_INCOMPLETE') as err:
                ls.create_projects(tasks, CONFIG.decode('utf-8'),
                    f'http://127.0.0.1:{server.server_port}', 'synthetic-key')
            self.assertEqual(err.exception.created_project_ids, (1,))
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_rejects_modified_source_or_leaky_prediction(self):
        manifest, tasks = fixture()
        modified = copy.deepcopy(tasks)
        modified[0]['data']['source_text'] += 'changed'
        with self.assertRaisesRegex(ls.SetupHold, 'SOURCE_FIRST_IMPORT_SOURCE_MISMATCH'):
            ls.validate_import(modified, manifest)
        modified = copy.deepcopy(tasks)
        modified[0]['predictions'] = []
        with self.assertRaisesRegex(ls.SetupHold, 'SOURCE_FIRST_IMPORT_HAS_NON_SOURCE_FIELDS'):
            ls.validate_import(modified, manifest)
        modified = copy.deepcopy(tasks)
        modified[0]['data']['selection_sha256'] = 'sha256:' + 'e' * 64
        with self.assertRaisesRegex(ls.SetupHold, 'SOURCE_FIRST_IMPORT_SELECTION_MISMATCH'):
            ls.validate_import(modified, manifest)

    def test_refuses_remote_servers_and_generic_e5_xml(self):
        for url in ('https://127.0.0.1:8080', 'http://labelstud.io',
                    'http://127.0.0.1:8080/remote', 'http://user:pass@localhost:8080'):
            with self.subTest(url=url), self.assertRaisesRegex(ls.SetupHold,
                                            'OWNER_LOCAL_LABEL_STUDIO_URL_REQUIRED'):
                ls.local_url(url)
        minimal = CONFIG.replace(b'<TextArea name="goal" toName="source_text"/>', b'')
        with self.assertRaisesRegex(ls.SetupHold,
                                    'TASK_EXP_TASK_INTERPRETATION_CONTROLS_MISSING'):
            ls.validate_owner_xml(minimal, expected_blob=ls.git_blob(minimal))


if __name__ == '__main__':
    unittest.main()
