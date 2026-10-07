"""Run pytest and fail if passed test count is below the pinned minimum."""

from __future__ import annotations

import re
import subprocess
import sys

# Pinned floor — raise when the suite grows; never lower without an intentional cull.
MIN_TESTS = 167


def main() -> int:
    targets = sys.argv[1:] if len(sys.argv) > 1 else ["tests/"]
    cmd = [sys.executable, "-m", "pytest", *targets, "-q"]
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        return proc.returncode

    match = re.search(r"(\d+) passed", proc.stdout + proc.stderr)
    passed = int(match.group(1)) if match else 0
    if passed < MIN_TESTS:
        print(
            f"FAIL: pytest passed {passed} tests; pinned minimum is {MIN_TESTS}.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
