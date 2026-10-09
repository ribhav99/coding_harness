#!/usr/bin/env python3
"""Invocation-local TabTail pilot; no settings writes or live-session adoption.

Run with the released Relay venv, supplied by lib/tabtail.mjs.
The original aggregate/notify owns its input, output and status. Only optional
inspection/reporting has a deadline. Never inspect terminal text.
"""
import asyncio
import json
import os
from pathlib import Path
import select
import shlex
import subprocess
import sys
import time
import uuid
from types import SimpleNamespace

HERE = str(Path(__file__).resolve())
BUDGET = 2.0
RELAY_ADAPTER = str(Path(os.environ.get('FM2_TABTAIL_RELAY', str(Path.home() / '.local/share/relay'))) / 'adapter')
# Process-local module search; preserve the provider and tools' PYTHONPATH.
sys.path.insert(0, RELAY_ADAPTER)


def inspect_codex(command, config, cwd):
    """Read-only inventory from our own short-lived server, never the daemon.

    No threads are loaded/started and no model requests are made. Asking Codex
    itself includes managed, plugin and ancestor sources without guessing its
    config precedence. Unknown protocol/inventory fails closed.
    """
    child = subprocess.Popen([command, 'app-server', '--stdio', *config], cwd=cwd,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + BUDGET
    buffer = b''

    def request(sequence, method, params):
        nonlocal buffer
        child.stdin.write((json.dumps(dict(id=sequence, method=method, params=params)) + '\n').encode())
        child.stdin.flush()
        while True:
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                message = json.loads(line)
                if message.get('id') == sequence:
                    if 'error' in message:
                        raise ValueError('unsupported Codex inventory')
                    return message['result']
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([child.stdout], [], [], remaining)[0]:
                raise TimeoutError('Codex inventory timed out')
            chunk = os.read(child.stdout.fileno(), 65536)
            if not chunk or len(buffer) + len(chunk) > 4 * 1024 * 1024:
                raise ValueError('invalid Codex inventory')
            buffer += chunk

    try:
        request(1, 'initialize', dict(clientInfo=dict(name='firstmate-tabtail', version='1'),
                                     capabilities=dict(experimentalApi=True)))
        child.stdin.write(b'{"method":"initialized","params":{}}\n')
        child.stdin.flush()
        hooks = request(2, 'hooks/list', dict(cwds=[cwd]))
        effective = request(3, 'config/read', dict(cwd=cwd, includeLayers=False))
        return hooks, effective['config'].get('notify') or []
    finally:
        # This process belongs exclusively to this inspection. Never contact,
        # stop or signal any discovered provider/server/session.
        child.kill()
        child.communicate(timeout=1)


def sole_trusted_stop(inventory, expected, require_trust=True):
    if not isinstance(inventory, dict) or not isinstance(inventory.get('data'), list) or len(inventory['data']) != 1:
        return False
    entry = inventory['data'][0]
    if entry.get('errors') != [] or entry.get('warnings') != [] or not isinstance(entry.get('hooks'), list):
        return False
    stops = []
    for hook in entry['hooks']:
        if hook.get('enabled') is not True:
            continue
        # Async hooks can still have work in flight after Stop. Unsupported in
        # this pilot, even when unrelated to Stop. Never disable them.
        if hook.get('async') is True:
            return False
        if hook.get('eventName') == 'stop':
            stops.append(hook)
    return len(stops) == 1 and all(
        hook.get('handlerType') == 'command' and shlex.split(hook.get('command', '')) == expected and
        hook.get('source') == 'sessionFlags' and (not require_trust or hook.get('trustStatus') == 'trusted')
        for hook in stops)


def config_args(args):
    # The harness builds these argv; never retain the user prompt/brief in the
    # hook environment or turn it into a command. Other launch modes unsupported.
    result = []
    for at, arg in enumerate(args):
        if arg == '-c' and at + 1 < len(args):
            result.extend(['-c', args[at + 1]])
    return result


def bootstrap():
    from relay_adapter.notification_hook import report
    # Direct tmux exec has no interactive preexec/precmd. Give this launch its
    # own foreground run. No shell-end is emitted for a provider process exit.
    os.environ['TABTAIL_RUN'] = uuid.uuid4().hex
    os.environ['TABTAIL_SHELL_PID'] = str(os.getpid())
    async def send():
        for kind in ('shell-ready', 'shell-start'):
            await report(SimpleNamespace(kind=kind, event=None, outcome='completed'))
    asyncio.run(send())


def launch(command):
    if not command or os.environ.get('TABTAIL_AGENT_PID'):
        raise ValueError('TabTail launch requires a new root provider process')
    for key in ('FM2_TABTAIL_FINAL', 'FM2_TABTAIL_CODEX', 'FM2_TABTAIL_INITIAL_SOLE_STOP', 'FM2_TABTAIL_BOOTSTRAPPED'):
        os.environ.pop(key, None)
    provider = os.environ.get('FM2_AGENT')
    if provider != 'codex':
        raise ValueError('TabTail pilot supports local Codex only')
    if Path(command[0]).name != 'codex' or '--no-daemon' not in command or any(
            arg == '--remote' or arg.startswith('--remote=') or arg in ('--last', '--continue',
            '--dangerously-bypass-hook-trust', '--profile', '-p', '--cd', '-C', '--config',
            '--enable', '--disable') or arg.startswith(('--profile=', '--cd=', '--config=',
            '--enable=', '--disable=')) for arg in command[1:]):
        raise ValueError('TabTail requires local codex --no-daemon, exact resumes and normal hook trust')
    print('firstmate: TabTail pilot requires provider background/goal evidence; missing evidence keeps alerts unavailable. Review exact hooks with /hooks.', file=sys.stderr)
    try:
        from relay_adapter import notification_agent, notification_claude_dispatcher, notification_hook  # noqa: F401
    except Exception:
        print('firstmate: Relay modules unavailable; original provider launch retained.', file=sys.stderr)
        os.execvp(command[0], command)
    config = config_args(command[1:])
    # If we cannot read the original callback, leave notify completely intact
    # and run the normal provider. Never replace an unknown callback with [].
    try:
        inventory, original = inspect_codex(command[0], config, os.getcwd())
        if not isinstance(original, list) or not all(isinstance(arg, str) for arg in original):
            raise ValueError('unknown notify argv')
        # Preserve initial parallel-gate exclusion even if a source is removed
        # after this process has already loaded it. Trust may be granted later.
        initial = inventory.get('data', [])
        stops = [hook for entry in initial for hook in entry.get('hooks', []) if hook.get('eventName') == 'stop']
        expected = shlex.split(stops[0].get('command', '')) if len(stops) == 1 else []
        bridge_prefix = [sys.executable, HERE, 'stop', '--']
        initial_sole = '1' if (expected[:4] == bridge_prefix and
            sole_trusted_stop(inventory, expected, require_trust=False)) else '0'
    except Exception:
        print('firstmate: TabTail inventory unavailable; original provider callbacks retained.', file=sys.stderr)
        os.execvp(command[0], command)
    os.environ['FM2_TABTAIL_INITIAL_SOLE_STOP'] = initial_sole
    os.environ['FM2_TABTAIL_CODEX'] = json.dumps([command[0], config, os.getcwd()])
    notify = [sys.executable, HERE, 'notify', '--', *original]
    command.extend(['-c', 'notify=' + json.dumps(notify)])
    os.environ.pop('FM2_TABTAIL_BOOTSTRAPPED', None)
    try:
        bootstrap()
        os.environ['FM2_TABTAIL_BOOTSTRAPPED'] = '1'
    except Exception:
        print('firstmate: TabTail run bootstrap unavailable; no completion readiness claimed.', file=sys.stderr)
    # The released launcher execs the provider from this same PID. Process-local
    # imports avoid exporting a changed PYTHONPATH to provider tools.
    sys.argv = ['relay-agent', 'codex', '--', *command]
    notification_agent.main()


def stop(gate):
    # Do not consume stdin. The released wrapper spools and forwards every byte
    # to the original aggregate, whose status/stdout/stderr remain authoritative.
    os.environ.pop('FM2_TABTAIL_FINAL', None)
    try:
        command, config, cwd = json.loads(os.environ['FM2_TABTAIL_CODEX'])
        inventory, _ = inspect_codex(command, config, cwd)
        expected = [sys.executable, HERE, 'stop', '--', *gate]
        if os.environ.get('FM2_TABTAIL_INITIAL_SOLE_STOP') == '1' and sole_trusted_stop(inventory, expected):
            os.environ['FM2_TABTAIL_FINAL'] = '1'
    except Exception:
        pass
    # Delegate in the *same PID*, so the released ownership walk sees only
    # the actual provider and shell ancestors, never a custom Node dispatcher.
    provider = os.environ.get('FM2_AGENT')
    try:
        from relay_adapter import notification_claude_dispatcher  # noqa: F401
    except Exception:
        os.execvp(gate[0], gate)
    sys.argv = ['relay-codex-stop', '--provider', provider, '--', *gate]
    notification_claude_dispatcher.main()


def notify(original_and_payload):
    # Codex appends its original JSON argument. Do not parse/reserialize it, and
    # do not read stdin: the legacy callback gets the exact bytes/argv/streams.
    # Exec into a shell so relay-notify's owner walk reaches the root Codex;
    # a Python/Node dispatcher parent is intentionally rejected by Relay.
    original = original_and_payload[:-1]
    payload = original_and_payload[-1:]  # also handles an absent argument
    legacy = shlex.join(original_and_payload) if original else ':'
    reporter = [sys.executable, '-c',
                'import signal,sys; signal.alarm(2); sys.path.insert(0,sys.argv[1]); '
                'sys.argv=["relay-notify","codex",sys.argv[2]]; '
                'from relay_adapter.notification_hook import main; main()', RELAY_ADAPTER, *payload]
    script = legacy + '\nfm_tabtail_status=$?\n' + '{ ' + shlex.join(reporter) + '; } </dev/null >/dev/null 2>&1\nexit "$fm_tabtail_status"\n'
    os.execv('/bin/sh', ['/bin/sh', '-c', script])


def main():
    mode, *args = sys.argv[1:]
    if args[:1] == ['--']:
        args = args[1:]
    if mode == 'launch':
        launch(args)
    elif mode == 'stop':
        stop(args)
    elif mode == 'notify':
        notify(args)
    else:
        raise ValueError('expected launch, stop or notify')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('firstmate: TabTail bridge unavailable: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
