"""CI diagnostic using ONLY the built-in public synthetic alias fixture.
Runs the same worker entry point without suppressing the dependency traceback.
Never use this diagnostic for an owner or organization source.
"""
import importlib.util
from pathlib import Path
import sys

worker = Path(__file__).resolve().parents[1] / "tools" / "activity-r4pm-worker.py"
spec = importlib.util.spec_from_file_location("activity_r4pm_worker", worker)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.main()
