#!/usr/bin/env python3
"""Isolated actual Apache HTTPS/WebDAV test; not a production deployment."""
from __future__ import annotations
import base64, datetime, hashlib, json, os, pathlib, secrets, shutil, signal, socket, ssl, subprocess, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ.get('T4_TEST_OUTPUT_DIR') or pathlib.Path(tempfile.gettempdir())/('iwxa-t4-network-'+str(os.getpid()))); OUT.mkdir(parents=True,exist_ok=True)
for command in ('apache2','htpasswd','openssl','node'):
 if not shutil.which(command): raise SystemExit('Required program missing: '+command)
def run(args,**kwargs): return subprocess.run(args,check=True,capture_output=True,text=True,**kwargs)
with tempfile.TemporaryDirectory(prefix='iwxa-t4-dav-') as temp:
 d=pathlib.Path(temp);d.chmod(0o755)
 for folder in ['data','data/person-a','data/person-b','locks']:
  p=d/folder;p.mkdir();p.chmod(0o777) # Test-only temporary files; never deploy these permissions.
 with socket.socket() as s: s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 # Two independent pilot devices may share one explicitly admitted mailbox.
 # The unrelated operator retains its own isolated namespace.
 passwords=[secrets.token_urlsafe(24) for _ in range(3)]
 for i,person in enumerate(('person-a','person-b','person-a-peer')):
  run(['htpasswd','-i','-B']+(['-c'] if i==0 else [])+[str(d/'passwd'),person],input=passwords[i]+'\n')
 (d/'passwd').chmod(0o644)
 run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',str(d/'key.pem'),'-out',str(d/'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'])
 # Apache event MPM is not a distributed create-only CAS: the conditional
 # check and write may race. Qualify the limited single-worker pilot,
 # not a parallel server with unproven immutable-slot semantics.
 mods=['mpm_prefork','authn_core','authn_file','authz_core','authz_user','auth_basic','dav','dav_fs','ssl','socache_shmcb']
 config=[f'ServerRoot "{d}"',f'PidFile "{d}/httpd.pid"','ServerName localhost',f'Listen 127.0.0.1:{port}']
 config += [f'LoadModule {m}_module /usr/lib/apache2/modules/mod_{m}.so' for m in mods]
 config += ['ServerLimit 1','StartServers 1','MinSpareServers 1','MaxSpareServers 1',
  'MaxRequestWorkers 1','MaxConnectionsPerChild 0','KeepAlive Off','User www-data','Group www-data',f'ErrorLog "{d}/error.log"','LogLevel warn',f'DocumentRoot "{d}/data"',f'DavLockDB "{d}/locks/dav"','SSLEngine on',f'SSLCertificateFile "{d}/cert.pem"',f'SSLCertificateKeyFile "{d}/key.pem"','SSLSessionCache none','FileETag MTime Size','<Directory />','Require all denied','</Directory>']
 for person in ('person-a','person-b'):
  config += [f'<Directory "{d}/data/{person}">','Dav On','Options None','AllowOverride None','AuthType Basic','AuthName "IWXA T4 isolated test"',f'AuthUserFile "{d}/passwd"','Require user person-a person-a-peer' if person=='person-a' else f'Require user {person}','</Directory>']
 (d/'httpd.conf').write_text('\n'.join(config)+'\n');run(['apache2','-t','-f',str(d/'httpd.conf')])
 env=os.environ.copy();env.update(NODE_EXTRA_CA_CERTS=str(d/'cert.pem'),T4_TEST_URL=f'https://127.0.0.1:{port}/person-a/',T4_TEST_CHECKPOINT=str(d/'checkpoint.json'))
 env['T4_TEST_AUTH']='Basic '+base64.b64encode(('person-a:'+passwords[0]).encode()).decode()
 env['T4_TEST_OTHER_AUTH']='Basic '+base64.b64encode(('person-b:'+passwords[1]).encode()).decode()
 env['T4_TEST_PEER_AUTH']='Basic '+base64.b64encode(('person-a-peer:'+passwords[2]).encode()).decode()
 def stop(p):
  if p.poll() is not None:return
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:
   # The server has its OWN session/process group. Never signal the
   # qualification process group or the Actions runner.
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   p.wait()
 def start():
  # Apache prefork may send SIGTERM to its process group on shutdown.
  # Without this session boundary it also terminates Python/npm/CI.
  p=subprocess.Popen(['apache2','-f',str(d/'httpd.conf'),'-DFOREGROUND'],
    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  try:
   ctx=ssl.create_default_context(cafile=str(d/'cert.pem'))
   for _ in range(100):
    if p.poll() is not None: raise RuntimeError((d/'error.log').read_text())
    try:
     with socket.create_connection(('127.0.0.1',port),timeout=.2) as sock:
      with ctx.wrap_socket(sock,server_hostname='localhost'): return p
    except (OSError,ssl.SSLError): time.sleep(.05)
   raise RuntimeError('Server start timeout')
  except BaseException:
   stop(p);raise
 process=None
 try:
  process=start()
  suite_files=[str(p.relative_to(ROOT)) for p in sorted((ROOT/'tests/network').glob('*.test.mjs'))]
  # The real DAV suite shares one mailbox. Separate test files must not
  # change its listing while another file verifies an exact continuation.
  # Explicit concurrency within the actual CAS scenarios is unchanged.
  suite=subprocess.run(['node','--test','--test-concurrency=1']+suite_files,cwd=ROOT,env=env,capture_output=True,text=True)
  (OUT/'node-network-tests.log').write_text(suite.stdout+suite.stderr);print(suite.stdout,end='',flush=True)
  if suite.returncode:raise RuntimeError('Network test failure; see log')
  totals={}
  for line in suite.stdout.splitlines():
   parts=line.split()
   if len(parts)==3 and parts[0]=='#' and parts[1] in ('tests','pass','fail') and parts[2].isdigit():
    totals[parts[1]]=int(parts[2])
  if totals.get('tests') is None or totals.get('pass')!=totals['tests'] or totals.get('fail')!=0:
   raise RuntimeError('Network TAP summary missing or inconsistent')
  if 'T4_RC1_SERIAL_APACHE_INDEX_CONTENTION_PASS' not in suite.stdout:
   raise RuntimeError('Native immutable-index contention witness missing')
  original_run_passed=False
  if os.environ.get('IWXA_T2_QUALIFIED_KERNEL_DIST'):
   migration=subprocess.run(['node','--experimental-strip-types','--test',
     '../t4-network/tests/real-original-t3-graph-focus.browser.mjs'],cwd=ROOT.parent/'t3-core',env=env,
     capture_output=True,text=True,timeout=240)
   (OUT/'original-kernel-index-migration.log').write_text(migration.stdout+migration.stderr)
   print(migration.stdout,end='')
   if migration.returncode or 'T4_K32_REAL_ORIGINAL_PUBLICATION_PROFILE_MIGRATION_PASS' not in migration.stdout:
    raise RuntimeError('Original Kernel publication profile migration qualification failed')
   original=subprocess.run(['node','--experimental-strip-types','--test',
     '../t4-network/tests/real-original-t3-kernel-webdav.browser.mjs'],cwd=ROOT.parent/'t3-core',env=env,
     capture_output=True,text=True,timeout=1500)
   (OUT/'original-kernel-webdav.log').write_text(original.stdout+original.stderr)
   print(original.stdout,end='')
   if original.returncode:raise RuntimeError('Original T2/T3 kernel WebDAV E2E failed')
   original_run_passed=True
  reference_policy={'objectFamily':'owner-exported-package','workspaceId':'test-person-a','authorityRoot':'original-owner-a','writeOwnerRef':'original-exchange-a','primaryPlacement':'LOCAL_PRIMARY_HOSTED_REPLICA','allowedLocations':['test-webdav'],'retentionClass':'test','recoveryClass':'test','universalCloudMaster':False,'subjectActionAuthority':False}
  config={'baseUrl':env['T4_TEST_URL'],'locationRef':'test-webdav','placementPolicy':reference_policy,'networkConsent':True,'referenceOnlyAcknowledged':True,'allowedOperations':['t4.package.publish','t4.package.read']}
  (d/'cli.json').write_text(json.dumps(config));payload=b'opaque-cli-transport-fixture-not-original-iwxa';(d/'input.iwxa').write_bytes(payload)
  cli_env=env.copy();cli_env['T4_AUTHORIZATION']=env['T4_TEST_AUTH']
  published=run(['node','scripts/transfer_cli.mjs','put',str(d/'cli.json'),str(d/'input.iwxa')],cwd=ROOT,env=cli_env)
  digest=json.loads(published.stdout)['sha256']
  run(['node','scripts/transfer_cli.mjs','get',str(d/'cli.json'),str(d/'output.iwxa'),digest],cwd=ROOT,env=cli_env)
  assert (d/'output.iwxa').read_bytes()==payload
  duplicate=subprocess.run(['node','scripts/transfer_cli.mjs','get',str(d/'cli.json'),str(d/'output.iwxa'),digest],cwd=ROOT,env=cli_env,capture_output=True,text=True)
  assert duplicate.returncode!=0 and (d/'output.iwxa').read_bytes()==payload
  (OUT/'cli-tests.log').write_text('CLI_PUT_PASS\nCLI_GET_PASS\nCLI_NO_OVERWRITE_PASS\n')
  stop(process);process=None;process=start()
  cold="""
import {readFileSync} from 'node:fs';
import {createWebDavPackageTransport} from './src/network/webdav-package-transfer.mjs';
const c=JSON.parse(readFileSync(process.env.T4_TEST_CHECKPOINT,'utf8'));
const p={objectFamily:'owner-exported-package',workspaceId:'test-person-a',authorityRoot:'original-owner-a',writeOwnerRef:'original-exchange-a',primaryPlacement:'LOCAL_PRIMARY_HOSTED_REPLICA',allowedLocations:['test-webdav'],retentionClass:'test',recoveryClass:'test',universalCloudMaster:false,subjectActionAuthority:false};
const t=createWebDavPackageTransport({baseUrl:process.env.T4_TEST_URL,locationRef:'test-webdav',placementPolicy:p,getMode:()=> 'T4_NETWORK',authorize:async()=>true,getAuthorizationHeader:async()=>process.env.T4_TEST_AUTH});
const r=await t.getSnapshot({key:c.key,expectedSha256:c.sha256});
if(r.bytes.toString('base64')!==c.text)throw Error('cold mismatch');t.close();console.log('COLD_READBACK_PASS');
"""
  result=run(['node','--input-type=module','-e',cold],cwd=ROOT,env=env);(OUT/'cold-readback.log').write_text(result.stdout)
  untrusted=env.copy();untrusted.pop('NODE_EXTRA_CA_CERTS',None)
  negative=run(['node','--input-type=module','-e',"try { await fetch(process.env.T4_TEST_URL);process.exit(2); } catch(e) { if(!String(e.cause?.code).match(/CERT|SELF_SIGNED/)) throw e;console.log('UNTRUSTED_TLS_REJECTED'); }"],cwd=ROOT,env=untrusted)
  (OUT/'tls-negative.log').write_text(negative.stdout)
  paths=['src/network/webdav-package-transfer.mjs','src/contracts/hosted-context-boundary.mjs','tests/network/webdav-package-transfer.test.mjs','tests/network/standard-network-native-webdav.test.mjs','scripts/qualify_webdav.py','scripts/transfer_cli.mjs']
  summary={'schema':'IWXA_T4_NETWORK_QUALIFICATION/1.0','date':datetime.date.today().isoformat(),'environment':'Linux; isolated single-worker Apache prefork HTTPS/WebDAV; loopback','native_index_contention':'PASS','native_index_contention_scope':'single worker only; no distributed CAS claim','node':run(['node','--version']).stdout.strip(),'apache':run(['apache2','-v']).stdout.splitlines()[0],'tests_passed':totals['pass'],'tests_failed':totals['fail'],'cli_checks_passed':3,'cold_server_restart_and_fresh_node':'PASS','untrusted_tls':'REJECTED','payload':'OPAQUE_TRANSPORT_FIXTURES_NOT_ORIGINAL_IWXA','original_kernel_webdav_readback':'PASS' if original_run_passed else 'NOT_RUN','original_owner_binding':'PUBLIC_ORIGINAL_T2_KERNEL_NOT_PRIVATE_SIGNED_ISSUER' if original_run_passed else 'NOT_RUN','physical_remote_device':'NOT_RUN','nextcloud':'NOT_RUN','windows':'SEPARATE_WINDOWS_CONTRACT_JOB','full_existing_t4_suite':'NOT_RUN','T4_READY':False,'source_sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}}
  (OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(result.stdout.strip());print(negative.stdout.strip())
 finally:
  if process is not None:stop(process)
