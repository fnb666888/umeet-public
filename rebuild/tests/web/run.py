"""Run explicit real browser suites; unknown suites fail rather than being skipped."""
import os
import subprocess
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
suites = {'access.spec.ts': 'access.py', 'wiki.spec.ts': 'wiki.py', 'knowledge.spec.ts': 'knowledge.py'}
requested = [name for name in sys.argv[1:] if name != '--'] or list(suites)
for name in requested:
    if name not in suites:
        raise SystemExit('Unknown browser suite: ' + name)
    result = subprocess.run([sys.executable, str(root / 'tests' / 'web' / suites[name])], cwd=root, env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
    if result.returncode:
        raise SystemExit(result.returncode)
