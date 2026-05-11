#!/usr/bin/env python3
"""Boot dev server → wait for ready → run command → tear down.

Convention pinned (no config, no flags — see BLUEPRINT.md §12):

    - Server boot:    `make dev` in the current working directory.
    - Health URL:     http://localhost:3000/  (any < 500 response is healthy).
    - Boot timeout:   60 seconds.
    - Inner command:  this script's argv[1:].

Exit code is the inner command's exit code, or non-zero if the server never
came up. The dev-server process group is torn down on every exit path —
normal exit, inner-command failure, KeyboardInterrupt, exception.

POSIX-only. Targets the coding-loop's playwright-runner reviewer, which
runs on the operator's machine or in CI (both Linux/macOS). Windows is
out of scope.
"""

import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request


HEALTH_URL = "http://localhost:3000/"
BOOT_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 1
TERM_GRACE_SECONDS = 5
DEV_CMD = ["make", "dev"]


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write(
            "usage: with_server.py <cmd> [args...]\n"
            "  Boots `make dev`, polls http://localhost:3000/ for ready, runs <cmd>, "
            "tears down.\n"
        )
        return 2

    inner_cmd = argv[1:]

    server = _boot_server()
    if server is None:
        return 1

    try:
        if not _wait_for_ready(server):
            return 1
        sys.stdout.write(
            f"with_server.py: {HEALTH_URL} is healthy; running: {' '.join(inner_cmd)}\n"
        )
        sys.stdout.flush()
        return subprocess.run(inner_cmd).returncode
    except KeyboardInterrupt:
        sys.stderr.write("\nwith_server.py: interrupted; tearing down dev server\n")
        return 130
    finally:
        _teardown(server)


def _boot_server() -> subprocess.Popen | None:
    """Spawn `make dev` in its own process group so we can kill the whole tree.

    Stdout/stderr inherit the parent's streams — the operator (or the
    capturing Claude subprocess) sees `make dev`'s output interleaved with
    our own messages and with the inner command's output. We don't capture
    in a pipe because long-running servers fill the buffer and block.
    """
    sys.stdout.write(
        f"with_server.py: starting `{' '.join(DEV_CMD)}` (process group leader)\n"
    )
    sys.stdout.flush()
    try:
        proc = subprocess.Popen(
            DEV_CMD,
            preexec_fn=os.setsid,
        )
    except FileNotFoundError:
        sys.stderr.write(
            "with_server.py: `make` not found on PATH. Install GNU make and ensure "
            "the project's Makefile exposes a `dev` target.\n"
        )
        return None
    return proc


def _wait_for_ready(server: subprocess.Popen) -> bool:
    """Poll the health URL until 2xx/3xx/4xx (server reachable) or timeout."""
    deadline = time.time() + BOOT_TIMEOUT_SECONDS
    sys.stdout.write(
        f"with_server.py: polling {HEALTH_URL} for up to {BOOT_TIMEOUT_SECONDS}s\n"
    )
    sys.stdout.flush()
    while time.time() < deadline:
        # If the server died (e.g. Makefile typo, port conflict), abort early.
        if server.poll() is not None:
            sys.stderr.write(
                f"with_server.py: `{' '.join(DEV_CMD)}` exited "
                f"(rc={server.returncode}) before {HEALTH_URL} became reachable. "
                f"Check the output above for the failure.\n"
            )
            return False
        if _is_healthy(HEALTH_URL):
            return True
        time.sleep(POLL_INTERVAL_SECONDS)
    sys.stderr.write(
        f"with_server.py: {HEALTH_URL} did not respond within "
        f"{BOOT_TIMEOUT_SECONDS}s. Check `make dev`'s output for boot errors, "
        f"and confirm the app listens on localhost:3000.\n"
    )
    return False


def _is_healthy(url: str) -> bool:
    """A response with status < 500 means the server is up. 4xx is fine (it's the
    server's choice to return 404 on `/` if it routes that way); 5xx means the
    server is up but unhealthy — but for boot-detection purposes the process
    is alive and listening, so we treat it as ready and let the inner test
    command surface the real problem.
    """
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return resp.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 600  # any HTTP response means the server is up
    except (urllib.error.URLError, ConnectionError, OSError):
        return False


def _teardown(server: subprocess.Popen) -> None:
    """SIGTERM the whole process group; SIGKILL if it doesn't die in time."""
    if server.poll() is not None:
        return
    try:
        pgid = os.getpgid(server.pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        server.wait(timeout=TERM_GRACE_SECONDS)
        return
    except subprocess.TimeoutExpired:
        sys.stderr.write(
            f"with_server.py: dev server did not exit within {TERM_GRACE_SECONDS}s "
            "of SIGTERM; sending SIGKILL.\n"
        )
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        return
    try:
        server.wait(timeout=2)
    except subprocess.TimeoutExpired:
        sys.stderr.write(
            "with_server.py: dev server still alive after SIGKILL; giving up.\n"
        )


if __name__ == "__main__":
    sys.exit(main(sys.argv))
