"""Bridge contract tests. Run with the released Relay venv/PYTHONPATH.

Only disposable tmux/socket/store/provider fixtures are used, including an
opt-in native Codex TUI against a localhost model. No APNs delivery is tested.
"""
import importlib.util
import http.server
import threading
import json
import os
import queue
from pathlib import Path
import shlex
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing

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
   delay=Path(sys.argv[1])/'response-delay'
   if delay.exists(): await asyncio.sleep(float(delay.read_text()))
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
        self.assertTrue(bridge.sole_trusted_stop(inventory([hook, dict(enabled=True, eventName='postToolUse', **{'async': True})]), expected))
        for bad in ({}, {'data': []}, inventory([]), inventory([hook, hook]),
                    inventory([dict(hook, trustStatus='modified')]),
                    inventory([dict(hook, trustStatus='untrusted')]),
                    inventory([dict(hook, source='plugin')]),
                    inventory([dict(hook, **{'async': True})]),
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
                            last_assistant_message='Fixture completion', stop_hook_active=False)

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

    def test_nested_untrusted_stop_and_unknown_pane_suppress_real_reporter(self):
        for env, mutate in (({}, lambda p: p.update(agent_id='child')),
                            ({'FIXTURE_TRUST': 'untrusted'}, lambda p: None),
                            ({'TMUX': '/wrong/socket,999,0'}, lambda p: None)):
            payload = dict(self.payload); mutate(payload)
            result = call(self.control, dict(op='stop', payload=payload, env=env))
            self.assertEqual((result['status'], result['stdout']), (0, '{}\n'), result)
            self.notify()
            self.assertEqual(self.store()['codex_candidates'], [])
            self.assertEqual(self.store()['outbox'], [])


@unittest.skipUnless(os.environ.get('FM2_TABTAIL_NATIVE_TEST') == '1',
                     'set FM2_TABTAIL_NATIVE_TEST=1 for isolated native Codex TUI integration')
class NativeCodex(unittest.TestCase):
    # Reuse only fixture transport/cleanup; this provider is the installed CLI,
    # not PROVIDER above. Each model response is explicitly released by the test.
    tmux = ReleasedRelay.tmux
    store = ReleasedRelay.store
    subscribe = ReleasedRelay.subscribe

    def setUp(self):
        self.addCleanup(self.cleanup)
        self.temp = tempfile.TemporaryDirectory(prefix='fmtt-tui-')
        self.root = Path(self.temp.name).resolve()
        self.tmux_socket = str(self.root / 'tmux')
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.fmhome = self.root / 'fm'; (self.fmhome / 'tasks').mkdir(parents=True)
        (self.fmhome / 'tasks/worker.json').write_text(json.dumps(dict(id='worker', agent='codex')))
        self.codexhome = self.root / 'codex-home'; self.codexhome.mkdir()
        self.responses = queue.Queue()
        self.requests = []
        fixture = self
        class LocalModel(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
                request = json.loads(body)
                metadata = json.loads(request.get('client_metadata', {}).get('x-codex-turn-metadata', '{}'))
                # Native Codex also asks our model to name the thread. Answer
                # that auxiliary request without consuming a root-turn permit.
                if metadata.get('thread_source') == 'thread_title':
                    response = 'complete'
                else:
                    fixture.requests.append(metadata)
                    response = fixture.responses.get(timeout=40)
                if response == 'error':
                    self.send_response(400); self.end_headers(); self.wfile.write(b'{"error":{"message":"fixture error"}}'); return
                self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                item = dict(type='message', id='msg_fixture', role='assistant', status='completed',
                            content=[dict(type='output_text', text='Fixture complete.', annotations=[])])
                events = [dict(type='response.created', response=dict(id='resp_fixture')),
                          dict(type='response.output_item.added', output_index=0, item=item),
                          dict(type='response.output_item.done', output_index=0, item=item),
                          dict(type='response.completed', response=dict(id='resp_fixture', status='completed', output=[item],
                              usage=dict(input_tokens=1, output_tokens=1, total_tokens=2)))]
                try:
                    for event in events:
                        self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError): pass
        self.model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), LocalModel)
        self.model.daemon_threads = True
        self.thread = threading.Thread(target=self.model.serve_forever, daemon=True); self.thread.start()
        self.config = self.codexhome / 'config.toml'
        # The model and effort are fixture-local; no account credentials or
        # external model service are used and no installed config is changed.
        self.config.write_text('model="gpt-6.1-sol"\nmodel_reasoning_effort="high"\nmodel_provider="fixture"\n'
            'check_for_update_on_startup=false\n[model_providers.fixture]\nname="Local fixture"\n'
            'base_url="http://127.0.0.1:' + str(self.model.server_port) + '/v1"\nwire_api="responses"\nrequires_openai_auth=false\n'
            '[projects.' + json.dumps(str(self.root)) + ']\ntrust_level="trusted"\n')
        controller = 'controller' in self._testMethodName
        task = 'controller:fixture' if controller else 'worker'
        self.task = task
        self.stop_payloads = self.root / 'stops.jsonl'
        self.callbacks = self.root / 'callbacks.jsonl'
        legacy = self.root / 'legacy.py'
        legacy.write_text('import json,os,sqlite3,sys,time\n'
            'db=sqlite3.connect(sys.argv[1])\n'
            'value={"parent":os.getppid(),"argv":sys.argv[3:],"candidates":[dict(zip([d[0] for d in c.description],row)) for c in [db.execute("SELECT * FROM codex_candidates")] for row in c],"at":time.monotonic()}\n'
            'with open(sys.argv[2],"a") as stream: stream.write(json.dumps(value)+"\\n")\n')
        original = [sys.executable, str(legacy), str(self.state / 'db'), str(self.callbacks), 'turn-ended', 'literal\nargument']
        self.config.write_text('notify=' + json.dumps(original) + '\n' + self.config.read_text())
        aggregate = ROOT / ('hooks/supervisor-stop.mjs' if controller else 'hooks/worker-stop.mjs')
        latest = self.root / 'stop.json'
        gate = 'cat > ' + shlex.quote(str(latest)) + '; cat ' + shlex.quote(str(latest)) + ' >> ' + shlex.quote(str(self.stop_payloads)) + '; printf "\\n" >> ' + shlex.quote(str(self.stop_payloads)) + '; ' + shlex.join(['node', str(aggregate)]) + ' < ' + shlex.quote(str(latest))
        self.stop = shlex.join([sys.executable, str(BRIDGE), 'stop', '--', '/bin/sh', '-c', gate])
        self.flags = ['-c', 'hooks.Stop=[{hooks=[{type="command",command=' + json.dumps(self.stop) + '}]}]']
        self.env = {key: value for key, value in os.environ.items()
                    if key in ('PATH', 'HOME', 'TMPDIR', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE',
                               'PYTHONPATH', 'PYTHONDONTWRITEBYTECODE')}
        self.env.update(RELAY_STATE_DIR=str(self.state), RELAY_TMUX_SOCKET=self.tmux_socket,
                        FM2_HOME=str(self.fmhome), FM2_TASK=task, FM2_AGENT='codex', FM2_PANEL='',
                        FM2_TABTAIL='1', FM_REMOTE='yes', CODEX_HOME=str(self.codexhome))
        self.service = subprocess.Popen([sys.executable, '-u', '-c', SERVICE, str(self.state)],
                                        env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(self.service.stdout.readline(), 'ready\n')
        old = os.environ.get('CODEX_HOME'); os.environ['CODEX_HOME'] = str(self.codexhome)
        try:
            inventory, observed_notify = bridge.inspect_codex(shutil.which('codex'), self.flags, str(self.root))
            metadata = inventory['data'][0]['hooks'][0]
            self.assertEqual(observed_notify, original)
            self.assertEqual(metadata['trustStatus'], 'untrusted')
            with self.config.open('a') as stream:
                stream.write('\n[hooks.state.' + json.dumps(metadata['key']) + ']\ntrusted_hash=' + json.dumps(metadata['currentHash']) + '\n')
            trusted, _ = bridge.inspect_codex(shutil.which('codex'), self.flags, str(self.root))
            self.assertTrue(bridge.sole_trusted_stop(trusted, shlex.split(self.stop)), trusted)
        finally:
            if old is None: os.environ.pop('CODEX_HOME', None)
            else: os.environ['CODEX_HOME'] = old
        self.original = original
        launch = ['env', *[k + '=' + v for k, v in self.env.items()], sys.executable, str(BRIDGE), 'launch', '--',
                  shutil.which('codex'), '--no-daemon', '--no-alt-screen', *self.flags]
        self.pane = self.tmux('new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'fixture', '-x', '160', '-y', '40',
                              '-c', str(self.root), shlex.join(launch))
        # Respawn inherits the private server's environment, not Node's caller
        # environment. Keep every replacement in this empty fixture home/store.
        for key in ('CODEX_HOME', 'RELAY_STATE_DIR', 'RELAY_TMUX_SOCKET'):
            self.tmux('set-environment', '-g', key, self.env[key])
        self.until(lambda: 'Ask Codex to do anything' in self.screen(), 'native TUI startup')
        self.owner = self.tmux('display-message', '-p', '-t', self.pane, '#{pane_pid}')
        rows = [line.split() for line in subprocess.check_output(['ps','-axo','pid=,ppid=,comm='],text=True).splitlines()]
        self.native = next(int(pid) for pid, ppid, *command in rows
                           if (pid == self.owner or ppid == self.owner) and Path(' '.join(command)).name == 'codex')
        self.until(lambda: len(self.store()['runs']) == 1, 'run bootstrap')
        self.assertTrue(self.store()['runs'][0]['managed'])

    def cleanup(self):
        evidence = os.environ.get('FM2_TABTAIL_EVIDENCE_DIR')
        if evidence and hasattr(self, 'native'):
            directory = Path(evidence); directory.mkdir(parents=True, exist_ok=True)
            (directory / (self._testMethodName + '.json')).write_text(json.dumps(dict(
                fixture='localhost-only native Codex; released Relay without APNs sender',
                pane=self.pane, owner_pid=self.owner, native_pid=self.native,
                stops=self.records(self.stop_payloads), callbacks=self.records(self.callbacks),
                request_metadata=self.requests, reload=getattr(self, 'reloaded', None),
                recovery=getattr(self, 'recovery', None), store=self.evidence_store()), indent=2))
        if hasattr(self, 'tmux_socket'): subprocess.run(['tmux','-S',self.tmux_socket,'kill-server'],capture_output=True)
        if hasattr(self, 'service'): self.service.kill(); self.service.communicate(timeout=3)
        if hasattr(self, 'model'): self.model.shutdown(); self.model.server_close(); self.thread.join(timeout=2)
        if hasattr(self, 'temp'): self.temp.cleanup()

    def evidence_store(self):
        # The unavailable-service test deliberately removes its socket. Read
        # only this fixture's durable database so cleanup never needs service.
        with closing(sqlite3.connect(self.state / 'db')) as db:
            db.row_factory = sqlite3.Row
            return {table: [dict(row) for row in db.execute('SELECT * FROM ' + table)]
                    for table in ('events', 'runs', 'codex_candidates', 'outbox', 'sources')}

    def screen(self): return self.tmux('capture-pane', '-p', '-t', self.pane)

    def until(self, condition, reason, timeout=12):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition(): return
            time.sleep(.03)
        self.fail(reason + '\n' + self.screen() + '\n' + str(self.store()) + '\nREQUEST METADATA ' + str(self.requests) + '\nCALLBACKS ' + str(self.records(self.callbacks)))

    def records(self, path):
        if not path.exists(): return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def submit(self, response='complete'):
        count = len(self.requests)
        subprocess.run(['tmux','-S',self.tmux_socket,'load-buffer','-b','fixture','-'],
                       input='Return the fixture completion. Do not use tools.',text=True,check=True)
        self.tmux('paste-buffer','-p','-d','-b','fixture','-t',self.pane)
        self.tmux('send-keys','-t',self.pane,'Enter')
        self.until(lambda: len(self.requests) > count, 'model request')
        self.responses.put(response)

    def finished(self, before):
        self.until(lambda: len(self.records(self.stop_payloads)) > before, 'native Stop')
        stop = self.records(self.stop_payloads)[-1]
        def matching():
            return [callback for callback in self.records(self.callbacks)
                    if (json.loads(callback['argv'][-1])['thread-id'], json.loads(callback['argv'][-1])['turn-id'])
                    == (stop['session_id'], stop['turn_id'])]
        self.until(matching, 'matching native root notify callback')
        callback = matching()[0]
        # Wait for the actual notify dispatcher to exit. The original callback
        # runs first; observing its log alone can race the optional reporter.
        def callback_exited():
            try: os.kill(callback['parent'], 0); return False
            except ProcessLookupError: return True
        self.until(callback_exited, 'notify dispatcher exit')
        return stop, callback

    def alive(self):
        self.assertEqual(self.tmux('display-message','-p','-t',self.pane,'#{pane_pid}'), self.owner)
        self.assertEqual(self.tmux('display-message','-p','-t',self.pane,'#{pane_dead}'), '0')
        os.kill(int(self.owner), 0)
        os.kill(self.native, 0)

    def test_native_worker_accepted_candidate_precedes_notify_and_provider_stays_alive(self):
        self.submit(); first, callback = self.finished(0)
        self.until(lambda: self.store()['runs'][0]['ready'] == 1, 'accepted root notify establishes readiness')
        self.assertNotIn('goal', first); self.assertNotIn('background_tasks', first); self.assertNotIn('session_crons', first)
        self.assertEqual(first['hook_event_name'], 'Stop')
        self.assertEqual(callback['argv'][:2], ['turn-ended','literal\nargument'])
        native = json.loads(callback['argv'][2])
        self.assertEqual((native['thread-id'],native['turn-id']), (first['session_id'],first['turn_id']))
        self.assertEqual(native['type'], 'agent-turn-complete')
        self.assertEqual(len(callback['candidates']), 1, 'native notify preceded accepted Stop candidate')
        self.assertEqual(self.store()['outbox'], [])
        self.subscribe('device-11111111')
        before = len(self.records(self.stop_payloads))
        self.submit(); self.finished(before)
        self.until(lambda: len(self.store()['outbox']) == 1, 'one completion after subscription')
        self.assertEqual(self.store()['codex_candidates'], [])
        # Native auxiliary title callbacks are real, and keep the original
        # chain, but have no root Stop and cannot produce an extra delivery.
        self.until(lambda: any(json.loads(item['argv'][-1])['thread-id'] != first['session_id']
                               for item in self.records(self.callbacks)), 'native auxiliary title callback')
        self.assertEqual(len(self.store()['outbox']), 1)
        self.alive()

    def test_native_controller_block_continues_without_candidate_then_accepts(self):
        self.submit(); self.finished(0)
        self.until(lambda: self.store()['runs'][0]['ready'] == 1, 'controller readiness')
        self.subscribe('device-11111111')
        reports = self.fmhome / 'notify'; reports.mkdir(exist_ok=True)
        report = reports / '1-worker.json'
        report.write_text(json.dumps(dict(task='worker', text='unread fixture report', panel='fixture')))
        before = len(self.requests)
        self.submit()
        self.until(lambda: len(self.requests) >= before + 2, 'Stop block must start real continuation')
        self.assertEqual(len(self.records(self.stop_payloads)), 2)
        self.assertEqual(self.store()['codex_candidates'], [])
        self.assertEqual(self.store()['outbox'], [])
        self.assertFalse(self.records(self.stop_payloads)[-1]['stop_hook_active'])
        report.unlink()
        self.responses.put('complete')
        stop, callback = self.finished(2)
        self.assertTrue(stop['stop_hook_active'])
        self.assertEqual(len(callback['candidates']), 1)
        self.until(lambda: len(self.store()['outbox']) == 1, 'accepted continuation completion')
        self.alive()

    def exercise_suppression(self, quiet=False):
        self.submit(); self.finished(0)
        self.until(lambda: self.store()['runs'][0]['ready'] == 1, 'readiness')
        self.subscribe('device-11111111')
        effort = self.fmhome / 'efforts' / (self.task.replace(':', '%3A') + '.json')
        update = self.fmhome / 'provider-updates/state.json'
        lock = self.fmhome / 'panel-locks/fixture'
        taskfile = self.fmhome / 'tasks/worker.json'
        cases = [(effort, dict(pending=dict(status='scheduled', agent='codex', effort='high', token='fixture'))),
                 (update, dict(current=dict(provider='codex', status='stopping', stopping_task=self.task))),
                 (update, None), (lock, {})]
        if quiet: cases.insert(0, (taskfile, dict(id='worker',agent='codex',quiet=True)))
        for path, state in cases:
            with self.subTest(state=str(path.relative_to(self.fmhome)), value=state):
                path.parent.mkdir(parents=True, exist_ok=True)
                original = path.read_text() if path.exists() else None
                path.write_text(json.dumps(state))
                before = len(self.records(self.stop_payloads))
                self.submit(); _, callback = self.finished(before)
                self.assertEqual(callback['candidates'], [])
                self.assertEqual(self.store()['codex_candidates'], [])
                self.assertEqual(self.store()['outbox'], [])
                if original is None: path.unlink()
                else: path.write_text(original)
                self.alive()
        before = len(self.records(self.stop_payloads))
        self.submit('error')
        self.until(lambda: 'fixture error' in self.screen(), 'native failed model response')
        self.assertEqual(len(self.records(self.stop_payloads)), before)
        self.assertEqual(self.store()['codex_candidates'], [])
        self.assertEqual(self.store()['outbox'], [])
        self.alive()

    def test_native_worker_quiet_lifecycle_unknown_and_error_never_complete(self):
        self.exercise_suppression(quiet=True)

    def test_native_controller_lifecycle_unknown_and_error_never_complete(self):
        self.exercise_suppression()

    def reload_worker(self, path=None, route='task'):
        # Run the real switch and cleanup against this fixture's provider only.
        # Override homedir in this child before imports so repository trust and
        # skill synchronization cannot write the owner's global installation.
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('*\n')
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', '.gitignore'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=fixture',
                        '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
        (self.codexhome / 'models_cache.json').write_text(json.dumps(dict(
            fetched_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            models=[dict(slug='gpt-6.1-sol')])))
        bin_path = self.root / 'switch-bin'; bin_path.mkdir(exist_ok=True)
        tmux = bin_path / 'tmux'
        tmux.write_text('#!/bin/sh\nexec ' + shlex.join([shutil.which('tmux'), '-S', self.tmux_socket]) + ' "$@"\n')
        tmux.chmod(0o700)
        script = '''
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
os.homedir=()=>process.argv[1]; syncBuiltinESMExports();
const {loadTask,saveTask}=await import('./fm2/lib/config.mjs');
const {rememberSession,recordedSession}=await import('./fm2/lib/sessions.mjs');
const {switchTask}=await import('./fm2/lib/switch.mjs');
const identity=process.argv[4], route=process.argv[5];
const task=loadTask('worker'), source=recordedSession({id:identity},'codex');
saveTask({...task,id:identity,worktree:process.argv[1],project:process.argv[1],pane:process.argv[2],panel:'fixture',sessions:{codex:source}});
rememberSession({task:identity,agent:'codex',sessionId:source.id,transcriptPath:source.transcript,
  cwd:source.cwd,pane:process.argv[2],providerPid:Number(process.argv[3]),backend:'embedded'});
let result;
try {
  let changed;
  if(route==='controller') {
    const {recordSupervisor}=await import('./fm2/lib/presence.mjs');
    const {reloadController}=await import('./fm2/effort-apply.mjs');
    recordSupervisor(process.argv[2],{panel:'fixture',task:identity,agent:'codex',sessionId:source.id,cwd:source.cwd});
    reloadController(identity,{agent:'codex',effort:'xhigh',from:'high'});
    changed={resumed:source.id,worktreePreserved:true};
  } else if(route==='panel') {
    const {PANEL_RUNTIME}=await import('./fm2/lib/panel-switch.mjs');
    const {launchCommand,writeWorkerSettings}=await import('./fm2/lib/launch.mjs');
    const {panePid}=await import('./fm2/lib/tmux.mjs');
    const pane=process.argv[2], cwd=source.cwd;
    const command=launchCommand({agent:'codex',id:identity,settingsFile:writeWorkerSettings(identity,'codex'),resume:source.id,panel:'fixture'});
    const entry={from:'codex',source:recordedSession({id:identity},'codex'),explicit:true};
    PANEL_RUNTIME.stop({id:pane,pid:panePid(pane),cwd},entry);
    let targetLaunchPid=null;
    try { PANEL_RUNTIME.start(pane,cwd,command,'codex',{onLaunch:pid=>{targetLaunchPid=pid;}}); }
    catch(error) {
      PANEL_RUNTIME.stop({id:pane,pid:panePid(pane),cwd},{...entry,targetLaunch:true,targetLaunchPid});
      PANEL_RUNTIME.start(pane,cwd,command,'codex');
      throw error;
    }
    changed={resumed:source.id,worktreePreserved:true};
  } else changed=switchTask(identity,{agent:'codex'});
  result={ok:true,resumed:changed.resumed,preserved:changed.worktreePreserved};
} catch(error) { result={ok:false,error:error.message}; }
const final=loadTask(identity);
console.log(JSON.stringify({...result,source,sourceId:source.id,recordedId:final.sessions.codex.id,
  agent:final.agent,handoffs:final.handoffs?.length??0}));
'''
        environment = dict(self.env, CODEX_SKILLS_DIR=str(self.root / 'skills'),
                           FM2_TABTAIL_RELAY=str(Path(bridge.RELAY_ADAPTER).parent),
                           PATH=str(bin_path) + ':' + (path or os.environ['PATH']))
        result = subprocess.run(['node', '--input-type=module', '-e', script,
                                 str(self.root), self.pane, str(self.native), self.task, route],
                                cwd=ROOT.parent, env=environment, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.reloaded = json.loads(result.stdout)
        return self.reloaded

    def exact_source_running(self):
        source = self.reloaded['source']
        owner = int(self.tmux('display-message', '-p', '-t', self.pane, '#{pane_pid}'))
        rows = [line.split(maxsplit=2) for line in subprocess.check_output(
            ['ps', '-axo', 'pid=,ppid=,comm='], text=True).splitlines()]
        owned = {owner}
        for _ in rows:
            new = {int(pid) for pid, parent, command in rows if int(parent) in owned}
            if new <= owned: break
            owned.update(new)
        for pid, parent, command in rows:
            if int(pid) not in owned or Path(command).name != 'codex': continue
            args = shlex.split(subprocess.check_output(['ps', '-p', pid, '-o', 'args='], text=True, timeout=5))
            if 'resume' in args and source['id'] in args:
                self.recovery = dict(id=source['id'], transcript=source['transcript'],
                                     owner_pid=owner, native_pid=int(pid))
                return source['id'] == self.reloaded['sourceId']
        return False

    def continue_without_new_hook_trust(self):
        # Exercise normal native review instead of bypassing it. Only this
        # disposable TUI is controlled; these new hooks remain untrusted.
        self.until(lambda: 'Hooks need review' in self.screen(), 'normal new-hook review')
        time.sleep(.2)
        self.tmux('send-keys', '-t', self.pane, '3', 'Enter')
        self.until(lambda: 'Hooks need review' not in self.screen()
                   and ('Ask Codex to do anything' in self.screen() or 'context left' in self.screen()),
                   'resume after declining hook trust')

    def test_native_reload_waits_for_slow_optional_bootstrap(self):
        self.submit(); self.finished(0)
        (self.state / 'response-delay').write_text('.4')
        result = self.reload_worker()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['resumed'], result['sourceId'])
        self.assertEqual(result['recordedId'], result['sourceId'])
        self.assertEqual((result['agent'], result['handoffs'], result['preserved']), ('codex', 1, True))
        self.continue_without_new_hook_trust()
        self.until(self.exact_source_running, 'slow bootstrap exact source running')
        self.submit()
        self.assertEqual(self.requests[-1]['session_id'], result['sourceId'])

    def exercise_slow_restart(self, route):
        self.submit(); self.finished(0)
        (self.state / 'response-delay').write_text('.4')
        result = self.reload_worker(route=route)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['resumed'], result['sourceId'])
        self.continue_without_new_hook_trust()
        self.until(self.exact_source_running, route + ' exact source running')
        self.prove_source_turn(result)

    def prove_source_turn(self, result):
        if self.task.startswith('controller:'):
            # Controller recovery carries its preserved handoff as a prompt.
            self.until(lambda: len(self.requests) > 1, 'resumed controller model request')
            self.responses.put('complete')
        else:
            self.submit()
        self.assertEqual(self.requests[-1]['session_id'], result['sourceId'])

    def test_native_panel_restart_waits_for_slow_optional_bootstrap(self):
        self.exercise_slow_restart('panel')

    def test_native_controller_restart_waits_for_slow_optional_bootstrap(self):
        self.exercise_slow_restart('controller')

    def test_native_reload_retains_provider_when_optional_service_is_unavailable(self):
        self.submit(); self.finished(0)
        self.service.kill(); self.service.communicate(timeout=3)
        (self.state / 'notifications.sock').unlink()
        result = self.reload_worker()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['resumed'], result['sourceId'])
        self.assertEqual((result['agent'], result['handoffs']), ('codex', 1))
        self.continue_without_new_hook_trust()
        self.until(self.exact_source_running, 'unavailable service exact source running')
        self.submit()
        self.assertEqual(self.requests[-1]['session_id'], result['sourceId'])

    def test_native_failed_reload_stops_setup_before_restoring_exact_source(self):
        self.exercise_failed_restart('task')

    def test_native_failed_panel_restart_stops_setup_before_restoring_exact_source(self):
        self.exercise_failed_restart('panel')

    def test_native_failed_controller_restart_stops_setup_before_restoring_exact_source(self):
        self.exercise_failed_restart('controller')

    def exercise_failed_restart(self, route):
        self.submit(); self.finished(0)
        # A disposable executable delays its first real launch beyond the
        # startup budget; inventory still delegates to the installed Codex.
        # Recovery's second launch resumes normally. No live CLI is replaced.
        bin_path = self.root / 'delayed-provider'; bin_path.mkdir()
        delayed = bin_path / 'codex'
        marker, started, child = [self.root / name for name in ('delayed.pid', 'late-start', 'child.pid')]
        native = shutil.which('codex')
        delayed.write_text('#!' + sys.executable + '\nimport os,subprocess,sys,time\nfrom pathlib import Path\n'
            'marker=Path(' + repr(str(marker)) + ')\n'
            'if sys.argv[1:2]!=["app-server"] and not marker.exists():\n'
            ' marker.write_text(str(os.getpid()))\n'
            ' child=subprocess.Popen(["/bin/sleep","10000"])\n'
            ' Path(' + repr(str(child)) + ').write_text(str(child.pid))\n'
            ' time.sleep(8)\n'
            ' Path(' + repr(str(started)) + ').write_text("unexpected late launch")\n'
            'os.execv(' + repr(native) + ',[' + repr(native) + ',*sys.argv[1:]])\n')
        delayed.chmod(0o700)
        result = self.reload_worker(path=str(bin_path) + ':' + os.environ['PATH'], route=route)
        self.assertFalse(result['ok'], result)
        self.assertIn('its codex provider', result['error'])
        self.assertEqual((result['agent'], result['handoffs']), ('codex', 0))
        self.assertEqual(result['recordedId'], result['sourceId'])
        for path in (marker, child):
            self.assertTrue(path.exists())
            with self.assertRaises(ProcessLookupError): os.kill(int(path.read_text()), 0)
        self.assertFalse(started.exists(), 'failed replacement remained capable of executing Codex')
        self.continue_without_new_hook_trust()
        # New hook definitions retain normal trust; a stale SessionStart record
        # is not proof of recovery. Observe its explicit resume argv and a real
        # subsequent model request from that exact native conversation.
        self.until(self.exact_source_running, 'failed launch exact source running')
        self.prove_source_turn(result)


if __name__ == '__main__':
    unittest.main()
