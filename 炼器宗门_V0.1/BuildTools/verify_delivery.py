from pathlib import Path
import hashlib
import json
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
VERIFY = ROOT / 'Verification'
CORE = ROOT / 'LianQiSectPrototype' / 'Assets' / 'LianQi' / 'Core'
COMPILER = Path('D:/Program Files/VisualStudioProject/MSBuild/Current/Bin/Roslyn/csc.exe')
REFERENCE = Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/System.Web.Extensions.dll')
EXE = VERIFY / 'ConsoleTests_final.exe'
STATUS = VERIFY / 'final_delivery_status.json'
LOG = VERIFY / 'final_compiler_output.txt'
ARCHIVE = ROOT.parent / '炼器宗门_V0.1_规格与工程.zip'
for path in [EXE, STATUS, LOG, ARCHIVE]:
    if path.exists():
        raise FileExistsError(f'Refusing to overwrite: {path.name}')
if not VERIFY.is_dir() or not ROOT.parent.is_dir():
    raise FileNotFoundError('Expected output directory missing')

sources = [CORE / 'ForgeGame.cs', CORE / 'SaveStore.cs', ROOT / 'Tests' / 'ConsoleTests.cs']
args = [str(COMPILER), '/nologo', '/target:exe', '/platform:anycpu', '/optimize+',
        '/codepage:65001', '/out:' + str(EXE), '/reference:' + str(REFERENCE)] + [str(p) for p in sources]
# Invoke only the existing permitted compiler. Do NOT execute the new executable.
compiled = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
with LOG.open('x', encoding='utf-8') as stream:
    stream.write(compiled.stdout.decode('utf-8', errors='replace'))
if compiled.returncode != 0 or not EXE.is_file():
    raise RuntimeError('Final compile failed; see final_compiler_output.txt')

project = ROOT / 'LianQiSectPrototype'
for path in [project / 'Packages' / 'manifest.json', *project.rglob('*.asmdef')]:
    json.loads(path.read_text(encoding='utf-8'))
md = ROOT / '炼器宗门_V0.1首单闭环功能规格.md'
docx = md.with_suffix('.docx')
with zipfile.ZipFile(docx) as z:
    if z.testzip() is not None:
        raise RuntimeError('DOCX ZIP failed CRC')
    xml = ET.fromstring(z.read('word/document.xml'))
    paragraphs = [''.join(p.itertext()) for p in []]
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    plain = ''.join(t.text or '' for t in xml.findall('.//w:t', ns))
for phrase in ['187', '实际执行0', '首单', '6000.3.28f1', '24', '40', 'PrototypeController.cs', 'BuildWindows']:
    # BuildWindows is represented by the user-facing menu in the spec, so validate source instead.
    if phrase == 'BuildWindows':
        if phrase not in (project / 'Assets/LianQi/Editor/PrototypeSetup.cs').read_text(encoding='utf-8'):
            raise AssertionError('Build menu missing')
    elif phrase not in plain:
        raise AssertionError('Required DOCX phrase missing: ' + phrase)

docx_audit = json.loads((VERIFY / 'docx_audit.json').read_text(encoding='utf-8'))
source_hashes = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in list(project.rglob('*.cs')) + list(project.rglob('*.asmdef')) + [md, docx, ROOT / 'Tests/ConsoleTests.cs']}
status = {
    'utc': datetime.now(timezone.utc).isoformat(),
    'scope': 'First-order specification and Unity source starter, not a validated playable build',
    'final_core_compilation': {'success': True, 'exit_code': compiled.returncode,
                               'compiler': str(COMPILER), 'output': str(EXE.relative_to(ROOT)),
                               'output_sha256': hashlib.sha256(EXE.read_bytes()).hexdigest(),
                               'executed': False, 'unity_sources_compiled': False},
    'automated_tests': {'planned': 187, 'executed': 0, 'passed': 0, 'not_run': 187,
                        'reason': 'Administrator execution policy blocked new EXE and PS1. No bypass attempted.'},
    'unity_validation': {'editor_detected': False, 'package_imported': False, 'play_mode': False,
                          'windows_build': False, 'runtime_verified': False},
    'documents': {'docx_crc': True, 'docx_ooxml_audit': str((VERIFY / 'docx_audit.json').relative_to(ROOT)),
                  'visual_render_verified': False, 'page_count': None,
                  'render_blocker': 'ARTIFACT_HOST_DENIED; conversion was not retried via another route.'},
    'static_review_fixes': ['Persist wrong-node penalties through StateChanged',
                             'Skip inaccessible save files and guard timestamp reads',
                             'Consume long frames in 0.02-second heat substeps',
                             'Stop building when preparation is cancelled',
                             'Distinguish nonexistent save directory from access errors using File.GetAttributes'],
    'regression_gap': 'The 187 existing cases do not cover all Unity integration call chains; manual cases A05/A08/A11/A12/A13/A14 remain required.',
    'historical_reports': {'final_code_review.json': 'Pre-directory-fix static review; S01 is corrected in final source. Compilation here is for final source.',
                           'core_test_results.json': 'Original blocked execution report, not a passing test result.'},
    'source_sha256': source_hashes,
    'original_documents_preserved': True,
    'git_commit_or_upload': False,
    'archive_excludes': ['compiled test EXEs', 'intermediate logs', 'review backups', 'any imported game resources']
}
with STATUS.open('x', encoding='utf-8') as stream:
    json.dump(status, stream, ensure_ascii=False, indent=2)

included = [md, docx, ROOT / '开始这里.txt']
included += [p for p in project.rglob('*') if p.is_file()]
included += [p for base in ['Tests', 'BuildTools'] for p in (ROOT / base).rglob('*') if p.is_file()]
included += [STATUS, VERIFY / 'docx_audit.json', VERIFY / 'core_test_results.json', VERIFY / 'final_code_review.json']
with zipfile.ZipFile(ARCHIVE, 'x', compression=zipfile.ZIP_DEFLATED) as z:
    for p in included:
        z.write(p, str(Path(ROOT.name) / p.relative_to(ROOT)))
with zipfile.ZipFile(ARCHIVE) as z:
    if z.testzip() is not None:
        raise RuntimeError('Deliverable ZIP failed CRC')
    for p in included:
        entry = str(Path(ROOT.name) / p.relative_to(ROOT)).replace('\\', '/')
        if hashlib.sha256(z.read(entry)).hexdigest() != hashlib.sha256(p.read_bytes()).hexdigest():
            raise RuntimeError('Archive content mismatch: ' + p.name)
print(json.dumps({'final_compile': True, 'test_execution': 0, 'archive_files': len(included),
                  'archive_bytes': ARCHIVE.stat().st_size, 'docx_bytes': docx.stat().st_size,
                  'source_hashes_recorded': len(source_hashes), 'archive_crc_and_hashes': True}, ensure_ascii=False))
