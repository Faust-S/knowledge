import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "tools" / "activity-agent-input.py"
SPEC = importlib.util.spec_from_file_location("activity_agent_input", BRIDGE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def invoke(*args):
    result = subprocess.run([sys.executable, "-I", str(BRIDGE), *args], capture_output=True, timeout=20)
    return result.returncode, result.stdout, result.stderr


class BridgeBoundary(unittest.TestCase):
    def test_fixed_operation_and_source_bytes(self):
        with TemporaryDirectory(prefix="iwxa-activity-") as directory:
            file = Path(directory) / "input.json"
            data = b'{"profile":"example"}\n'
            file.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            self.assertEqual(bridge.read_verified_temp(str(file), digest), data)
            file.write_bytes(data+b" ")
            with self.assertRaisesRegex(bridge.Hold, "ACTIVITY_BRIDGE_SOURCE_CHANGED"):
                bridge.read_verified_temp(str(file), digest)

    def test_arbitrary_path_or_unapproved_operation_rejected(self):
        with TemporaryDirectory() as directory:
            file = Path(directory) / "input.json"
            file.write_bytes(b"{}")
            with self.assertRaisesRegex(bridge.Hold, "ACTIVITY_BRIDGE_SOURCE_INVALID"):
                bridge.read_verified_temp(str(file), hashlib.sha256(b"{}").hexdigest())
        code, output, stderr = invoke("--run", "shell", "arbitrary", "a"*64)
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)["code"], "ACTIVITY_BRIDGE_ARGUMENTS_INVALID")
        self.assertEqual(stderr, b"")

    def test_no_leak_of_untrusted_path_in_hold(self):
        code, output, stderr = invoke("--run", "simpy_compare", "private_path", "a"*64)
        self.assertEqual(code, 2)
        self.assertNotIn(b"private_path", output)
        self.assertEqual(stderr, b"")


@unittest.skipUnless(os.environ.get("IWXA_ACTIVITY_SIMPY_BRIDGE_FIXTURE"), "real source candidate not selected")
class OriginalBridge(unittest.TestCase):
    def test_real_worker_through_existing_u01_file_argv_shape(self):
        source = Path(os.environ["IWXA_ACTIVITY_SIMPY_BRIDGE_FIXTURE"]).read_bytes()
        code, output, stderr = invoke("--probe", "simpy_compare")
        self.assertEqual(code, 0, output)
        self.assertEqual(output.strip(), b"iwxa-activity-simpy-compare-v1")
        self.assertEqual(stderr, b"")
        with TemporaryDirectory(prefix="iwxa-activity-") as directory:
            path = Path(directory) / "input.json"
            path.write_bytes(source)
            digest = hashlib.sha256(source).hexdigest()
            code, output, stderr = invoke("--run", "simpy_compare", str(path), digest)
            self.assertEqual(code, 0, output)
            result = json.loads(output)
            self.assertEqual(result["input_sha256"], digest)
            self.assertEqual(result["evidence"], "MODEL_NOT_EXECUTION")
            self.assertEqual(result["recipient"]["elapsed_minutes"], 480)
            self.assertFalse(result["export_allowed"])
            self.assertEqual(stderr, b"")
            code, output, _ = invoke("--run", "simpy_compare", str(path), "a"*64)
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output)["code"], "ACTIVITY_BRIDGE_SOURCE_CHANGED")


if __name__ == "__main__":
    unittest.main()
