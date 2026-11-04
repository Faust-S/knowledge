"""Label Studio Personal Access Token HTTP compatibility: no real secrets."""
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest
from unittest.mock import patch

import labelstudio_project_setup as target


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, size):
        return self.payload


class AuthCompatibilityTests(unittest.TestCase):
    def test_legacy_returns_token_without_refresh(self):
        with patch.object(target, "local_api_open") as opened:
            credential = target.resolve_api_credential(
                "http://127.0.0.1:8080", "legacy-example", "legacy")
            self.assertEqual(credential, "Token legacy-example")
            opened.assert_not_called()

    def test_personal_refresh_then_bearer_request(self):
        requests = []

        def request(req, timeout):
            requests.append(req)
            if req.full_url.endswith("/api/token/refresh/"):
                self.assertEqual(json.loads(req.data), {"refresh": "personal-example"})
                self.assertIsNone(req.get_header("Authorization"))
                return FakeResponse(b'{"access":"short-lived-example"}')
            self.assertEqual(req.get_header("Authorization"), "Bearer short-lived-example")
            return FakeResponse(b'{"id":7}')

        with patch.object(target, "local_api_open", side_effect=request):
            token = target.resolve_api_credential(
                "http://127.0.0.1:8080", "personal-example", "personal")
            self.assertEqual(token, "Bearer short-lived-example")
            answer = target.api("http://127.0.0.1:8080", token, "/api/projects/7/")
            self.assertEqual(answer["id"], 7)
        self.assertEqual(len(requests), 2)

    def test_bad_refresh_response_fails_without_logging_secret(self):
        for payload in (b'{}', b'{"access":null}', b'{"access":"bad\\nvalue"}',
                        b'not-json'):
            with self.subTest(payload=payload), patch.object(
                    target, "local_api_open", return_value=FakeResponse(payload)):
                with self.assertRaises(target.SetupHold) as caught:
                    target.resolve_api_credential(
                        "http://localhost:8080", "private-example", "personal")
                self.assertNotIn("private-example", str(caught.exception))

    def test_api_and_personal_token_refuse_redirects_without_forwarding_secrets(self):
        forwarded = []

        class Sink(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                forwarded.append(("GET", self.headers.get("Authorization")))
                self.send_response(200)
                self.end_headers()

            def do_POST(self):
                forwarded.append(("POST", self.headers.get("Authorization")))
                self.send_response(200)
                self.end_headers()

        class Redirector(BaseHTTPRequestHandler):
            target = ""

            def log_message(self, *args):
                pass

            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", self.target)
                self.end_headers()

            def do_POST(self):
                self.send_response(307)
                self.send_header("Location", self.target)
                self.end_headers()

        sink = ThreadingHTTPServer(("127.0.0.1", 0), Sink)
        Redirector.target = f"http://127.0.0.1:{sink.server_port}/capture"
        redirect = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        threads = [Thread(target=server.serve_forever, daemon=True)
                   for server in (sink, redirect)]
        for thread in threads:
            thread.start()
        try:
            base = f"http://127.0.0.1:{redirect.server_port}"
            with self.assertRaisesRegex(target.SetupHold, "LABEL_STUDIO_HTTP_302"):
                target.api(base, "private-local-token", "/api/projects/7/")
            with self.assertRaisesRegex(
                    target.SetupHold, "LABEL_STUDIO_PERSONAL_TOKEN_HTTP_307"):
                target.resolve_api_credential(base, "private-refresh-token", "personal")
            self.assertEqual(forwarded, [], "Redirect receiver must see zero requests")
        finally:
            for server in (sink, redirect):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join(timeout=2)

    def test_isolated_preflight_accepts_distinct_ids_and_denied_cross_auth(self):
        calls = []
        def fake(base, token, route):
            self.assertEqual(route, "/api/current-user/whoami")
            calls.append((base, token))
            authorized = {
                ("http://127.0.0.1:8080", "Token first"): 11,
                ("http://127.0.0.1:8081", "Token second"): 12,
            }
            if (base, token) not in authorized:
                raise target.SetupHold("LABEL_STUDIO_HTTP_401")
            return {"id": authorized[(base, token)], "active_organization": 1}

        receipt = target.verify_isolated_reviewers(
            "http://127.0.0.1:8080", "Token first",
            "http://127.0.0.1:8081", "Token second", call=fake)
        self.assertEqual(len(calls), 4)
        self.assertTrue(receipt["cross_instance_credentials_rejected"])
        self.assertTrue(receipt["reviewer_id_claims_distinct"])
        self.assertFalse(receipt["platform_storage_isolation_verified"])
        self.assertFalse(receipt["human_gold"])
        self.assertNotIn("first", json.dumps(receipt))
        self.assertNotIn("second", json.dumps(receipt))

    def test_isolated_preflight_rejects_numeric_reviewer_collision(self):
        calls = []
        def fake(base, token, route):
            calls.append((base, token))
            return {"id": 1, "active_organization": 1}
        with self.assertRaisesRegex(
                target.SetupHold, "ISOLATED_NATIVE_REVIEWER_IDS_COLLIDE"):
            target.verify_isolated_reviewers(
                "http://127.0.0.1:8080", "Token first",
                "http://127.0.0.1:8081", "Token second", call=fake)
        self.assertEqual(len(calls), 2, "Collision must refuse before probe")

    def test_isolated_preflight_rejects_cross_readable_users(self):
        def fake(base, credential, route):
            return {"id": 11 if base.endswith(":8080") else 12,
                    "active_organization": 1}
        with self.assertRaisesRegex(
                target.SetupHold, "ISOLATED_REVIEW_CROSS_ACCOUNT_ACCESSIBLE"):
            target.verify_isolated_reviewers(
                "http://127.0.0.1:8080", "Token first",
                "http://127.0.0.1:8081", "Token second", call=fake)

    def test_isolated_preflight_refuses_uncertain_cross_access(self):
        def fake(base, credential, route):
            if ((base.endswith(":8080") and credential == "Token second")
                    or (base.endswith(":8081") and credential == "Token first")):
                raise target.SetupHold("LOCAL_LABEL_STUDIO_UNAVAILABLE")
            return {"id": 11 if base.endswith(":8080") else 12,
                    "active_organization": 1}
        with self.assertRaisesRegex(
                target.SetupHold, "ISOLATED_REVIEW_CROSS_AUTH_NOT_PROVEN"):
            target.verify_isolated_reviewers(
                "http://127.0.0.1:8080", "Token first",
                "http://127.0.0.1:8081", "Token second", call=fake)

    def test_isolated_preflight_rejects_same_port_or_reused_credential(self):
        for url_b in ("http://localhost:8080", "http://127.0.0.1:8080"):
            with self.subTest(url=url_b), self.assertRaisesRegex(
                    target.SetupHold, "ISOLATED_REVIEW_REQUIRES_DISTINCT_LOCAL_PORTS"):
                target.verify_isolated_reviewers(
                    "http://127.0.0.1:8080", "Token first",
                    url_b, "Token second", call=lambda *args: None)
        with self.assertRaisesRegex(
                target.SetupHold, "ISOLATED_REVIEW_CREDENTIALS_INVALID_OR_REUSED"):
            target.verify_isolated_reviewers(
                "http://127.0.0.1:8080", "Token reused",
                "http://127.0.0.1:8081", "Token reused", call=lambda *args: None)

    def test_api_refuses_ambiguous_server_json(self):
        samples = (
            (b'{"id":1,"id":2}', "LABEL_STUDIO_RESPONSE_DUPLICATE_KEY"),
            (b'{"annotations":[{"completed_by":1,"completed_by":2}]}',
             "LABEL_STUDIO_RESPONSE_DUPLICATE_KEY"),
            (b'{"id":NaN}', "LABEL_STUDIO_RESPONSE_NONFINITE_NUMBER"),
            (b'{"id":Infinity}', "LABEL_STUDIO_RESPONSE_NONFINITE_NUMBER"),
            (b'{"id":-Infinity}', "LABEL_STUDIO_RESPONSE_NONFINITE_NUMBER"),
            (b'{"id":', "LABEL_STUDIO_RESPONSE_JSON_INVALID"),
            (b'{"id":"\xff"}', "LABEL_STUDIO_RESPONSE_JSON_INVALID"),
        )
        for payload, error in samples:
            with self.subTest(error=error), patch.object(
                    target, "local_api_open", return_value=FakeResponse(payload)):
                with self.assertRaisesRegex(target.SetupHold, error) as caught:
                    target.api("http://127.0.0.1:8080", "synthetic",
                               "/api/projects/7/")
                self.assertNotIn("synthetic", str(caught.exception))

    def test_personal_refresh_fails_closed_on_ambiguous_json(self):
        for payload in (
                b'{"access":"first","access":"second"}',
                b'{"access":NaN}', b'{"access":1e999}'):
            with self.subTest(payload=payload), patch.object(
                    target, "local_api_open", return_value=FakeResponse(payload)):
                # The existing refresh boundary deliberately normalizes all
                # malformed JSON into a single non-secret refusal code.
                with self.assertRaisesRegex(
                        target.SetupHold, "LABEL_STUDIO_PERSONAL_TOKEN_RESPONSE_INVALID"):
                    target.resolve_api_credential(
                        "http://127.0.0.1:8080", "synthetic", "personal")

    def test_existing_owner_local_json_rejection_codes_preserved(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.json"
            for payload, code in (
                    (b'{"data":1,"data":2}', "LOCAL_INPUT_DUPLICATE_KEY"),
                    (b'{"data":NaN}', "LOCAL_INPUT_NONFINITE_NUMBER"),
                    (b'{"data":', "LOCAL_INPUT_JSON_INVALID")):
                path.write_bytes(payload)
                with self.subTest(code=code), self.assertRaisesRegex(
                        target.SetupHold, code):
                    target.read_json(path)

    def test_remote_refresh_refused(self):
        with patch.object(target, "local_api_open") as opened:
            with self.assertRaisesRegex(target.SetupHold,
                                        "OWNER_LOCAL_LABEL_STUDIO_URL_REQUIRED"):
                target.resolve_api_credential(
                    "http://remote.example:8080", "personal-example", "personal")
            opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
