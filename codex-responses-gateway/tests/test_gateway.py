import http.client
import http.server
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.received.append((self.path, self.headers['Authorization'], body))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        self.wfile.write(b'data: {"type":"response.completed"}\n\n')

    def log_message(self, *args):
        pass


class GatewayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        folder = Path(cls.temp.name)
        cls.upstreams = []
        for _ in range(2):
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            server.received = []
            threading.Thread(target=server.serve_forever, daemon=True).start()
            cls.upstreams.append(server)
            cls.addClassCleanup(server.server_close)
            cls.addClassCleanup(server.shutdown)
        database = folder / 'providers.db'
        with sqlite3.connect(database) as db:
            db.execute('CREATE TABLE providers (name TEXT, app_type TEXT, settings_config TEXT)')
            for i, name in enumerate(('HeroHao-CN', 'WeCoding-Pin')):
                port = cls.upstreams[i].server_port
                base = f'http://127.0.0.1:{port}' + ('/v1' if i else '')
                settings = {'auth': {'OPENAI_API_KEY': f'upstream-key-{i}'}, 'config':
                    f'model_provider = "custom"\n[model_providers.custom]\nbase_url = "{base}"\nwire_api = "responses"\n'}
                db.execute('INSERT INTO providers VALUES (?, ?, ?)', (name, 'codex', json.dumps(settings)))
                db.execute('INSERT INTO providers VALUES (?, ?, ?)', (name, 'claude', '{}'))
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        config = json.loads((ROOT / 'routes.json').read_text())
        config['listen']['port'] = cls.port
        config['ccSwitchDatabase'] = str(database)
        config['models']['gpt-alias'] = {'ccSwitchProvider': 'HeroHao-CN', 'upstreamModel': 'glm-5.3'}
        config['models']['gpt-special-*'] = {'ccSwitchProvider': 'HeroHao-CN'}
        config['models']['legacy'] = {'baseUrlEnv': 'TEST_BASE', 'apiKeyEnv': 'TEST_KEY', 'reasoningEffort': False, 'store': False}
        path = folder / 'routes.json'
        path.write_text(json.dumps(config))
        cls.env = {**os.environ, 'CODEX_GATEWAY_API_KEY': 'local-key',
                   'TEST_BASE': f'http://127.0.0.1:{cls.upstreams[1].server_port}', 'TEST_KEY': 'legacy-key'}
        cls.command = ['node', str(ROOT / 'gateway.mjs'), '--config', str(path)]
        cls.process = subprocess.Popen(cls.command, env=cls.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def stop():
            cls.process.terminate()
            cls.process.wait(timeout=5)
        cls.addClassCleanup(stop)
        for _ in range(100):
            try:
                connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=1)
                connection.request('GET', '/healthz')
                if connection.getresponse().status == 200:
                    connection.close()
                    break
            except OSError:
                time.sleep(.05)
        else:
            raise RuntimeError('Gateway did not start')

    def request(self, body, path='/v1/responses', key='local-key'):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        try:
            connection.request('POST', path, json.dumps(body), {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_family_credentials_and_stream(self):
        for model, index in [('glm-5.3', 0), ('deepseek-v3.2', 0), ('GLM-5', 0), ('gpt-6-astra', 1), ('gpt-5.6-sol', 1)]:
            with self.subTest(model=model):
                body = {'model': model, 'stream': True, 'reasoning': {'effort': 'high'}, 'store': True, 'input': []}
                status, data = self.request(body, '/responses?test=1')
                self.assertEqual(status, 200)
                self.assertIn(b'response.completed', data)
                self.assertEqual(self.upstreams[index].received[-1], ('/v1/responses?test=1', f'Bearer upstream-key-{index}', body))

    def test_default_and_compact(self):
        self.assertEqual(self.request({'input': []}, '/responses/compact')[0], 200)
        self.assertEqual(self.upstreams[1].received[-1][0], '/v1/responses/compact')

    def test_unknown_and_auth(self):
        before = sum(len(s.received) for s in self.upstreams)
        self.assertEqual(self.request({'model': 'unknown'})[0], 400)
        self.assertEqual(self.request({'model': '__proto__'})[0], 400)
        self.assertEqual(self.request({'model': 'glm-5.3'}, key='wrong')[0], 401)
        self.assertEqual(sum(len(s.received) for s in self.upstreams), before)

    def test_precedence_and_legacy(self):
        self.assertEqual(self.request({'model': 'gpt-alias'})[0], 200)
        self.assertEqual(self.upstreams[0].received[-1][2]['model'], 'glm-5.3')
        self.assertEqual(self.request({'model': 'gpt-special-test'})[0], 200)
        self.assertEqual(self.upstreams[0].received[-1][2]['model'], 'gpt-special-test')
        self.assertEqual(self.request({'model': 'legacy', 'reasoning': {'effort': 'high'}, 'store': True})[0], 200)
        _, auth, body = self.upstreams[1].received[-1]
        self.assertEqual(auth, 'Bearer legacy-key')
        self.assertNotIn('reasoning', body)
        self.assertFalse(body['store'])

    def test_route_output_has_no_secret(self):
        result = subprocess.run(self.command + ['--print-route', 'glm-5.3'], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['ccSwitchProvider'], 'HeroHao-CN')
        self.assertNotIn('upstream-key-', result.stdout + result.stderr)
        self.assertNotIn('local-key', result.stdout + result.stderr)
