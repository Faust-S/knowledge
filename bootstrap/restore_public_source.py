"""Restore only the prepared public source files. No network or git push."""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import lzma
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile

ARCHIVE_SHA256 = '4af01d481d8d74b623e505d904e63a03b68a70558164b7ce71a9d07944ab4518'
CORE_SHA256 = '7661466fc3777c663b6f2c84afdfed30582a931d87c4dfecc0f3149833fe5c87'
FILES = {
    '.gitattributes', '.gitignore', '.github/workflows/check.yml',
    'README.md', 'AGENTS.md', 'docs/AI_REVIEW_INSTRUCTIONS.md',
    'docs/PUBLIC_PRIVATE_BOUNDARY.md', 'fixtures/modules.json',
    'fixtures/records.json', 'fixtures/snapshot.json', 'fixtures/sources.json',
    'review/completed.json', 'review/history.json', 'spec/data-model.json',
    'spec/record-schema.json', 'src/iwxa_knowledge.py',
    'tests/test_pipeline.py', 'tools/run_pilot.py',
}


def restore(target: Path) -> None:
    here = Path(__file__).resolve().parent
    encoded = ''.join((here / f'seed.part{i:02d}.b64').read_text('ascii').strip()
                      for i in range(1, 4))
    raw = base64.b64decode(encoded, validate=True)
    if hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Public source archive digest mismatch')
    decoder = lzma.LZMADecompressor()
    unpacked = decoder.decompress(raw, max_length=2_000_001)
    if len(unpacked) > 2_000_000 or not decoder.eof or decoder.unused_data:
        raise ValueError('Unexpected archive expansion or trailing data')
    target = Path(os.path.abspath(target))
    if target.exists() or target.is_symlink():
        raise FileExistsError('Target must not exist; nothing will be overwritten')
    if any(p.is_symlink() for p in target.parents):
        raise ValueError('Symlink target ancestor rejected')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.knowledge-source-', dir=target.parent))
    try:
        with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as archive:
            members = archive.getmembers()
            if len(members) != len(FILES) or {m.name for m in members} != FILES:
                raise ValueError('Unexpected source file inventory')
            for member in members:
                path = PurePosixPath(member.name)
                if (not member.isfile() or member.size > 200_000
                        or path.is_absolute() or '..' in path.parts
                        or '\\' in member.name or ':' in member.name):
                    raise ValueError('Unsafe source archive entry')
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError('Missing source bytes')
                data = stream.read()
                if len(data) != member.size:
                    raise ValueError('Truncated source file')
                destination = staging.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
        core = (staging / 'src/iwxa_knowledge.py').read_bytes()
        if hashlib.sha256(core).hexdigest() != CORE_SHA256:
            raise ValueError('Toolchain does not match the tested source')
        if target.exists() or target.is_symlink():
            raise FileExistsError('Target appeared during restoration')
        staging.rename(target)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(f'Restored {len(FILES)} public source files to {target}')
    print('No model, network request, git push or Personal Agent change was performed.')
    print('Test command: python tools/run_pilot.py --out build')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, default=Path('knowledge-public-source'))
    restore(parser.parse_args().target)
