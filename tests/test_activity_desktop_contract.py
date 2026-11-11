"""Open-only checks for the standalone synthetic desktop and Setup Core profile."""
from __future__ import annotations
import json
import re
import unittest
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"


class DesktopContract(unittest.TestCase):
    def test_tauri_and_setup_identity(self):
        t = json.loads((DESKTOP / "src-tauri/tauri.conf.json").read_text("utf-8"))
        p = json.loads((DESKTOP / "installer/product.json").read_text("utf-8"))
        n = json.loads((DESKTOP / "package.json").read_text("utf-8"))
        self.assertEqual(t["version"], p["version"])
        self.assertEqual(n["version"], p["version"])
        self.assertEqual(t["identifier"], p["data_namespace"])
        self.assertEqual(p["entrypoint"], "iwxa-activity-base-desktop.exe")
        self.assertEqual(p["schema"], "IWXA_SETUP_PRODUCT/1")
        self.assertEqual(p["requirements"], ["webview2-evergreen"])
        self.assertEqual(t["bundle"]["active"], False)

    def test_native_one_window_and_no_external_navigation(self):
        t = json.loads((DESKTOP / "src-tauri/tauri.conf.json").read_text("utf-8"))
        self.assertEqual(len(t["app"]["windows"]), 1)
        self.assertEqual(t["app"]["windows"][0]["label"], "main")
        self.assertEqual(t["app"]["security"]["capabilities"], ["main"])
        csp = t["app"]["security"]["csp"]
        for term in ("frame-src 'none'", "object-src 'none'", "form-action 'none'"):
            self.assertIn(term, csp)
        self.assertNotIn("https:", csp)
        main = (DESKTOP / "src-tauri/src/main.rs").read_text("utf-8")
        self.assertIn("tauri::Builder::default()", main)
        self.assertNotIn("Command::new", main)
        permissions = json.loads((DESKTOP / "src-tauri/capabilities/main.json").read_text("utf-8"))
        self.assertEqual(permissions["windows"], ["main"])
        self.assertFalse(any("shell" in perm or "http" in perm or "fs:" in perm
                             for perm in permissions["permissions"]))
        app = (DESKTOP / "src/App.tsx").read_text("utf-8")
        self.assertNotRegex(app, r"window\.open|target=['\"]_blank|<a\b|fetch\(")

    def test_agent_logo_geometry_purple_color(self):
        svg = ElementTree.fromstring((DESKTOP / "public/brand.svg").read_text("utf-8"))
        children = list(svg)
        rect = children[0]
        self.assertEqual(rect.attrib["fill"], "#8B5CF6")
        self.assertEqual(rect.attrib["rx"], "10")
        self.assertEqual(children[1].attrib["x"], "13")
        self.assertEqual(children[1].attrib["height"], "38")
        self.assertEqual(children[2].attrib["d"], "M29 14 L51 50 M51 14 L29 50")
        ps1 = (DESKTOP / "installer/build-brand-icon.ps1").read_text("utf-8")
        self.assertIn("FromArgb(139,92,246)", ps1)
        self.assertIn("DrawLine($pen,29,14,51,50)", ps1)

    def test_setup_uses_pinned_existing_core_without_fork(self):
        script = (DESKTOP / "installer/build-setup-core.ps1").read_text("utf-8")
        self.assertIn("24d6a0d898e18fef29012735e0ff59da0d3ee182", script)
        self.assertIn("installer/build_bundle.py", script)
        self.assertIn("installer/windows/build-stub.ps1", script)
        self.assertIn("PE_RESOURCE_V2", script)
        self.assertIn("--source-tree", script)
        self.assertIn("--verify-installed-file", script)
        self.assertNotIn("Invoke-WebRequest", script)

    def test_runtime_uses_pure_offline_synthetic_engine(self):
        engine = (ROOT / "modules/activity-base-anonymizer/engine.mjs").read_text("utf-8")
        self.assertIn("export async function analyzeSnapshot", engine)
        self.assertIn("SOURCE_PIN_DIGEST_MISMATCH", engine)
        self.assertIn("export_allowed: false", engine)
        self.assertIn("iwxa_package: null", engine)
        self.assertNotRegex(engine, r"\bfetch\s*\(|XMLHttpRequest|WebSocket|http://|https://")
        self.assertIn("crypto.subtle.digest", engine)

    def test_risk_screen_integrated_without_export_or_network(self):
        ui = (DESKTOP / "src/App.tsx").read_text("utf-8")
        risk = (ROOT / "modules/activity-base-anonymizer/risk.mjs").read_text("utf-8")
        self.assertIn("screenSyntheticDisclosure(input)", ui)
        self.assertIn("Анонимность не установлена", ui)
        self.assertIn("STRUCTURE_PRESERVED_REVIEW_REQUIRED", risk)
        self.assertIn("MIN_INDEPENDENT_TRACES = 3", risk)
        self.assertIn("export_allowed: false", risk)
        self.assertNotRegex(risk, r"\bfetch\s*\(|XMLHttpRequest|WebSocket|http://|https://")


    def test_ocel2_reconstruction_is_internal_only(self):
        ui = (DESKTOP / "src/App.tsx").read_text("utf-8")
        module = (ROOT / "modules/activity-base-anonymizer/ocel2-evidence.mjs").read_text("utf-8")
        self.assertIn("inspectSyntheticOcel2(input)", ui)
        self.assertIn("Открыть пример OCEL 2.0", ui)
        self.assertIn("OCEL 2.0 · связи объектов и событий", ui)
        self.assertIn("HOLD · ВЫПУСК ЗАКРЫТ", ui)
        self.assertIn("JSON_RESTRICTED_PROFILE_PARSED_NOT_FULL_STANDARD_CONFORMANCE", module)
        self.assertIn("OBJECT_LOCAL_OBSERVED_TIME_ORDER_NOT_CAUSAL_DEPENDENCY", module)
        self.assertIn("export_allowed: false", module)
        self.assertIn("iwxa_package: null", module)
        self.assertNotRegex(module, r"\bfetch\s*\(|XMLHttpRequest|WebSocket|http://|https://")

    def test_t3_review_requires_trusted_host_and_invalidation(self):
        app = (DESKTOP / "src/App.tsx").read_text("utf-8")
        controller = (ROOT / "modules/activity-base-anonymizer/t3-review-controller.mjs").read_text("utf-8")
        types = (ROOT / "modules/activity-base-anonymizer/t3-review-controller.d.mts").read_text("utf-8")
        self.assertIn("createT3ReviewController({host: t3Host, onUpdate: setT3Review})", app)
        self.assertIn("Подключить выбранную базу T3", app)
        self.assertIn("T3_TRUSTED_HOST_NOT_CONNECTED", app)
        self.assertIn("Структура выбранной базы T3", app)
        self.assertIn("HOLD · ВЫПУСК ЗАКРЫТ", app)
        self.assertIn("host.subscribeInvalidation(invalidate)", controller)
        trusted = (ROOT / "modules/activity-base-anonymizer/t3-selected-host.mjs").read_text("utf-8")
        self.assertIn("context.currentWorkspace.subscribe(listener)", trusted)
        self.assertIn("subscribeOwnerInvalidation(listener)", trusted)
        self.assertIn("host.readSelected()", controller)
        self.assertIn("acceptedReview(await host.readSelected())", controller)
        self.assertIn("createTrustedT3ReviewPort", trusted)
        self.assertNotIn("signedAccess", controller)
        self.assertNotIn("signedAccess", types)
        self.assertIn("dispose()", controller)
        self.assertIn("const token = ++sourceEpoch.current;", app)
        self.assertIn("if (token !== sourceEpoch.current) return;", app)
        self.assertIn("useLayoutEffect(() => {", app)
        self.assertIn("const token = beginSource();", app)
        self.assertIn("beginSource();\n    setBusy(false);", app)
        self.assertIn("HOLD: INVALID_JSON_INPUT", app)
        self.assertIn("subscribeInvalidation", types)
        self.assertNotRegex(controller, r"\bfetch\s*\(|XMLHttpRequest|WebSocket|http://|https://")
    def test_source_switch_clears_stale_async_preview(self):
        app = (DESKTOP / "src/App.tsx").read_text("utf-8")
        self.assertIn("const sourceEpoch = useRef(0)", app)
        self.assertIn("sourceEpoch.current += 1;", app)
        self.assertIn("if (token === sourceEpoch.current) setBusy(false);", app)
        self.assertIn("await run(JSON.parse(content), file.name, token)", app)
        self.assertIn("t3Controller.current?.reset();", app)
        self.assertIn("setPreview(null); setRisk(null); setObjectEvidence(null); setProblem('');", app)
        self.assertNotIn("JSON.parse(await file.text())", app)

    def test_host_surface_native_embedded_but_not_a_second_runtime(self):
        source = (DESKTOP / "src/host-surface.tsx").read_text("utf-8")
        config = (DESKTOP / "vite.host.config.ts").read_text("utf-8")
        app = (DESKTOP / "src/App.tsx").read_text("utf-8")
        self.assertIn("mountActivityHostSurface", source)
        self.assertIn("IWXA_ACTIVITY_NARROW_T3_HOST_REQUIRED", source)
        self.assertIn("root.unmount()", source)
        self.assertIn("src={brandSrc}", app)
        self.assertIn("new URL('./brand.svg', import.meta.url).href", source)
        self.assertIn("external: ['react', 'react-dom/client', 'react/jsx-runtime']", config)
        self.assertNotRegex(source, r"\bfetch\s*\(|WebSocket|window\.open|signedAccess|grant_id")

if __name__ == "__main__":
    unittest.main()