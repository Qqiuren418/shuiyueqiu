from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST_PARENT = ROOT.parent / 'RepositoryPayload'
DEST = DEST_PARENT / ROOT.name
ARCHIVE = ROOT.parent / '炼器宗门_V0.1_仓库更新_2026-11-18.zip'
if not DEST_PARENT.is_dir():
    raise FileNotFoundError('Payload parent must already exist')
if DEST.exists() or ARCHIVE.exists():
    raise FileExistsError('Payload or archive exists; preserve it and choose a new output name')

relative_files = [
    '炼器宗门_V0.1首单闭环功能规格.md',
    '炼器宗门_V0.1首单闭环功能规格.docx',
    '开始这里.txt',
    'Unity环境配置与实机验收状态_2026-11-18.txt',
    'Tests/ConsoleTests.cs',
    'BuildTools/build_spec.js',
    'BuildTools/run_core_tests.ps1',
    'BuildTools/verify_delivery.py',
    'BuildTools/prepare_repo_payload.py',
    'Verification/docx_audit.json',
    'Verification/core_test_results.json',
    'Verification/final_code_review.json',
    'Verification/final_delivery_status.json',
    'Verification/environment_setup_2026-11-18.json',
]
project = ROOT / 'LianQiSectPrototype'
allowed_extensions = {'.cs', '.asmdef', '.json', '.txt', '.meta', '.unity', '.asset', '.mat'}
for path in project.rglob('*'):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT).as_posix()
    if any(part.lower() in {'library', 'temp', 'logs', 'usersettings', 'builds', '.git'} for part in path.relative_to(project).parts):
        continue
    if path.name == '.gitignore' or path.suffix.lower() in allowed_extensions:
        relative_files.append(rel)
relative_files = sorted(set(relative_files))
for rel in relative_files:
    source = ROOT / rel
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError('Missing or empty deliverable: ' + rel)
    if source.stat().st_size > 95 * 1024 * 1024:
        raise ValueError('Deliverable exceeds GitHub safe-size budget: ' + rel)
    if source.suffix == '.json':
        json.loads(source.read_text(encoding='utf-8'))
    if source.suffix == '.docx':
        with zipfile.ZipFile(source) as z:
            if z.testzip() is not None:
                raise ValueError('DOCX CRC failure')

status = json.loads((ROOT / 'Verification/environment_setup_2026-11-18.json').read_text(encoding='utf-8'))
assert status['hub']['installed'] is True
assert status['editor']['installed'] is False
assert status['acceptance']['first_order_played'] is False
assert status['acceptance']['core_tests_executed'] == 0
assert status['safety']['hub_release_policy_bypassed'] is False

DEST.mkdir()
entries = []
for rel in relative_files:
    source = ROOT / rel
    target = DEST / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    with target.open('xb') as stream:
        stream.write(data)
    digest = hashlib.sha256(data).hexdigest()
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise ValueError('Copy hash mismatch: ' + rel)
    entries.append({'path': rel, 'bytes': len(data), 'sha256': digest})
manifest = {
    'schema_version': 1,
    'folder': ROOT.name,
    'date': '2026-11-18',
    'runtime_acceptance': 'blocked_not_passed',
    'file_count_excluding_manifest': len(entries),
    'files': entries,
    'excluded': ['installers', 'compiled executables', 'Unity caches', 'Hub account or license files', 'full logs', 'desktop screenshots', 'game saves', 'original game resources'],
    'note': 'Earlier verification JSON files are historical; current environment status is Verification/environment_setup_2026-11-18.json.'
}
manifest_path = DEST / '上传文件清单.json'
with manifest_path.open('x', encoding='utf-8') as stream:
    json.dump(manifest, stream, ensure_ascii=False, indent=2)

with zipfile.ZipFile(ARCHIVE, 'x', compression=zipfile.ZIP_DEFLATED) as z:
    for path in sorted(DEST.rglob('*')):
        if path.is_file():
            z.write(path, (Path(DEST.name) / path.relative_to(DEST)).as_posix())
with zipfile.ZipFile(ARCHIVE) as z:
    if z.testzip() is not None:
        raise ValueError('Archive CRC failure')
    for entry in entries:
        digest = hashlib.sha256(z.read(DEST.name + '/' + entry['path'])).hexdigest()
        if digest != entry['sha256']:
            raise ValueError('Archive hash mismatch: ' + entry['path'])
print(json.dumps({'payload_files': len(entries) + 1, 'archive_bytes': ARCHIVE.stat().st_size,
                  'copy_and_archive_hashes_match': True, 'runtime_accepted': False}, ensure_ascii=False))
