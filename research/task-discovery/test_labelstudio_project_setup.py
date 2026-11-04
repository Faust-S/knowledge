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
    form_modified = False

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
        if self.path.startswith('/api/projects/') and self.path.endswith('/') and (
                not self.path.endswith('/export/')):
            ident = int(self.path.split('/')[3])
            config = type(self).projects[ident]['config']
            if type(self).form_modified:
                config = config.replace('review_coverage', 'wrong_control')
            self.response({'id': ident, 'label_config': config})
        elif self.path.endswith('/export?exportType=JSON&download_all_tasks=true'):
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
        FakeLabelStudio.form_modified = False
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

    def test_default_creates_one_project_for_isolated_reviewer(self):
        _, tasks = fixture()
        FakeLabelStudio.projects = {}
        FakeLabelStudio.next_id = 1
        FakeLabelStudio.partial = False
        FakeLabelStudio.form_modified = False
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeLabelStudio)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            receipt = ls.create_projects(
                tasks, CONFIG.decode("utf-8"),
                f"http://127.0.0.1:{server.server_port}", "synthetic-key")
            self.assertEqual(receipt["reviewer_slots"], 1)
            self.assertEqual(receipt["project_ids"], [1])
            self.assertEqual(len(FakeLabelStudio.projects), 1)
            self.assertFalse(receipt["human_gold"])
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


    def test_persisted_form_mismatch_refused_before_import(self):
        _, tasks = fixture()
        FakeLabelStudio.projects = {}
        FakeLabelStudio.next_id = 1
        FakeLabelStudio.form_modified = True
        FakeLabelStudio.partial = False
        server = ThreadingHTTPServer(('127.0.0.1', 0), FakeLabelStudio)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(
                    ls.SetupHold, 'LABEL_STUDIO_SAVED_REVIEW_FORM_CHANGED') as err:
                ls.create_projects(tasks, CONFIG.decode('utf-8'),
                    f'http://127.0.0.1:{server.server_port}', 'synthetic-key')
            self.assertEqual(err.exception.created_project_ids, (1,))
            self.assertEqual(FakeLabelStudio.projects[1]['tasks'], [])
        finally:
            FakeLabelStudio.form_modified = False
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_isolated_preflight_reads_both_forms_and_rejects_cross_access(self):
        _, tasks = fixture()
        calls = []
        def respond(base, token, route, body=None):
            calls.append((base, token, route))
            good = (base.endswith(":8080") and token == "Token account-a") or (
                    base.endswith(":8081") and token == "Token account-b")
            if not good:
                raise ls.SetupHold("LABEL_STUDIO_HTTP_403")
            if route == "/api/current-user/whoami":
                return {"id": 10 if base.endswith(":8080") else 11}
            pid = 40 if base.endswith(":8080") else 50
            if route == f"/api/projects/{pid}/":
                return {"id": pid, "label_config": CONFIG.decode("utf-8")}
            if route == f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true":
                return [{**copy.deepcopy(t), "predictions": [], "annotations": []}
                        for t in tasks]
            raise AssertionError("unexpected API route")
        receipt = ls.isolated_review_preflight(
            tasks, CONFIG.decode("utf-8"),
            "http://127.0.0.1:8080", "Token account-a", 40,
            "http://127.0.0.1:8081", "Token account-b", 50,
            call=respond)
        self.assertEqual(receipt["sources_each"], 8)
        self.assertTrue(receipt["cross_instance_identity_and_export_denied"])
        self.assertFalse(receipt["human_gold"])
        self.assertFalse(receipt["human_independence_verified"])
        self.assertEqual(len(calls), 10)
        self.assertNotIn("account-a", json.dumps(receipt))

    def test_isolated_preflight_refuses_cross_instance_project_visibility(self):
        _, tasks = fixture()
        def respond(base, token, route, body=None):
            if token.startswith("Token other") or (
                    (base.endswith(":8080") and token == "Token account-b") or
                    (base.endswith(":8081") and token == "Token account-a")):
                if route == "/api/current-user/whoami":
                    raise ls.SetupHold("LABEL_STUDIO_HTTP_403")
                return [{"data": {}}]
            if route == "/api/current-user/whoami":
                return {"id": 10 if base.endswith(":8080") else 11}
            pid = 40 if base.endswith(":8080") else 50
            if route == f"/api/projects/{pid}/":
                return {"id": pid, "label_config": CONFIG.decode("utf-8")}
            if route == f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true":
                return [{**copy.deepcopy(t), "predictions": [], "annotations": []}
                        for t in tasks]
            raise AssertionError("unexpected route")
        with self.assertRaisesRegex(
                ls.SetupHold, "ISOLATED_REVIEW_CROSS_ACCESS_EXPOSED"):
            ls.isolated_review_preflight(
                tasks, CONFIG.decode("utf-8"),
                "http://127.0.0.1:8080", "Token account-a", 40,
                "http://127.0.0.1:8081", "Token account-b", 50,
                call=respond)

    def test_isolated_preflight_fails_on_form_drift_or_annotated_source(self):
        _, tasks = fixture()
        for fail_kind, code in (
                ("xml", "ISOLATED_REVIEW_SAVED_FORM_MISMATCH"),
                ("annotated", "LABEL_STUDIO_READBACK_NOT_BLIND_OR_CHANGED")):
            def respond(base, token, route, body=None):
                own = (base.endswith(":8080") and token == "Token account-a") or (
                       base.endswith(":8081") and token == "Token account-b")
                if not own:
                    raise ls.SetupHold("LABEL_STUDIO_HTTP_403")
                if route == "/api/current-user/whoami":
                    return {"id": 10 if base.endswith(":8080") else 11}
                pid = 40 if base.endswith(":8080") else 50
                if route == f"/api/projects/{pid}/":
                    xml = CONFIG.decode("utf-8")
                    if fail_kind == "xml" and base.endswith(":8081"):
                        xml = xml.replace("review_coverage", "wrong_control")
                    return {"id": pid, "label_config": xml}
                if route == f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true":
                    values = [{**copy.deepcopy(t), "predictions": [], "annotations": []}
                              for t in tasks]
                    if fail_kind == "annotated" and base.endswith(":8081"):
                        values[0]["annotations"] = [{"completed_by": 11}]
                    return values
                raise AssertionError("unexpected route")
            with self.subTest(fail_kind=fail_kind), self.assertRaisesRegex(ls.SetupHold, code):
                ls.isolated_review_preflight(
                    tasks, CONFIG.decode("utf-8"),
                    "http://127.0.0.1:8080", "Token account-a", 40,
                    "http://127.0.0.1:8081", "Token account-b", 50,
                    call=respond)

    def test_isolated_identity_404_is_not_proof_of_auth_refusal(self):
        def called(base, token, route, body=None):
            if ((base.endswith(":8080") and token == "Token account-b") or
                    (base.endswith(":8081") and token == "Token account-a")):
                raise ls.SetupHold("LABEL_STUDIO_HTTP_404")
            return {"id": 10 if base.endswith(":8080") else 11}
        with self.assertRaisesRegex(
                ls.SetupHold, "ISOLATED_REVIEW_CROSS_AUTH_NOT_PROVEN"):
            ls.verify_isolated_reviewers(
                "http://127.0.0.1:8080", "Token account-a",
                "http://127.0.0.1:8081", "Token account-b", call=called)

    def test_isolated_project_export_404_does_not_qualify_blindness(self):
        _, tasks = fixture()
        def respond(base, token, route, body=None):
            own = (base.endswith(":8080") and token == "Token account-a") or (
                   base.endswith(":8081") and token == "Token account-b")
            if not own:
                if route == "/api/current-user/whoami":
                    raise ls.SetupHold("LABEL_STUDIO_HTTP_403")
                raise ls.SetupHold("LABEL_STUDIO_HTTP_404")
            if route == "/api/current-user/whoami":
                return {"id": 10 if base.endswith(":8080") else 11}
            pid = 40 if base.endswith(":8080") else 50
            if route == f"/api/projects/{pid}/":
                return {"id": pid, "label_config": CONFIG.decode("utf-8")}
            if route == f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true":
                return [{**copy.deepcopy(t), "predictions": [], "annotations": []}
                        for t in tasks]
            raise AssertionError("unexpected route")
        with self.assertRaisesRegex(
                ls.SetupHold, "ISOLATED_REVIEW_CROSS_ACCESS_UNEXPECTED_ERROR"):
            ls.isolated_review_preflight(
                tasks, CONFIG.decode("utf-8"),
                "http://127.0.0.1:8080", "Token account-a", 40,
                "http://127.0.0.1:8081", "Token account-b", 50,
                call=respond)

    def test_owner_local_input_refuses_duplicate_and_nonfinite_json(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "private-import.json"
            for raw, code in (
                    (b'{"data": 1, "data": 2}', "LOCAL_INPUT_DUPLICATE_KEY"),
                    (b'{"data": {"value": 1, "value": 2}}', "LOCAL_INPUT_DUPLICATE_KEY"),
                    (b'{"data": NaN}', "LOCAL_INPUT_NONFINITE_NUMBER"),
                    (b'{"data": Infinity}', "LOCAL_INPUT_NONFINITE_NUMBER"),
                    (b'{"data": 1e999}', "LOCAL_INPUT_NONFINITE_NUMBER"),
                    (b'{"data": -1e999}', "LOCAL_INPUT_NONFINITE_NUMBER"),
                    (b'{"data":', "LOCAL_INPUT_JSON_INVALID"),
                    (b'\\xff', "LOCAL_INPUT_JSON_INVALID")):
                path.write_bytes(raw)
                with self.subTest(raw=raw[:20]), self.assertRaisesRegex(
                        ls.SetupHold, code):
                    ls.read_json(path)
            path.write_bytes(b'{"data": ["original", "source"]}')
            self.assertEqual(ls.read_json(path), {"data": ["original", "source"]})

    def test_owner_local_json_symlink_input_refused(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "private-import.json"
            path.write_bytes(b'{"data": []}')
            alias = Path(td) / "alias.json"
            try:
                alias.symlink_to(path)
            except (OSError, NotImplementedError):
                self.skipTest("OS cannot create symlinks")
            with self.assertRaisesRegex(ls.SetupHold, "LOCAL_INPUT_UNAVAILABLE"):
                ls.read_json(alias)

    def test_isolated_preflight_fails_on_colliding_ids(self):
        _, tasks = fixture()
        def respond(base, token, route, body=None):
            if route == "/api/current-user/whoami":
                return {"id": 10}
            pid = 40 if base.endswith(":8080") else 50
            if route == f"/api/projects/{pid}/":
                return {"id": pid, "label_config": CONFIG.decode("utf-8")}
            if route == f"/api/projects/{pid}/export?exportType=JSON&download_all_tasks=true":
                return [{**copy.deepcopy(t), "predictions": [], "annotations": []}
                        for t in tasks]
            raise AssertionError("unexpected route")
        with self.assertRaisesRegex(ls.SetupHold, "ISOLATED_NATIVE_REVIEWER_IDS_COLLIDE"):
            ls.isolated_review_preflight(
                tasks, CONFIG.decode("utf-8"),
                "http://127.0.0.1:8080", "Token account-a", 40,
                "http://127.0.0.1:8081", "Token account-b", 50,
                call=respond)

    def test_human_cli_refuses_same_server_two_project_workflow(self):
        _, tasks = fixture()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            import_file = root / "labelstudio-import.json"
            owner_xml = root / "owner.xml"
            import_file.write_text(json.dumps(tasks), encoding="utf-8")
            owner_xml.write_bytes(CONFIG)
            cli = [
                "--tasks", str(import_file),
                "--owner-label-config", str(owner_xml),
            ]
            from unittest.mock import patch
            from io import StringIO
            # Check prohibited modes before any credential lookup or API call.
            with patch.object(ls, "load_manifest", return_value=fixture()[0]), \
                 patch.object(ls, "validate_owner_xml", return_value=CONFIG.decode("utf-8")), \
                 patch.object(ls, "resolve_api_credential") as credential, \
                 patch.object(ls, "api") as api_call:
                for arguments, code in (
                    (["--reviewer-slots", "2", "--create-local-projects",
                      "--confirm-local-import"], "M3_TWO_PROJECTS_IN_ONE_CE_NOT_BLIND"),
                    (["--export-reviewed-projects", "--project-a-id", "10",
                      "--project-b-id", "11", "--review-a-out", str(root / "a.json"),
                      "--review-b-out", str(root / "b.json")],
                     "M3_SAME_SERVER_PAIRED_EXPORT_NOT_BLIND")):
                    with self.subTest(arguments=arguments), \
                         patch("sys.argv", ["labelstudio_project_setup.py", *cli, *arguments]), \
                         patch("sys.stdout", new_callable=StringIO) as out:
                        self.assertEqual(ls.main(), 2)
                        self.assertEqual(json.loads(out.getvalue())["code"], code)
                credential.assert_not_called()
                api_call.assert_not_called()

    def test_semantic_form_readback_ignores_whitespace_only(self):
        xml = CONFIG.decode('utf-8')
        self.assertTrue(ls.same_review_form(xml, xml))
        self.assertTrue(ls.same_review_form(xml, xml.replace(
            '<Text ', '\n  <Text ')))
        self.assertFalse(ls.same_review_form(xml, xml.replace(
            'acceptance_criterion', 'wrong_field')))
        self.assertFalse(ls.same_review_form(xml, '<View>'))
        self.assertFalse(ls.same_review_form(xml, None))


if __name__ == '__main__':
    unittest.main()
