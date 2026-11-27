"""Package only the verified Learn hosting tree and its retained build inputs."""
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import sys
import zipfile


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(ok, code):
    if not ok:
        raise ValueError(code)


def package_delivery(site, out, site_revision, core_revision, witness_run, witness_result):
    site, out = site.resolve(), out.resolve()
    require(not out.exists() and not out.is_relative_to(site), 'D01_DELIVERY_OUTPUT_SCOPE')
    require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=site, text=True).strip() == site_revision, 'D01_DELIVERY_SITE_REVISION')
    require(witness_result in ('success', 'failure'), 'D01_DELIVERY_WITNESS_UNFINISHED')
    active = json.loads((site / 'runtime/t3-platform/active.json').read_text(encoding='utf-8'))
    inputs = site / 'runtime/t3-platform' / active['version']
    pin = json.loads((inputs / 'release.json').read_text(encoding='utf-8'))
    manifest_path = site / 'dist/D01_SITE_BUILD_MANIFEST.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(pin['sourceCommit'] == core_revision and manifest['platform']['sourceCommit'] == core_revision, 'D01_DELIVERY_CORE_REVISION')
    require(manifest['platform']['version'] == active['version'] == pin['version'], 'D01_DELIVERY_PLATFORM_VERSION')
    require(manifest['platform']['archiveSha256'] == sha(inputs / 'platform-inputs.zip') == pin['archiveSha256'], 'D01_DELIVERY_PLATFORM_HASH')
    require(manifest['productionActivation'] is False, 'D01_DELIVERY_UNEXPECTED_ACTIVATION')
    subprocess.run(['node', 'scripts/verify-hosting-stage.mjs', '--dir', 'dist'], cwd=site, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['node', '--input-type=module', '-e', "import {verifyPreparedLearnHost} from './scripts/prepare-learn-t3-host.mjs'; import {retainedHost} from './scripts/retain-learn-t3-inputs.mjs'; import {verifyPlatformArchive,installedArchive} from './scripts/t3-platform-inputs.mjs'; verifyPlatformArchive(installedArchive); verifyPreparedLearnHost(retainedHost);"], cwd=site, check=True, stdout=subprocess.DEVNULL)
    require({p.name for p in inputs.iterdir()} == {'release.json','domain-assistant.json','platform-inputs.zip','learn-host'}, 'D01_DELIVERY_INPUT_SCOPE')
    package = runpy.run_path(str(site / 'scripts/package-learn-hosting.py'))['package_dist']
    out.mkdir(parents=True)
    hosting = package(site / 'dist', out / 'Learn-T3-hosting.zip')
    retained = package(inputs, out / 'Learn-T3-retained-inputs.zip')
    receipt = {'schema': 'IWXA_LEARN_D01_DELIVERY/1', 'status': 'PACKAGED_NOT_DEPLOYED',
               'siteRevision': site_revision, 'coreRevision': core_revision,
               'platformVersion': active['version'], 'platformArchiveSha256': pin['archiveSha256'],
               'siteManifestSha256': sha(manifest_path), 'pages': manifest['pages'],
               'modelWitnessRun': witness_run, 'modelWitnessConclusion': witness_result,
               'hosting': hosting, 'retainedInputs': retained}
    (out / 'delivery-receipt.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    archive = out.parent / (out.name + '.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED) as z:
        for name in ('Learn-T3-hosting.zip','Learn-T3-retained-inputs.zip','delivery-receipt.json'):
            z.write(out / name, name)
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None, 'D01_DELIVERY_ZIP_READBACK')
        require(z.namelist() == ['Learn-T3-hosting.zip','Learn-T3-retained-inputs.zip','delivery-receipt.json'], 'D01_DELIVERY_ZIP_SCOPE')
        for name in z.namelist():
            with z.open(name) as f:
                require(hashlib.file_digest(f,'sha256').hexdigest() == sha(out / name), 'D01_DELIVERY_ZIP_BYTES')
    print('D01_DELIVERY_PACKAGED=PASS')


if __name__ == '__main__':
    if len(sys.argv) != 7:
        raise SystemExit('D01_DELIVERY_USAGE')
    package_delivery(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5]), sys.argv[6])
