"""Bridge contract tests. Run with the released Relay venv/PYTHONPATH.

Only disposable tmux/socket/store/provider fixtures are used. The provider emits
synthetic authoritative registry fields; this is NOT a current CLI or APNs claim.
"""
import importlib.util
import http.server
import threading
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'tabtail.py'
spec = importlib.util.spec_from_file_location('bridge', BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

SERVICE = r'''
import asyncio,json,sys
from pathlib import Path
from relay_adapter.notifications import NotificationStore
from relay_adapter.notification_service import NotificationService
from relay_adapter.common import encode_frame
async def main():
 store=NotificationStore(Path(sys.argv[1])/'db')
 service=NotificationService(store)
 async def client(reader,writer):
  try:
   value=json.loads(await reader.readline())
   if value['op']=='fixture':
    result={table:[dict(row) for row in store.db.execute('SELECT * FROM '+table)] for table in ('events','runs','codex_candidates','outbox','sources')}
   elif value['op']=='register': result=store.register(value)
   elif value['op']=='subscribe': result=store.subscribe(value)
   else: result=await service.request(value)
   response={'ok':True,'data':result}
  except Exception as e: response={'ok':False,'error':str(e)}
  writer.write(encode_frame(response));await writer.drain();writer.close()
 server=await asyncio.start_unix_server(client,path=str(Path(sys.argv[1])/'notifications.sock'))
 (Path(sys.argv[1])/'notifications.sock').chmod(0o600)
 print('ready',flush=True)
 async with server: await server.serve_forever()
asyncio.run(main())
'''

PROVIDER = r'''
import json,os,shlex,socket,subprocess,sys
from pathlib import Path
if sys.argv[1:2]==['app-server']:
 for line in sys.stdin:
  q=json.loads(line)
  if 'id' not in q: continue
  if q['method']=='initialize': result={}
  elif q['method']=='config/read': result={'config':{'notify':json.loads(os.environ['FIXTURE_ORIGINAL'])}}
  elif q['method']=='hooks/list': result={'data':[{'hooks':[{'eventName':'stop','source':'sessionFlags','trustStatus':os.environ.get('FIXTURE_TRUST','trusted'),'enabled':True,'handlerType':'command','command':os.environ['FIXTURE_STOP']}], 'errors':[],'warnings':[]}]}
  else: result={}
  print(json.dumps({'id':q['id'],'result':result}),flush=True)
 sys.exit()
notify=json.loads(next(arg[len('notify='):] for arg in sys.argv if arg.startswith('notify=')))
s=socket.socket(socket.AF_UNIX);s.bind(os.environ['FIXTURE_CONTROL']);s.listen()
while True:
 client,_=s.accept();q=json.loads(client.makefile().readline())
 env=dict(os.environ,**q.get('env',{}))
 if q['op']=='identity': result={'pid':os.getpid(),'run':os.environ['TABTAIL_RUN'],'owner':os.environ['TABTAIL_AGENT_PID'],'pane':os.environ['TMUX_PANE'],'tmux':os.environ['TMUX'],'pythonpath':os.environ.get('PYTHONPATH')}
 elif q['op']=='stop':
  r=subprocess.run(['/bin/sh','-c',os.environ['FIXTURE_STOP']],input=json.dumps(q['payload']),text=True,capture_output=True,env=env)
  result={'status':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 elif q['op'] in ('notify','nested'):
  args=[*notify,json.dumps(q['payload'],ensure_ascii=False,indent=1)]
  if q['op']=='nested': args=[sys.executable,'-c','import subprocess,sys;sys.exit(subprocess.call(sys.argv[1:]))',*args]
  r=subprocess.run(args,text=True,capture_output=True,env=env);result={'status':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 elif q['op']=='report':
  r=subprocess.run([sys.executable,'-c','import asyncio;from types import SimpleNamespace;from relay_adapter.notification_hook import report;asyncio.run(report(SimpleNamespace(kind="shell-ready",event=None,outcome="completed")))'],capture_output=True,text=True,env=env);result={'stdout':r.stdout,'stderr':r.stderr}
 elif q['op']=='source':
  r=subprocess.run([sys.executable,'-c','import asyncio;from relay_adapter.notification_hook import source_pane;print(asyncio.run(source_pane()))'],capture_output=True,text=True,env=env);result={'stdout':r.stdout,'stderr':r.stderr}
 elif q['op']=='shell-end':
  r=subprocess.run([sys.executable,'-m','relay_adapter.notification_hook','shell-end'],capture_output=True,env=env);result={'status':r.returncode}
 client.sendall((json.dumps(result)+'\n').encode());client.close()
'''


def call(path, value):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(8)
        client.connect(str(path))
        client.sendall((json.dumps(value) + '\n').encode())
        return json.loads(client.makefile().readline())


class Contracts(unittest.TestCase):
    def test_inventory_rejects_parallel_async_unknown_modified_and_missing_gates(self):
        hook = dict(enabled=True, eventName='stop', source='sessionFlags', trustStatus='trusted',
                    handlerType='command', command="python '/fixture path/bridge.py' stop -- node worker")
        def inventory(hooks):
            return {'data': [dict(hooks=hooks, errors=[], warnings=[])]}
        expected = shlex.split(hook['command'])
        self.assertTrue(bridge.sole_trusted_stop(inventory([hook]), expected))
        for bad in ({}, {'data': []}, inventory([]), inventory([hook, hook]),
                    inventory([dict(hook, trustStatus='modified')]),
                    inventory([dict(hook, trustStatus='untrusted')]),
                    inventory([dict(hook, source='plugin')]),
                    inventory([hook, dict(enabled=True, eventName='postToolUse', **{'async': True})]),
                    {'data': [dict(hooks=[hook], errors=['missing plugin'], warnings=[])]}):
            self.assertFalse(bridge.sole_trusted_stop(bad, expected), bad)

    def test_legacy_notify_gets_exact_argv_stdin_output_and_nonzero_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "original ' callback.py"
            script.write_text('import json,sys\nprint(json.dumps(sys.argv[1:],ensure_ascii=False))\n'
                              'print(sys.stdin.read(),end="")\nprint("legacy stderr",file=sys.stderr)\nsys.exit(7)\n')
            payload = '{ "type":"agent-turn-complete", "literal":"\\n 🐈 $(no) `no`" }'
            result = subprocess.run([sys.executable, str(BRIDGE), 'notify', '--', sys.executable,
                                     str(script), 'turn-ended', 'literal\narg', payload],
                                    input='original stdin\n', capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 7)
            self.assertEqual(result.stdout, json.dumps(['turn-ended', 'literal\narg', payload], ensure_ascii=False) + '\noriginal stdin\n')
            self.assertEqual(result.stderr, 'legacy stderr\n')

    def test_hung_optional_reporter_is_bounded_and_original_callback_still_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'adapter/relay_adapter'
            package.mkdir(parents=True); (package / '__init__.py').write_text('')
            (package / 'notification_hook.py').write_text('import time;time.sleep(60)')
            start = time.monotonic()
            result = subprocess.run([sys.executable, str(BRIDGE), 'notify', '--', '/bin/sh', '-c',
                                     'printf original; exit 9', 'legacy', '{}'],
                                    capture_output=True, timeout=4, env=dict(os.environ, PYTHONPATH=directory, FM2_TABTAIL_RELAY=directory))
            self.assertEqual((result.returncode, result.stdout, result.stderr), (9, b'original', b''))
            self.assertLess(time.monotonic() - start, 3)

    def test_missing_dispatcher_keeps_exact_gate_input_output_status(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(BRIDGE), 'stop', '--', '/bin/sh', '-c',
                                     'cat; printf stderr >&2; exit 2'], input=b'raw\x00input\n',
                                    capture_output=True, env=dict(os.environ, PYTHONPATH=directory,
                                    FM2_AGENT='codex', FM2_TABTAIL_CODEX='invalid', FM2_TABTAIL_RELAY=directory))
            if result.returncode != 2:
                self.fail(result.stderr)
            self.assertEqual((result.stdout, result.stderr), (b'raw\x00input\n', b'stderr'))

    def test_optional_launch_inventory_error_preserves_provider_argv_and_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            command = Path(directory) / 'codex'
            command.write_text('#!' + sys.executable + '\nimport json,os,sys\n'
                'if sys.argv[1:2]==["app-server"]:\n'
                ' for line in sys.stdin:\n'
                '  q=json.loads(line)\n'
                '  if "id" not in q: continue\n'
                '  value={"config":{"notify":["legacy","turn-ended"]}} if q["method"]=="config/read" else {"data":[{"hooks":[7]}]}\n'
                '  print(json.dumps({"id":q["id"],"result":value}),flush=True)\n'
                'else: print(json.dumps({"args":sys.argv[1:],"pythonpath":os.environ.get("PYTHONPATH"),"owner":os.environ.get("TABTAIL_AGENT_PID")}))\n')
            command.chmod(0o700)
            args = ['--no-daemon', '-c', 'model_reasoning_effort="high"', 'original prompt']
            env = dict(os.environ, FM2_AGENT='codex', TABTAIL_AGENT_PID='', PYTHONPATH=directory)
            result = subprocess.run([sys.executable, str(BRIDGE), 'launch', '--', str(command), *args],
                                    text=True, capture_output=True, env=env, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), dict(args=args, pythonpath=directory, owner=''))
            self.assertIn('original provider callbacks retained', result.stderr)

    @unittest.skipUnless(shutil.which('codex'), 'installed Codex required for native hook inventory')
    def test_native_inventory_requires_exact_hook_trust_and_detects_parallel_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get('CODEX_HOME')
            os.environ['CODEX_HOME'] = directory
            try:
                expected = [sys.executable, str(BRIDGE), 'stop', '--', '/bin/sh', '-c', 'node worker']
                hook = dict(type='command', command=shlex.join(expected))
                # JSON object is not inline TOML; construct only this known fixture.
                config = ['-c', 'hooks.Stop=[{hooks=[{type="command",command=' + json.dumps(hook['command']) + '}]}]']
                inventory, _ = bridge.inspect_codex(shutil.which('codex'), config, directory)
                metadata = inventory['data'][0]['hooks'][0]
                self.assertEqual(metadata['trustStatus'], 'untrusted')
                self.assertFalse(bridge.sole_trusted_stop(inventory, expected))
                # Fixture-only equivalent of reviewing the exact definition's
                # current hash. No bypass flag and no user's trust state touched.
                (Path(directory) / 'config.toml').write_text('[hooks.state.' + json.dumps(metadata['key']) + ']\ntrusted_hash=' + json.dumps(metadata['currentHash']) + '\n')
                inventory, _ = bridge.inspect_codex(shutil.which('codex'), config, directory)
                self.assertTrue(bridge.sole_trusted_stop(inventory, expected), inventory)
                (Path(directory) / 'hooks.json').write_text(json.dumps({'hooks': {'Stop': [{'hooks': [dict(type='command', command='exit 2')]}]}}))
                inventory, _ = bridge.inspect_codex(shutil.which('codex'), config, directory)
                self.assertFalse(bridge.sole_trusted_stop(inventory, expected))
            finally:
                if previous is None: os.environ.pop('CODEX_HOME', None)
                else: os.environ['CODEX_HOME'] = previous


    @unittest.skipUnless(os.environ.get('FM2_TABTAIL_NATIVE_TEST') == '1', 'set FM2_TABTAIL_NATIVE_TEST=1 for localhost-only native Stop capture')
    def test_current_native_codex_stop_cannot_supply_required_registries(self):
        class LocalModel(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length', '0')))
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                item = dict(type='message', id='msg_fixture', role='assistant', status='completed',
                            content=[dict(type='output_text', text='Fixture complete.', annotations=[])])
                events = [dict(type='response.created', response=dict(id='resp_fixture')),
                          dict(type='response.output_item.added', output_index=0, item=item),
                          dict(type='response.output_item.done', output_index=0, item=item),
                          dict(type='response.completed', response=dict(id='resp_fixture', status='completed', output=[item],
                              usage=dict(input_tokens=1, output_tokens=1, total_tokens=2)))]
                for event in events:
                    self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
                self.wfile.flush()
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), LocalModel)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='fmtt-native-') as directory:
                root = Path(directory); capture = root / 'capture.py'; payload = root / 'stop.json'
                capture.write_text('import pathlib,sys\npathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())\nprint("{}")\n')
                hook = shlex.join([sys.executable, str(capture), str(payload)])
                config = root / 'config.toml'
                config.write_text('model="gpt-6.1-sol"\nmodel_reasoning_effort="high"\nmodel_provider="fixture"\n'
                                  'check_for_update_on_startup=false\n[model_providers.fixture]\nname="Local fixture"\n'
                                  'base_url="http://127.0.0.1:' + str(server.server_port) + '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n'
                                  '[hooks]\nStop=[{hooks=[{type="command",command=' + json.dumps(hook) + '}]}]\n')
                env = {key: value for key, value in os.environ.items() if not key.startswith(('FM2_', 'TABTAIL_')) and key not in ('OPENAI_API_KEY', 'CODEX_API_KEY')}
                env['CODEX_HOME'] = directory
                old = os.environ.get('CODEX_HOME'); os.environ['CODEX_HOME'] = directory
                try:
                    inventory, _ = bridge.inspect_codex(shutil.which('codex'), [], directory)
                finally:
                    if old is None: os.environ.pop('CODEX_HOME', None)
                    else: os.environ['CODEX_HOME'] = old
                metadata = inventory['data'][0]['hooks'][0]
                with config.open('a') as stream:
                    stream.write('[hooks.state.' + json.dumps(metadata['key']) + ']\ntrusted_hash=' + json.dumps(metadata['currentHash']) + '\n')
                result = subprocess.run(['codex', 'exec', '--json', '--skip-git-repo-check', '-C', directory,
                                         'Return the fixture completion. Do not use tools.'], env=env,
                                         capture_output=True, text=True, timeout=25)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(payload.exists(), result.stdout + result.stderr)
                value = json.loads(payload.read_text())
                self.assertEqual(value['hook_event_name'], 'Stop')
                self.assertTrue(value.get('session_id')); self.assertTrue(value.get('turn_id'))
                self.assertNotIn('background_tasks', value)
                self.assertNotIn('session_crons', value)
                self.assertNotIn('goal', value)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


class ReleasedRelay(unittest.TestCase):
    def setUp(self):
        try:
            import relay_adapter.notifications  # noqa: F401
        except ImportError:
            self.skipTest('run using released Relay venv and PYTHONPATH')
        self.temp = tempfile.TemporaryDirectory(prefix='fmtt-')
        self.root = Path(self.temp.name)
        self.tmux_socket = str(self.root / 'tmux')
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.control = self.root / 'provider.sock'
        self.fmhome = self.root / 'fm'; (self.fmhome / 'tasks').mkdir(parents=True)
        (self.fmhome / 'tasks/worker.json').write_text(json.dumps(dict(id='worker', agent='codex')))
        self.env = dict(os.environ, RELAY_STATE_DIR=str(self.state), RELAY_TMUX_SOCKET=self.tmux_socket,
                        FM2_HOME=str(self.fmhome), FM2_TASK='worker', FM2_AGENT='codex', FM2_PANEL='',
                        FM2_TABTAIL='1', FM2_CODEX_BACKEND='embedded', FIXTURE_CONTROL=str(self.control),
                        TABTAIL_AGENT_PID='', FM2_TABTAIL_FINAL='', FM_REMOTE='yes')
        self.env.pop('TMUX', None)
        self.env.pop('TMUX_PANE', None)
        self.stop = shlex.join([sys.executable, str(BRIDGE), 'stop', '--', '/bin/sh', '-c',
                               shlex.join(['node', str(ROOT / 'hooks/worker-stop.mjs')])])
        self.env['FIXTURE_STOP'] = self.stop
        self.env['FIXTURE_ORIGINAL'] = json.dumps([shutil.which('true'), 'turn-ended'])
        self.service = subprocess.Popen([sys.executable, '-u', '-c', SERVICE, str(self.state)],
                                        env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(self.service.stdout.readline(), 'ready\n')
        provider = self.root / 'codex'
        provider.write_text('#!' + sys.executable + '\n' + PROVIDER); provider.chmod(0o700)
        launch = ['env', *[k + '=' + v for k, v in self.env.items()], sys.executable, str(BRIDGE), 'launch', '--',
                  str(provider), '--no-daemon', '-c', 'model_reasoning_effort="high"']
        self.pane = self.tmux('new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture',
                              shlex.join(launch), ';', 'set-option', '-t', 'fixture', 'destroy-unattached', 'off')
        deadline = time.monotonic() + 6
        while not self.control.exists() and time.monotonic() < deadline: time.sleep(.02)
        self.assertTrue(self.control.exists(), self.tmux('capture-pane', '-p', '-t', self.pane))
        self.identity = call(self.control, dict(op='identity'))
        self.payload = dict(hook_event_name='Stop', session_id='root-session-111', turn_id='root-turn-11111',
                            last_assistant_message='Fixture completion', background_tasks=[], session_crons=[], goal=None)

    def tearDown(self):
        if hasattr(self, 'tmux_socket'):
            subprocess.run(['tmux', '-S', self.tmux_socket, 'kill-server'], capture_output=True)
        if hasattr(self, 'service'):
            self.service.kill(); self.service.communicate(timeout=3)
        if hasattr(self, 'temp'): self.temp.cleanup()

    def tmux(self, *args):
        return subprocess.check_output(['tmux', '-S', self.tmux_socket, '-f', '/dev/null', *args], text=True, timeout=5).strip()

    def store(self, **request):
        result = call(self.state / 'notifications.sock', request or dict(op='fixture'))
        self.assertTrue(result['ok'], result)
        return result['data']

    def notify(self, turn=None, nested=False):
        return call(self.control, dict(op='nested' if nested else 'notify', payload={
            'type': 'agent-turn-complete', 'thread-id': self.payload['session_id'],
            'turn-id': turn or self.payload['turn_id']}))

    def accepted(self):
        result = call(self.control, dict(op='stop', payload=self.payload))
        self.assertEqual((result['status'], result['stdout']), (0, '{}\n'), result)
        return result

    def subscribe(self, device):
        self.store(op='register', device=device, token='ab' * 32, environment='production')
        pane = self.store()['runs'][0]['pane']
        self.store(op='subscribe', device=device, scope='scope-11111111', pane=pane, enabled=True, revision=1, label='Private fixture')

    def test_pane_bootstrap_completion_order_retry_nested_and_no_shell_duplicate(self):
        snapshot = self.store()
        self.assertEqual(str(self.identity['pid']), self.identity['owner'])
        self.assertEqual(self.identity['pythonpath'], self.env.get('PYTHONPATH'))
        self.assertEqual(self.identity['pane'], self.pane)
        self.assertEqual(len(snapshot['runs']), 1, str(call(self.control, dict(op='report'))) + str(call(self.control, dict(op='source'))) + str(self.identity) + self.tmux('capture-pane', '-p', '-t', self.pane))
        run = snapshot['runs'][0]
        self.assertEqual(run['run'], self.identity['run'])
        self.assertTrue(run['managed'])
        self.assertTrue(run['pane'].startswith('tmux:'))
        self.assertEqual(len(snapshot['sources']), 1)
        # Notify before candidate fails closed; the original callback still runs.
        self.assertEqual(self.notify()['status'], 0)
        self.assertEqual(self.store()['outbox'], [])
        self.accepted(); self.assertEqual(len(self.store()['codex_candidates']), 1)
        self.notify()  # First verified root establishes readiness, no delivery.
        self.subscribe('device-11111111')
        self.payload['turn_id'] = 'root-turn-22222'
        self.accepted()
        self.assertEqual(self.store()['outbox'], [])
        self.subscribe('device-22222222')  # Enable after Stop must not replay.
        self.notify(nested=True)
        self.assertEqual(self.store()['outbox'], [])
        self.notify(); self.notify()  # delayed/retried original callback
        outbox = self.store()['outbox']
        self.assertEqual([item['device'] for item in outbox], ['device-11111111'])
        call(self.control, dict(op='shell-end'))
        self.assertEqual(len(self.store()['outbox']), 1)
        self.assertEqual(call(self.control, dict(op='identity')), self.identity, 'provider died/restarted after completion')
        self.assertEqual(self.tmux('display-message', '-p', '-t', self.pane, '#{pane_dead}'), '0')

    def test_missing_registry_untrusted_stop_and_unknown_pane_suppress_real_reporter(self):
        for env, mutate in (({}, lambda p: p.pop('background_tasks')),
                            ({'FIXTURE_TRUST': 'untrusted'}, lambda p: None),
                            ({'TMUX': '/wrong/socket,999,0'}, lambda p: None)):
            payload = dict(self.payload); mutate(payload)
            result = call(self.control, dict(op='stop', payload=payload, env=env))
            self.assertEqual((result['status'], result['stdout']), (0, '{}\n'), result)
            self.notify()
            self.assertEqual(self.store()['codex_candidates'], [])
            self.assertEqual(self.store()['outbox'], [])


if __name__ == '__main__':
    unittest.main()
