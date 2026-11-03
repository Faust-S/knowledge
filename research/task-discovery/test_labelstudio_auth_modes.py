"""Label Studio Personal Access Token HTTP compatibility: no real secrets."""
import io
import json
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
        with patch.object(target, "urlopen") as opened:
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

        with patch.object(target, "urlopen", side_effect=request):
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
                    target, "urlopen", return_value=FakeResponse(payload)):
                with self.assertRaises(target.SetupHold) as caught:
                    target.resolve_api_credential(
                        "http://localhost:8080", "private-example", "personal")
                self.assertNotIn("private-example", str(caught.exception))

    def test_remote_refresh_refused(self):
        with patch.object(target, "urlopen") as opened:
            with self.assertRaisesRegex(target.SetupHold,
                                        "OWNER_LOCAL_LABEL_STUDIO_URL_REQUIRED"):
                target.resolve_api_credential(
                    "http://remote.example:8080", "personal-example", "personal")
            opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
