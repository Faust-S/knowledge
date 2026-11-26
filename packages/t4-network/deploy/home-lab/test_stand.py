#!/usr/bin/env python3
"""Actual Apache TLS/WebDAV qualification of P0; no Docker or identity runtime."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from stand import prepare, private_network, realm, read_env, CLIENTS


def command(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


class StaticChecks(unittest.TestCase):
    def test_network(self):
        self.assertEqual(private_network('192.168.20.12', '192.168.20.0/24'), ('192.168.20.12', '192.168.20.0/24'))
        for address, cidr in [('8.8.8.8', '8.8.8.0/24'), ('127.0.0.1', '127.0.0.0/24'),
                              ('192.168.2.0', '192.168.2.0/24'), ('10.1.1.1', '10.0.0.0/8'),
                              ('192.168.3.2', '192.168.2.0/24'), ('192.168.3.2', '192.168.3.2/24')]:
            with self.subTest(address=address, cidr=cidr), self.assertRaises(ValueError):
                private_network(address, cidr)

    def test_realm(self):
        r = realm()
        self.assertEqual(r['realm'], 'iwxa-test')
        self.assertEqual(r['users'], [])
        self.assertFalse(r['registrationAllowed'])
        self.assertEqual(len(r['clients']), 2)
        for name, c in zip(CLIENTS, r['clients']):
            self.assertEqual(c['clientId'], 'iwxa-test-' + name)
            self.assertEqual(c['redirectUris'], ['https://' + name + '.iwxa.test/oidc/callback'])
            self.assertEqual(c['attributes']['pkce.code.challenge.method'], 'S256')
            for field in ('publicClient', 'implicitFlowEnabled', 'directAccessGrantsEnabled', 'serviceAccountsEnabled', 'fullScopeAllowed'):
                self.assertFalse(c[field])


@unittest.skipUnless(os.geteuid() == 0, 'Actual Apache test requires root for isolated temporary Apache user')
class ActualApache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='iwxa-t4-stand-')
        os.chmod(cls.temp.name, 0o755)
        cls.root = Path(cls.temp.name) / 'state'
        with socket.socket() as s:
            s.bind(('127.0.0.2', 0)); cls.port = s.getsockname()[1]
        cls.passwords = prepare(cls.root, '127.0.0.2', '127.0.0.0/8', cls.port)
        cls.ca = cls.root / 'config/ca.crt'
        cls.config = cls.root / 'config/p0.conf'
        command('apache2', '-t', '-f', str(cls.config))
        cls.p = subprocess.Popen(['apache2', '-f', str(cls.config), '-DFOREGROUND'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.temp.cleanup)
        cls.addClassCleanup(cls.stop)
        for _ in range(80):
            try:
                if cls.request('/workspace-a/', 'PROPFIND', 't4-source')[0] == 207:
                    return
            except subprocess.CalledProcessError:
                time.sleep(0.05)
        raise RuntimeError('Apache did not start: ' + (cls.root / 'logs/error.log').read_text())

    @classmethod
    def stop(cls):
        if cls.p.poll() is None:
            cls.p.terminate(); cls.p.wait(timeout=10)

    @classmethod
    def request(cls, path, method='GET', user=None, data=None, host='dav.iwxa.test', address='127.0.0.2', ca=True, headers=(), create_only=True):
        args = ['curl', '--noproxy', '*', '--silent', '--show-error', '--max-time', '8', '--path-as-is',
                '--resolve', f'{host}:{cls.port}:{address}', '-X', method, '-w', '\n%{http_code}',
                f'https://{host}:{cls.port}{path}']
        if ca:
            args += ['--cacert', str(cls.ca)]
        if user:
            args += ['--user', user + ':' + cls.passwords[user]]
        if data is not None:
            args += ['--data-binary', '@-']
        if method == 'PROPFIND':
            args += ['-H', 'Depth: 1']
        if method == 'PUT' and create_only:
            args += ['-H', 'If-None-Match: *']
        for header in headers:
            args += ['-H', header]
        result = command(*args, input=data).stdout
        body, code = result.rsplit(b'\n', 1)
        return int(code), body

    def test_01_permissions_and_no_overwrite(self):
        self.assertEqual((self.root / 'private/compose.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'private/ca.key').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / 'config/dav.htpasswd').stat().st_mode & 0o777, 0o640)
        self.assertEqual((self.root / 'config/edge.key').stat().st_mode & 0o777, 0o600)
        env = read_env(self.root / 'private/compose.env')
        self.assertEqual(len(set(v for k, v in env.items() if k.endswith(('PASSWORD', 'SECRET')))), 7)
        with self.assertRaises(FileExistsError):
            prepare(self.root, '127.0.0.2', '127.0.0.0/8', self.port)

    def test_02_shared_workspace_and_large_asset(self):
        content = b'iwxa-t4-frame\x00' * 75000
        path = '/workspace-a/' + hashlib.sha256(content).hexdigest() + '.t4n'
        self.assertIn(self.request(path, 'PUT', 't4-source', content)[0], (201, 204))
        status, body = self.request(path, 'GET', 't4-recipient')
        self.assertEqual(status, 200)
        self.assertEqual(hashlib.sha256(body).digest(), hashlib.sha256(content).digest())
        self.assertEqual(self.request('/workspace-a/', 'PROPFIND', 't4-recipient')[0], 207)
        self.assertEqual(self.request(path, 'PUT', 't4-recipient', b'changed')[0], 412)
        self.assertEqual(self.request(path, 'GET', 't4-recipient'), (200, content))
        self.assertIn(self.request(path, 'DELETE', 't4-recipient')[0], (401, 403, 405))
        self.assertIn(self.request(path, 'PUT', 't4-source', b'changed', create_only=False)[0], (401, 403, 405))

    def test_03_workspace_isolation(self):
        path = '/workspace-b/' + 'b'*64 + '.t4n'
        self.assertIn(self.request(path, 'PUT', 't4-other', b'other')[0], (201, 204))
        for user, target in [('t4-source', path), ('t4-recipient', path), ('t4-other', '/workspace-a/' + 'c'*64 + '.t4n')]:
            for method in ('GET', 'PUT', 'DELETE', 'PROPFIND'):
                with self.subTest(user=user, method=method):
                    code, _ = self.request(target, method, user, b'blocked' if method == 'PUT' else None)
                    self.assertIn(code, (401, 403, 404))
        self.assertEqual(self.request(path, 'GET', 't4-other'), (200, b'other'))
        self.assertFalse((self.root / 'dav/workspace-a' / ('c'*64 + '.t4n')).exists())
        self.assertEqual(self.request(path, 'GET')[0], 401)
        for method in ('COPY', 'MOVE', 'DELETE', 'MKCOL', 'PROPPATCH', 'LOCK', 'UNLOCK'):
            code, _ = self.request(path, method, 't4-other', headers=('Destination: https://dav.iwxa.test:' + str(self.port) + '/workspace-a/' + 'd'*64 + '.t4n',))
            self.assertIn(code, (401, 403, 405))
        self.assertFalse((self.root / 'dav/workspace-a' / ('d'*64 + '.t4n')).exists())
        self.assertIn(self.request('/workspace-a/arbitrary.html', 'PUT', 't4-source', b'blocked')[0], (401, 403, 405))
        for p in ('/workspace-a/../workspace-b/' + 'b'*64 + '.t4n', '/workspace-a/%2e%2e/workspace-b/' + 'b'*64 + '.t4n'):
            self.assertNotEqual(self.request(p, 'GET', 't4-source')[0], 200)

    def test_04_closed_routes_and_tls(self):
        self.assertEqual(self.request('/', user='t4-source')[0], 403)
        self.assertEqual(self.request('/', host='deny.iwxa.test')[0], 403)
        self.assertEqual(self.request('/admin/', host='id.iwxa.test')[0], 403)
        self.assertEqual(self.request('/workspace-a/', user='t4-source', address='127.0.0.1')[0], 403)
        with self.assertRaises(subprocess.CalledProcessError):
            self.request('/workspace-a/', user='t4-source', ca=False)
        with self.assertRaises(subprocess.CalledProcessError):
            self.request('/workspace-a/', user='t4-source', host='unknown.iwxa.test')

    def test_05_identity_config_is_separate(self):
        config = (self.root / 'config/identity.conf').read_text()
        p0 = self.config.read_text()
        self.assertNotIn('auth_openidc_module', p0)
        self.assertNotIn('ProxyPass ', p0)
        idp = (self.root / 'config/idp.conf').read_text()
        self.assertNotIn('auth_openidc_module', idp)
        self.assertIn('ProxyPass "/realms/iwxa-test/"', idp)
        self.assertIn('auth_openidc_module', config)
        self.assertEqual(config.count('OIDCPKCEMethod S256'), 2)
        self.assertEqual(config.count('OIDCSSLValidateServer On'), 2)
        self.assertIn('ProxyPass "/realms/iwxa-test/"', config)
        self.assertNotIn('ProxyPass "/realms/"', config)
        self.assertEqual(config.count('ProxyPass / http://127.0.0.1:18080/'), 1)
        self.assertIn('Require local', config)


class DummyUpstream(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        body = json.dumps({'path': self.path, 'proto': self.headers.get('X-Forwarded-Proto'),
                           'host': self.headers.get('X-Forwarded-Host'), 'port': self.headers.get('X-Forwarded-Port'),
                           'for': self.headers.get('X-Forwarded-For'), 'forwarded': self.headers.get('Forwarded'),
                           'prefix': self.headers.get('X-Forwarded-Prefix')}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)


@unittest.skipUnless(os.geteuid() == 0, 'Actual Apache test requires root')
class ProxyEdge(unittest.TestCase):
    def test_identity_proxy_routing_not_keycloak(self):
        with tempfile.TemporaryDirectory(prefix='iwxa-t4-proxy-') as d:
            os.chmod(d, 0o755)
            root = Path(d) / 'state'
            with socket.socket() as s:
                s.bind(('127.0.0.2', 0)); port = s.getsockname()[1]
            prepare(root, '127.0.0.2', '127.0.0.0/8', port)
            config = root / 'config/idp.conf'
            command('apache2', '-t', '-f', str(config))
            server = ThreadingHTTPServer(('127.0.0.1', 18080), DummyUpstream)
            t = threading.Thread(target=server.serve_forever, daemon=True); t.start()
            p = subprocess.Popen(['apache2', '-f', str(config), '-DFOREGROUND'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            def request(path, addr='127.0.0.2'):
                r = command('curl', '--noproxy', '*', '--silent', '--show-error', '--max-time', '5', '--path-as-is',
                            '--resolve', f'id.iwxa.test:{port}:{addr}', '--cacert', str(root / 'config/ca.crt'),
                            '-H', 'Forwarded: for=evil', '-H', 'X-Forwarded-Proto: http', '-H', 'X-Forwarded-Host: evil',
                            '-H', 'X-Forwarded-Port: 80', '-H', 'X-Forwarded-For: evil', '-H', 'X-Forwarded-Prefix: /evil',
                            '-w', '\n%{http_code}', f'https://id.iwxa.test:{port}{path}').stdout
                body, status = r.rsplit(b'\n', 1); return int(status), body
            try:
                route = '/realms/iwxa-test/.well-known/openid-configuration'
                for _ in range(80):
                    try:
                        status, body = request(route)
                        if status == 200:
                            break
                    except subprocess.CalledProcessError:
                        pass
                    time.sleep(0.05)
                else:
                    self.fail('Proxy did not start')
                data = json.loads(body)
                self.assertEqual(data['path'], route)
                self.assertEqual(data['proto'], 'https')
                self.assertEqual(data['host'], 'id.iwxa.test')
                self.assertEqual(data['port'], '443')
                self.assertEqual(data['for'], '127.0.0.1')
                self.assertIsNone(data['forwarded'])
                self.assertIsNone(data['prefix'])
                for path in ('/', '/admin/', '/realms/master/', '/metrics', '/health', '/realms/iwxa-test/../master/', '/realms/iwxa-test/%2e%2e/master/'):
                    self.assertIn(request(path)[0], (400, 403, 404))
                self.assertEqual(request('/resources/test')[0], 200)
                self.assertEqual(request('/admin/', '127.0.0.1')[0], 200)
            finally:
                p.terminate(); p.wait(timeout=10); server.shutdown(); server.server_close(); t.join(timeout=5)


if __name__ == '__main__':
    unittest.main(verbosity=2)
