"""Write per-spawn `.claude/settings.json` files that wire in the hooks."""

import json
import sys
from pathlib import Path

from .. import paths


STOP_HOOK_SCRIPT = paths.HOOK_SCRIPTS_DIR / "stop_verdict.py"
PATH_GUARD_SCRIPT = paths.HOOK_SCRIPTS_DIR / "path_guard.py"


def write_generator_settings(project_root: Path, spawn_label: str) -> Path:
    """Settings for a generator subprocess: only the Stop hook (verdict trailer)."""
    settings = {
        "hooks": {
            "Stop": [_command_hook(STOP_HOOK_SCRIPT)],
        },
    }
    return _write(project_root, spawn_label, settings)


def write_reviewer_settings(project_root: Path, spawn_label: str) -> Path:
    """Settings for a reviewer subprocess: Stop hook + PreToolUse path guard."""
    settings = {
        "hooks": {
            "Stop": [_command_hook(STOP_HOOK_SCRIPT)],
            "PreToolUse": [
                {
                    "matcher": "Write|Edit|MultiEdit",
                    "hooks": [{"type": "command", "command": _python_command(PATH_GUARD_SCRIPT)}],
                }
            ],
        },
    }
    return _write(project_root, spawn_label, settings)


def _command_hook(script: Path) -> dict:
    return {
        "matcher": "",
        "hooks": [{"type": "command", "command": _python_command(script)}],
    }


def _python_command(script: Path) -> str:
    return f"{sys.executable} {script}"


def _write(project_root: Path, spawn_label: str, settings: dict) -> Path:
    out_dir = paths.settings_scratch_dir(project_root)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{spawn_label}.json"
    out_path.write_text(json.dumps(settings, indent=2) + "\n")
    return out_path
