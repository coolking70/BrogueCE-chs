"""Capture the UR2 trace against the committed Game.ts, restoring the worktree on exit."""
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
game = root / 'brogue-web/src/engine/Core/Game.ts'
current = game.read_bytes()
original = subprocess.check_output(['git', 'show', 'HEAD:brogue-web/src/engine/Core/Game.ts'], cwd=root)
try:
    game.write_bytes(original)
    env = dict(os.environ, UR2_CAPTURE='1')
    result = subprocess.run(['npm.cmd', 'test', '--', 'src/test/u_r2_trace.test.ts'], cwd=root / 'brogue-web', env=env)
    raise SystemExit(result.returncode)
finally:
    game.write_bytes(current)
