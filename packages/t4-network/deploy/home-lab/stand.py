#!/usr/bin/env python3
"""Prepare isolated IWXA TEST infrastructure; never grants T3/T4 authority."""
import argparse
import grp
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path('/var/lib/iwxa-t4-test')
HERE = Path(__file__).resolve().parent
ISSUER = 'https://id.iwxa.test/realms/iwxa-test'
TAGS = {'KEYCLOAK_IMAGE': 'quay.io/keycloak/keycloak:26.8.2',
        'POSTGRES_IMAGE': 'postgres:17.12'}
CLIENTS = ('marketops', 'artbazi')
DAV_USERS = ('t4-source', 't4-recipient', 't4-other')
MODULES = {'mpm_event': 'mpm_event', 'authn_core': 'authn_core',
           'authn_file': 'authn_file', 'authz_core': 'authz_core',
           'authz_host': 'authz_host', 'authz_user': 'authz_user',
           'auth_basic': 'auth_basic', 'ssl': 'ssl', 'socache_shmcb': 'socache_shmcb',
           'dav': 'dav', 'dav_fs': 'dav_fs', 'proxy': 'proxy', 'proxy_http': 'proxy_http',
           'headers': 'headers', 'mime': 'mime', 'dir': 'dir', 'alias': 'alias', 'env': 'env', 'setenvif': 'setenvif'}


def run(*args, **kw):
    return subprocess.run(args, check=True, **kw)


def private_network(address, cidr):
    a = ipaddress.IPv4Address(address)
    n = ipaddress.IPv4Network(cidr, strict=True)
    ranges = [ipaddress.IPv4Network(x) for x in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')]
    if n.prefixlen < 16 or not any(n.subnet_of(r) for r in ranges) or a not in n or a in (n.network_address, n.broadcast_address):
        raise ValueError('Use the actual RFC1918 LAN IPv4 address and explicit /16 or narrower LAN subnet')
    return str(a), str(n)


def write(path, data, mode=0o600):
    with path.open('x', encoding='utf-8') as f:
        os.fchmod(f.fileno(), mode)
        f.write(data)


def directory(path, mode, gid=None):
    path.mkdir(mode=mode)
    os.chmod(path, mode)
    if gid is not None:
        os.chown(path, 0, gid)


def realm():
    clients = []
    for name in CLIENTS:
        host = f'https://{name}.iwxa.test'
        clients.append({'clientId': f'iwxa-test-{name}', 'name': f'{name} SSO probe only',
                        'enabled': True, 'protocol': 'openid-connect', 'publicClient': False,
                        'clientAuthenticatorType': 'client-secret', 'secret': '${IWXA_' + name.upper() + '_CLIENT_SECRET}',
                        'standardFlowEnabled': True, 'implicitFlowEnabled': False, 'directAccessGrantsEnabled': False,
                        'serviceAccountsEnabled': False, 'fullScopeAllowed': False,
                        'redirectUris': [host + '/oidc/callback'], 'webOrigins': [],
                        'attributes': {'pkce.code.challenge.method': 'S256',
                                       'post.logout.redirect.uris': host + '/'},
                        'defaultClientScopes': [], 'optionalClientScopes': []})
    return {'realm': 'iwxa-test', 'enabled': True, 'sslRequired': 'all',
            'registrationAllowed': False, 'resetPasswordAllowed': False,
            'loginWithEmailAllowed': False, 'duplicateEmailsAllowed': False,
            'bruteForceProtected': True, 'accessTokenLifespan': 300,
            'ssoSessionIdleTimeout': 1800, 'ssoSessionMaxLifespan': 28800,
            'revokeRefreshToken': True, 'refreshTokenMaxReuse': 0,
            'clients': clients, 'users': []}


def apache_config(root, address, cidr, config, identity=False, probes=False, port=443):
    """port is injectable only for the actual loopback regression."""
    c = root / 'config'
    endpoint = f'{address}:{port}'
    admin = f'127.0.0.1:{port}'
    modules = dict(MODULES)
    if probes and not identity:
        raise ValueError('SSO probes require the identity proxy')
    if probes:
        modules['auth_openidc'] = 'auth_openidc'
    lines = [f'ServerRoot "{root}"', f'PidFile "{root}/run/apache.pid"',
             f'DefaultRuntimeDir "{root}/run"', 'ServerName id.iwxa.test',
             f'Listen {endpoint} https', f'Listen {admin} https']
    lines += [f'LoadModule {mod}_module /usr/lib/apache2/modules/mod_{file}.so' for mod, file in modules.items()]
    lines += ['User www-data', 'Group www-data', f'ErrorLog "{root}/logs/error.log"', 'LogLevel warn',
              'LogFormat "%t %m %>s %D" t4minimal', f'CustomLog "{root}/logs/access.log" t4minimal',
              'ServerTokens Prod', 'ServerSignature Off', 'TraceEnable Off', 'SSLProtocol -all +TLSv1.2 +TLSv1.3',
              'SSLSessionCache none', 'TypesConfig /etc/mime.types', 'DirectoryIndex index.html',
              'ProxyRequests Off', 'ProxyTimeout 30', 'ProxyAddHeaders Off', 'AllowEncodedSlashes Off',
              'FileETag MTime Size', f'DavLockDB "{root}/run/dav/locks"',
              '<Directory />', '  Options None', '  AllowOverride None', '  Require all denied', '</Directory>']
    tls = ['  SSLEngine on', f'  SSLCertificateFile "{c}/edge.crt"', f'  SSLCertificateKeyFile "{c}/edge.key"',
           '  Header always set Referrer-Policy "no-referrer"', '  Header always set X-Content-Type-Options "nosniff"']

    def vhost(bind, host, body):
        lines.extend([f'<VirtualHost {bind}>', f'  ServerName {host}', *tls, *body, '</VirtualHost>'])

    for bind in (endpoint, admin):
        vhost(bind, 'deny.iwxa.test', [f'  DocumentRoot "{root}/empty"', '  <Location />', '    Require all denied', '  </Location>'])
    dav = [f'  DocumentRoot "{root}/dav"', f'  <Directory "{root}/dav">', '    Require all denied', '  </Directory>']
    for name, users in [('workspace-a', 't4-source t4-recipient'), ('workspace-b', 't4-other')]:
        dav += [f'  <Directory "{root}/dav/{name}">', '    Dav On', '    Options None', '    AllowOverride None',
                '    AuthType Basic', '    AuthName "IWXA T4 TEST transport"', f'    AuthUserFile "{c}/dav.htpasswd"',
                '    LimitRequestBody 268435456', '    Header always set Content-Security-Policy "default-src \'none\'; sandbox"',
                '    <RequireAll>', f'      Require ip {cidr}', f'      Require user {users}',
                '      Require method GET HEAD PUT PROPFIND',
                f'      Require expr "%{{REQUEST_URI}} =~ m#^/{name}/(?:[0-9a-f]{{64}}[.](?:t4n|t4i|t4d|iwxa))?$#"',
                f'      Require expr "%{{REQUEST_METHOD}} != \'PUT\' || (req(\'If-None-Match\') == \'*\' && %{{REQUEST_URI}} != \'/{name}/\')"',
                f'      Require expr "%{{REQUEST_METHOD}} != \'PROPFIND\' || (req(\'Depth\') == \'1\' && %{{REQUEST_URI}} == \'/{name}/\')"',
                '    </RequireAll>', '  </Directory>']
    vhost(endpoint, 'dav.iwxa.test', dav)
    if identity:
        def proxy_headers():
            return ['  ProxyPreserveHost On', '  RequestHeader unset Forwarded',
                    '  RequestHeader unset X-Forwarded-Prefix', '  RequestHeader unset X-Forwarded-Server',
                    '  RequestHeader set X-Forwarded-Host "id.iwxa.test"', '  RequestHeader set X-Forwarded-Port "443"',
                    '  RequestHeader set X-Forwarded-Proto "https"', '  RequestHeader set X-Forwarded-For "expr=%{REMOTE_ADDR}"',
                    '  Header always set Cache-Control "no-store"']
        public = proxy_headers() + [f'  DocumentRoot "{root}/empty"', '  <Location />', '    Require all denied', '  </Location>']
        for path in ('/realms/iwxa-test/', '/resources/'):
            public += [f'  ProxyPass "{path}" "http://127.0.0.1:18080{path}"',
                       f'  ProxyPassReverse "{path}" "http://127.0.0.1:18080{path}"',
                       f'  <Location "{path}">', f'    Require ip {cidr}', '  </Location>']
        vhost(endpoint, 'id.iwxa.test', public)
        vhost(admin, 'id.iwxa.test', proxy_headers() + ['  ProxyPass / http://127.0.0.1:18080/',
              '  ProxyPassReverse / http://127.0.0.1:18080/', '  <Location />', '    Require local', '  </Location>'])
    if probes:
        for name in CLIENTS:
            host = f'{name}.iwxa.test'
            vhost(endpoint, host, [f'  DocumentRoot "{root}/probes/{name}"',
                  f'  OIDCProviderMetadataURL {ISSUER}/.well-known/openid-configuration', f'  OIDCProviderIssuer {ISSUER}',
                  f'  OIDCRedirectURI https://{host}/oidc/callback', f'  OIDCClientID iwxa-test-{name}',
                  f'  OIDCClientSecret "{config[name.upper()+"_CLIENT_SECRET"]}"',
                  f'  OIDCCryptoPassphrase "{config[name.upper()+"_COOKIE_SECRET"]}"',
                  '  OIDCSSLValidateServer On', f'  OIDCCABundlePath "{c}/ca.crt"', '  OIDCResponseType code',
                  '  OIDCResponseMode query', '  OIDCPKCEMethod S256', '  OIDCScope "openid"', '  OIDCRemoteUserClaim sub@',
                  '  OIDCSessionType server-cache', '  OIDCSessionCacheFallbackToCookie Off', '  OIDCSessionMaxDuration 300', '  OIDCSessionInactivityTimeout 300',
                  f'  OIDCCookie __Host-iwxa-{name}-test', '  OIDCCookieHTTPOnly On', '  OIDCCookieSameSite Lax',
                  '  Header always set Cache-Control "no-store"',
                  f'  <Directory "{root}/probes/{name}">', '    Require all granted', '  </Directory>',
                  '  <Location />', '    AuthType openid-connect', '    <RequireAll>', f'      Require ip {cidr}',
                  '      Require valid-user', '    </RequireAll>', '  </Location>'])
    return '\n'.join(lines) + '\n'


def prepare(root, address, cidr, port=443):
    """No changes outside a new root; never overwrites existing state."""
    gid = grp.getgrnam('www-data').gr_gid
    uid = __import__('pwd').getpwnam('www-data').pw_uid
    directory(root, 0o750, gid)
    for name, mode, group in [('private', 0o700, None), ('config', 0o750, gid), ('run', 0o750, gid),
                              ('logs', 0o750, gid), ('empty', 0o750, gid), ('dav', 0o750, gid), ('probes', 0o750, gid)]:
        directory(root / name, mode, group)
    directory(root / 'run/dav', 0o750, gid)
    os.chown(root / 'run/dav', uid, gid)
    for name in ('workspace-a', 'workspace-b'):
        directory(root / 'dav' / name, 0o750, gid)
        os.chown(root / 'dav' / name, uid, gid)
    c, p = root / 'config', root / 'private'
    passwords = {name: secrets.token_hex(24) for name in DAV_USERS}
    for i, name in enumerate(DAV_USERS):
        run('htpasswd', '-iB' + ('c' if i == 0 else ''), str(c / 'dav.htpasswd'), name,
            input=passwords[name] + '\n', text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.chown(c / 'dav.htpasswd', 0, gid)
    os.chmod(c / 'dav.htpasswd', 0o640)
    write(p / 'dav-credentials.json', json.dumps(passwords, indent=2) + '\n')
    # CA key is separate from the leaf; only ca.crt is distributed to clients.
    ext = 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:id.iwxa.test,DNS:dav.iwxa.test,DNS:marketops.iwxa.test,DNS:artbazi.iwxa.test,DNS:deny.iwxa.test\n'
    write(p / 'leaf.ext', ext)
    quiet = {'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL}
    run('openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650', '-subj', '/CN=IWXA TEST local CA',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-keyout', str(p / 'ca.key'), '-out', str(c / 'ca.crt'), **quiet)
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=id.iwxa.test', '-keyout', str(c / 'edge.key'),
        '-out', str(p / 'edge.csr'), **quiet)
    run('openssl', 'x509', '-req', '-in', str(p / 'edge.csr'), '-CA', str(c / 'ca.crt'), '-CAkey', str(p / 'ca.key'),
        '-CAserial', str(p / 'ca.srl'), '-CAcreateserial', '-days', '365', '-sha256', '-extfile', str(p / 'leaf.ext'),
        '-out', str(c / 'edge.crt'), **quiet)
    for f in (p / 'ca.key', c / 'edge.key'):
        os.chmod(f, 0o600)
    for f in (c / 'ca.crt', c / 'edge.crt'):
        os.chmod(f, 0o644)
    config = {k: secrets.token_hex(32) for k in ['DB_ADMIN_PASSWORD', 'DB_PASSWORD', 'BOOTSTRAP_PASSWORD',
               *[name.upper()+suffix for name in CLIENTS for suffix in ('_CLIENT_SECRET', '_COOKIE_SECRET')]]}
    config['STATE_DIR'] = str(root)
    write(p / 'compose.env', ''.join(f'{k}={v}\n' for k, v in config.items()))
    write(c / 'iwxa-test-realm.json', json.dumps(realm(), indent=2) + '\n', 0o644)
    for name in CLIENTS:
        directory(root / 'probes' / name, 0o750, gid)
        other = CLIENTS[1 - CLIENTS.index(name)]
        write(root / 'probes' / name / 'index.html', f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IWXA TEST | {name}</title><body><h1>IWXA TEST: {name}</h1><p>OIDC session confirmed for this diagnostic client. No Workspace, data, license or original Access grant is provided.</p><p><a href="https://{other}.iwxa.test/">Open {other} probe</a></p><p><a href="/oidc/callback?logout=https%3A%2F%2F{name}.iwxa.test%2F">Sign out of this session</a></p></body></html>\n', 0o644)
    write(c / 'p0.conf', apache_config(root, address, cidr, config, port=port))
    write(c / 'idp.conf', apache_config(root, address, cidr, config, identity=True, port=port))
    write(c / 'identity.conf', apache_config(root, address, cidr, config, identity=True, probes=True, port=port))
    write(c / 'active.conf', (c / 'p0.conf').read_text())
    return passwords


def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if line)


def replace_env(path, values):
    tmp = path.with_name(path.name + '.new')
    write(tmp, ''.join(f'{k}={v}\n' for k, v in values.items()))
    os.replace(tmp, path)


def lock_images(root):
    envpath = root / 'private/compose.env'
    values = read_env(envpath)
    if any(k in values for k in TAGS):
        raise ValueError('Image lock already exists; do not silently change versions')
    for key, tag in TAGS.items():
        run('docker', 'pull', '--platform', 'linux/amd64', tag)
        data = json.loads(run('docker', 'image', 'inspect', '--format', '{{json .RepoDigests}}', tag, capture_output=True, text=True).stdout)
        repo = tag.rsplit(':', 1)[0]
        allowed = (repo, 'docker.io/library/postgres', 'index.docker.io/library/postgres') if repo == 'postgres' else (repo,)
        candidates = [x for x in data if x.split('@')[0] in allowed and re.fullmatch(r'[^@]+@sha256:[0-9a-f]{64}', x)]
        if not candidates:
            raise ValueError('No verified repository digest for ' + tag)
        values[key] = candidates[0]
    replace_env(envpath, values)
    print('Image digests locked locally; no secrets printed')


def compose(root, *args, bootstrap=False):
    envpath = root / 'private/compose.env'
    values = read_env(envpath)
    if any(not re.fullmatch(r'[^@]+@sha256:[0-9a-f]{64}', values.get(k, '')) for k in TAGS):
        raise ValueError('Run lock-images before starting identity')
    base = ['docker', 'compose', '--project-name', 'iwxa-t4-test', '--env-file', str(envpath), '-f', str(HERE / 'compose.yaml')]
    if bootstrap:
        base += ['-f', str(HERE / 'compose.bootstrap.yaml')]
    # Docker Compose otherwise lets the caller's environment override the locked file.
    clean_env = {k: v for k, v in os.environ.items() if k not in values and k not in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES')}
    run(*base, *args, env=clean_env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='cmd', required=True)
    init = sub.add_parser('init'); init.add_argument('--address', required=True); init.add_argument('--cidr', required=True)
    sub.add_parser('lock-images')
    select = sub.add_parser('select'); select.add_argument('profile', choices=['p0', 'idp', 'identity'])
    start = sub.add_parser('identity-start'); start.add_argument('--bootstrap', action='store_true')
    sub.add_parser('identity-stop')
    finish = sub.add_parser('identity-finish'); finish.add_argument('--admin-removed', action='store_true', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo on the dedicated TEST host')
    os.umask(0o077)
    if args.cmd == 'init':
        address, cidr = private_network(args.address, args.cidr)
        interfaces = json.loads(run('ip', '-j', '-4', 'address', 'show', capture_output=True, text=True).stdout)
        if not any(a.get('local') == address for i in interfaces for a in i.get('addr_info', [])):
            parser.error('LAN address is not assigned to this host')
        prepare(ROOT, address, cidr)
        print('Prepared isolated TEST state. No service started. See README_RU.md.')
    elif args.cmd == 'lock-images':
        lock_images(ROOT)
    elif args.cmd == 'select':
        source = ROOT / 'config' / (args.profile + '.conf')
        run('apache2', '-t', '-f', str(source))
        tmp = ROOT / 'config/active.conf.new'
        write(tmp, source.read_text())
        os.replace(tmp, ROOT / 'config/active.conf')
        print('Profile selected; restart iwxa-t4-edge explicitly')
    elif args.cmd == 'identity-start':
        pending = 'BOOTSTRAP_PASSWORD' in read_env(ROOT / 'private/compose.env')
        if pending != args.bootstrap:
            parser.error('Use --bootstrap only until the temporary admin has been replaced and identity-finish executed')
        compose(ROOT, 'up', '-d', bootstrap=args.bootstrap)
    elif args.cmd == 'identity-stop':
        compose(ROOT, 'stop')
    elif args.cmd == 'identity-finish':
        path = ROOT / 'private/compose.env'
        values = read_env(path)
        if 'BOOTSTRAP_PASSWORD' not in values:
            parser.error('Bootstrap already finished')
        compose(ROOT, 'up', '-d', '--force-recreate', 'keycloak')
        values.pop('BOOTSTRAP_PASSWORD')
        replace_env(path, values)
        print('Temporary bootstrap environment removed. Confirm permanent admin login again.')


if __name__ == '__main__':
    main()
