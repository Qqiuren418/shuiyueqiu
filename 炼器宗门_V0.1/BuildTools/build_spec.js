'use strict';
// New-file-only Markdown -> DOCX, followed by an independent stdlib ZIP/XML audit.
// No game code, Markdown, previous documents, or test executables are modified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, ShadingType, BorderStyle, LevelFormat,
  AlignmentType, Header, Footer, PageNumber, TableLayoutType,
} = require('D:/Program Files/工作内容/node_modules/docx');

const ROOT = 'D:/Program Files/新游戏锻造/炼器宗门_V0.1';
const SOURCE = path.join(ROOT, '炼器宗门_V0.1首单闭环功能规格.md');
const TARGET = path.join(ROOT, '炼器宗门_V0.1首单闭环功能规格.docx');
const AUDIT = path.join(ROOT, 'Verification/docx_audit.json');
const TITLE = '炼器宗门 V0.1 首单闭环功能规格';
const FONT = { ascii: 'Microsoft YaHei', hAnsi: 'Microsoft YaHei', eastAsia: 'Microsoft YaHei', cs: 'Microsoft YaHei' };
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN = 1134;
const WIDTH = PAGE_WIDTH - 2 * MARGIN;
const INK = '263238';
const ACCENT = '234A59';

function requireAbsent(filename) {
  if (fs.existsSync(filename)) throw new Error('Refusing to overwrite existing artifact: ' + filename);
  if (!fs.statSync(path.dirname(filename)).isDirectory()) throw new Error('Missing output parent: ' + filename);
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function run(text, options = {}) {
  return new TextRun({ text, font: FONT, size: 22, color: INK, ...options });
}
function parseRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}
function separator(line) { return parseRow(line).every(cell => /^:?-{3,}:?$/.test(cell)); }
function columnWidths(header) {
  if (header[0] === '编号') return [700, 5250, WIDTH - 5950];
  if (header[0] === '相对路径') return [6100, WIDTH - 6100];
  if (header.length === 5) return [1500, 1200, 1200, 1200, WIDTH - 5100];
  if (header[1] === '省料直路') return [1800, 3919, WIDTH - 5719];
  if (header[0] === '模块') return [2350, 3350, WIDTH - 5700];
  if (header[0] === '状态') return [2650, 3300, WIDTH - 5950];
  if (header[0] === '输入') return [2400, 3550, WIDTH - 5950];
  if (header.length === 2) return [3300, WIDTH - 3300];
  return [2300, 2300, WIDTH - 4600];
}
function makeTable(block) {
  const rows = block.filter(line => !separator(line)).map(parseRow);
  if (!rows.length || rows.some(row => row.length !== rows[0].length)) throw new Error('Malformed source table');
  const widths = columnWidths(rows[0]);
  if (widths.length !== rows[0].length || widths.reduce((a, b) => a + b, 0) !== WIDTH) throw new Error('Invalid table widths');
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CDD7DB' };
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((row, ri) => new TableRow({
      tableHeader: ri === 0,
      cantSplit: true,
      children: row.map((text, ci) => new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'E9EFF2' } : undefined,
        margins: { top: 90, bottom: 90, left: 100, right: 100 },
        children: [new Paragraph({
          spacing: { before: 0, after: 20, line: 290 },
          widowControl: true,
          // A row may move as a unit; body rows are not chained together.
          keepNext: ri === 0,
          children: [run(text, { bold: ri === 0, color: ri === 0 ? ACCENT : INK })],
        })],
      })),
    })),
  });
}

// This parser is deliberately independent of the JavaScript generator. All
// extracted body/cell text comes ONLY from w:t, not XML itertext or metadata.
const XML_AUDIT = String.raw`
import collections, difflib, hashlib, json, pathlib, re, sys, zipfile
import xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')
source, target, audit = map(pathlib.Path, sys.argv[1:4])
source_hash_before = sys.argv[4]
if audit.exists():
    raise FileExistsError('Refusing to overwrite existing artifact: ' + str(audit))
raw = source.read_bytes()
md = raw.decode('utf-8-sig')
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + ns['w'] + '}'
def txt(node):
    return ''.join(t.text or '' for t in node.findall('.//w:t', ns))
def attr(node, name, default=None):
    return node.get(W + name, default) if node is not None else default

def row(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]
def is_separator(line):
    return all(re.fullmatch(r':?-{3,}:?', c) for c in row(line))
lines = md.splitlines()
expected = []
i = 0
while i < len(lines):
    s = lines[i].strip()
    line_number = i + 1
    i += 1
    if not s:
        continue
    if s.startswith('|'):
        block = [s]
        while i < len(lines) and lines[i].strip().startswith('|'):
            block.append(lines[i].strip())
            i += 1
        expected.append({'kind': 'table', 'line': line_number, 'rows': [row(b) for b in block if not is_separator(b)]})
        continue
    h = re.match(r'^(#{1,4})\s+(.+)$', s)
    bullet = re.match(r'^-\s+(.+)$', s)
    ordered = re.match(r'^(\d+)\.\s+(.+)$', s)
    if h:
        expected.append({'kind': 'heading', 'line': line_number, 'level': len(h[1]), 'text': h[2]})
    elif bullet:
        expected.append({'kind': 'bullet', 'line': line_number, 'text': bullet[1]})
    elif ordered:
        expected.append({'kind': 'ordered', 'line': line_number, 'text': ordered[2], 'number': int(ordered[1])})
    else:
        expected.append({'kind': 'paragraph', 'line': line_number, 'text': s})

with zipfile.ZipFile(target) as z:
    bad_member = z.testzip()
    document = ET.fromstring(z.read('word/document.xml'))
    styles = ET.fromstring(z.read('word/styles.xml'))
    numbering = ET.fromstring(z.read('word/numbering.xml'))
    core = ET.fromstring(z.read('docProps/core.xml'))
body = document.find('w:body', ns)
actual = [n for n in body if n.tag in (W + 'p', W + 'tbl') and (n.tag == W + 'tbl' or txt(n))]
checks = []
failures = []
def check(name, passed, detail=None):
    item = {'check': name, 'passed': bool(passed)}
    if detail is not None:
        item['detail'] = detail
    checks.append(item)
    if not passed:
        failures.append(item)
check('ZIP CRC and XML parsing', bad_member is None)
check('source SHA-256 unchanged since before generation', hashlib.sha256(raw).hexdigest() == source_hash_before)
check('top-level source/body block count', len(expected) == len(actual), {'source': len(expected), 'docx': len(actual)})

num_to_abstract = {attr(n, 'numId'): attr(n.find('w:abstractNumId', ns), 'val') for n in numbering.findall('w:num', ns)}
abstract_formats = {attr(n, 'abstractNumId'): attr(n.find('w:lvl/w:numFmt', ns), 'val') for n in numbering.findall('w:abstractNum', ns)}
num_starts = {attr(n, 'numId'): int(attr(n.find('w:lvlOverride/w:startOverride', ns), 'val', '1')) for n in numbering.findall('w:num', ns)}
ordered_seen = collections.Counter()
paragraph_results = []
table_results = []
source_tokens, docx_tokens = [], []
for index, e in enumerate(expected):
    if index >= len(actual):
        check('source block ' + str(index + 1), False, e)
        continue
    node = actual[index]
    if e['kind'] == 'table':
        rows_xml = node.findall('w:tr', ns)
        actual_rows = [[txt(cell) for cell in tr.findall('w:tc', ns)] for tr in rows_xml]
        matches = node.tag == W + 'tbl' and e['rows'] == actual_rows
        check('table body aligned at source line ' + str(e['line']), matches)
        widths = [int(attr(col, 'w')) for col in node.findall('w:tblGrid/w:gridCol', ns)]
        table_width = node.find('w:tblPr/w:tblW', ns)
        layout = node.find('w:tblPr/w:tblLayout', ns)
        cells_width_ok = all(
            len(tr.findall('w:tc', ns)) == len(widths) and all(
                attr(cell.find('w:tcPr/w:tcW', ns), 'type') == 'dxa' and int(attr(cell.find('w:tcPr/w:tcW', ns), 'w', '0')) == widths[ci]
                for ci, cell in enumerate(tr.findall('w:tc', ns)))
            for tr in rows_xml)
        width_ok = attr(table_width, 'type') == 'dxa' and int(attr(table_width, 'w', '0')) == sum(widths) and sum(widths) <= 9638 and cells_width_ok
        cant_split = all(tr.find('w:trPr/w:cantSplit', ns) is not None and attr(tr.find('w:trPr/w:cantSplit', ns), 'val', 'true') not in ('0', 'false') for tr in rows_xml)
        repeat = bool(rows_xml) and rows_xml[0].find('w:trPr/w:tblHeader', ns) is not None
        check('table dual DXA widths / no page overflow at line ' + str(e['line']), width_ok, widths)
        check('table fixed layout / unsplit rows / repeated header at line ' + str(e['line']), attr(layout, 'type') == 'fixed' and cant_split and repeat)
        cell_results = [{'row': ri + 1, 'column': ci + 1, 'source': cell, 'docx': actual_rows[ri][ci] if ri < len(actual_rows) and ci < len(actual_rows[ri]) else None, 'matched': ri < len(actual_rows) and ci < len(actual_rows[ri]) and cell == actual_rows[ri][ci]} for ri, r in enumerate(e['rows']) for ci, cell in enumerate(r)]
        table_results.append({'source_line': e['line'], 'matched': matches, 'rows': len(e['rows']), 'cells': cell_results, 'column_widths_dxa': widths})
        source_tokens.extend(c for r in e['rows'] for c in r)
        docx_tokens.extend(c for r in actual_rows for c in r)
        continue
    actual_text = txt(node)
    source_tokens.append(e['text'])
    docx_tokens.append(actual_text)
    matches = node.tag == W + 'p' and actual_text == e['text']
    check('paragraph text at source line ' + str(e['line']), matches)
    style = attr(node.find('w:pPr/w:pStyle', ns), 'val')
    num_id = attr(node.find('w:pPr/w:numPr/w:numId', ns), 'val')
    if e['kind'] == 'heading':
        wanted = 'Title' if e['level'] == 1 else 'Heading' + str(e['level'] - 1)
        heading_ok = style == wanted and node.find('w:pPr/w:keepNext', ns) is not None
        if e['level'] > 1:
            style_node = styles.find("w:style[@w:styleId='" + wanted + "']", ns)
            heading_ok = heading_ok and attr(style_node.find('w:pPr/w:outlineLvl', ns), 'val') == str(e['level'] - 2)
        check('real built-in heading at source line ' + str(e['line']), heading_ok, {'expected': wanted, 'actual': style})
    elif e['kind'] in ('bullet', 'ordered'):
        fmt = abstract_formats.get(num_to_abstract.get(num_id))
        number_ok = fmt == ('bullet' if e['kind'] == 'bullet' else 'decimal')
        if e['kind'] == 'ordered':
            displayed_number = num_starts.get(num_id, 1) + ordered_seen[num_id]
            ordered_seen[num_id] += 1
            number_ok = number_ok and displayed_number == e['number']
        check('real list numbering at source line ' + str(e['line']), number_ok, {'numId': num_id, 'format': fmt})
    if e['kind'] not in ('heading',):
        body_runs_ok = all(attr(r.find('w:rPr/w:sz', ns), 'val') == '22' for r in node.findall('w:r', ns) if txt(r))
        check('11pt body at source line ' + str(e['line']), body_runs_ok)
    paragraph_results.append({'source_line': e['line'], 'kind': e['kind'], 'source': e['text'], 'docx': actual_text, 'matched': matches, 'style': style, 'numId': num_id})

source_all = '\n'.join(source_tokens)
docx_all = '\n'.join(docx_tokens)
check('all paragraph/cell text aligned, same order', source_tokens == docx_tokens)
numeric = r'\d+(?:[.,]\d+)*'
check('all numeric tokens identical, same order', re.findall(numeric, source_all) == re.findall(numeric, docx_all), {'token_count': len(re.findall(numeric, source_all))})
formula_results = [{'source': t, 'matched': t in docx_tokens} for t in source_tokens if '＝' in t or '≥' in t or '≤' in t or '理论风门为' in t]
check('all formulas and inequalities retained', all(f['matched'] for f in formula_results), formula_results)
entry_results = [{'source': t, 'matched': t in docx_tokens} for t in source_tokens if re.search(r'Assets/|Packages/|ProjectSettings/|BuildTools/|Unity Hub|LianQi/|Generated/Workshop|187项|实际执行0|当前执行策略', t)]
check('engineering entry points and unrun test statements retained', all(v['matched'] for v in entry_results), entry_results)
for fact in ['实际执行0，实际通过0，187项未运行', '核心及测试代码的编译不等于测试执行', '尚未完成Unity导入、Play Mode或Windows构建', '6000.3.28f1', '17.3.0', '8f082d2fe476']:
    check('critical source fact: ' + fact, fact in source_all and fact in docx_all)
section = body.find('w:sectPr', ns)
size, margin = section.find('w:pgSz', ns), section.find('w:pgMar', ns)
check('A4 page size and symmetric safe text width', attr(size, 'w') == '11906' and attr(size, 'h') == '16838' and attr(margin, 'left') == '1134' and attr(margin, 'right') == '1134')
font_nodes = document.findall('.//w:rFonts', ns)
check('all explicit body fonts are Microsoft YaHei including eastAsia', bool(font_nodes) and all(all(attr(n, k) == 'Microsoft YaHei' for k in ('ascii', 'hAnsi', 'eastAsia', 'cs')) for n in font_nodes))
check('table cell text is 11pt', all(attr(r.find('w:rPr/w:sz', ns), 'val') == '22' for table in body.findall('w:tbl', ns) for r in table.findall('.//w:r', ns) if txt(r)))
check('metadata title matches source', core.find('{http://purl.org/dc/elements/1.1/}title').text == expected[0]['text'])
report = {
    'status': 'PASS' if not failures else 'FAIL',
    'source': str(source), 'docx': str(target), 'audit': str(audit),
    'source_sha256_before': source_hash_before,
    'source_sha256_after': hashlib.sha256(source.read_bytes()).hexdigest(),
    'docx_sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'docx_bytes': target.stat().st_size,
    'method': 'Independent Python stdlib ZIP CRC + XML; text from pure w:t only; top-level paragraphs, table rows/cells and numeric tokens aligned against unchanged Markdown.',
    'counts': {'source_blocks': len(expected), 'docx_blocks': len(actual), 'headings_including_title': sum(e['kind'] == 'heading' for e in expected), 'tables': len(table_results), 'table_cells': sum(len(t['cells']) for t in table_results), 'bullets': sum(e['kind'] == 'bullet' for e in expected), 'numbered_items': sum(e['kind'] == 'ordered' for e in expected), 'aligned_text_items': len(source_tokens), 'checks': len(checks), 'failed_checks': len(failures)},
    'checks': checks, 'paragraph_alignment': paragraph_results, 'table_alignment': table_results,
    'test_execution': {'planned': 187, 'executed': 0, 'passed': 0, 'unity_installed': False, 'basis': 'Task-provided environment and source document. This generation/audit script does not launch C# tests or Unity.'},
    'layout': {'xml_structure_checked': True, 'pdf_export_or_visual_review_in_this_audit': False, 'note': 'Actual PDF export and selected-page visual review are performed separately after this immutable audit is written.'},
    'diff_if_any': list(difflib.unified_diff(source_tokens, docx_tokens, fromfile='Markdown', tofile='DOCX w:t')) if source_tokens != docx_tokens else [],
}
check_hash = report['source_sha256_before'] == report['source_sha256_after']
if not check_hash:
    report['status'] = 'FAIL'
    report['source_changed_during_audit'] = True
with audit.open('x', encoding='utf-8') as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
print(json.dumps({'status': report['status'], 'counts': report['counts'], 'audit': str(audit), 'failures': failures}, ensure_ascii=False, indent=2))
sys.exit(0 if report['status'] == 'PASS' else 1)
`;

async function main() {
  requireAbsent(TARGET);
  requireAbsent(AUDIT);
  const original = fs.readFileSync(SOURCE);
  const sourceHash = sha256(original);
  const lines = original.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const children = [];
  const stats = { headings: 0, tables: 0, bullets: 0, numbered: 0 };
  let orderedInstance = 0;
  let previousOrdered = false;
  let seenTitle = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) { previousOrdered = false; continue; }
    if (text.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
      i--;
      children.push(makeTable(block));
      stats.tables++;
      previousOrdered = false;
      continue;
    }
    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1 && (seenTitle || heading[2] !== TITLE)) throw new Error('Unexpected source title');
      if (level === 1) seenTitle = true;
      // Every ## is a true Heading1; no isSubtitle heuristic consumes chapter one.
      const headingStyle = level === 1 ? HeadingLevel.TITLE : level === 2 ? HeadingLevel.HEADING_1 : level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      const size = level === 1 ? 42 : level === 2 ? 32 : level === 3 ? 26 : 23;
      children.push(new Paragraph({
        heading: headingStyle, keepNext: true, keepLines: true, widowControl: true,
        spacing: { before: level === 1 ? 160 : level === 2 ? 240 : 170, after: level === 1 ? 180 : 110 },
        children: [run(heading[2], { size, bold: true, color: ACCENT })],
      }));
      stats.headings++;
      previousOrdered = false;
      continue;
    }
    const ordered = text.match(/^\d+\.\s+(.+)$/);
    const bullet = text.match(/^-\s+(.+)$/);
    let content = text;
    let numbering;
    if (ordered) {
      if (!previousOrdered) orderedInstance++;
      content = ordered[1];
      numbering = { reference: 'ordered', level: 0, instance: orderedInstance };
      previousOrdered = true;
      stats.numbered++;
    } else {
      previousOrdered = false;
      if (bullet) {
        content = bullet[1];
        numbering = { reference: 'bullet', level: 0 };
        stats.bullets++;
      }
    }
    children.push(new Paragraph({
      numbering, spacing: { before: 0, after: 100, line: 320 },
      widowControl: true, children: [run(content)],
    }));
  }
  if (!seenTitle) throw new Error('Source title not found');
  const doc = new Document({
    creator: '千问办公', title: TITLE,
    description: 'V0.1-M0-A首单闭环功能规格；原始Markdown正文忠实排版，不代表187项测试已执行或Unity运行验收。',
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { after: 100, line: 320 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 42, bold: true, color: ACCENT }, paragraph: { keepNext: true, keepLines: true } },
        { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: ACCENT }, paragraph: { outlineLevel: 0, keepNext: true, keepLines: true } },
        { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: ACCENT }, paragraph: { outlineLevel: 1, keepNext: true, keepLines: true } },
        { id: 'Heading3', name: 'heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 23, bold: true, color: ACCENT }, paragraph: { outlineLevel: 2, keepNext: true, keepLines: true } },
      ],
    },
    numbering: { config: [
      { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { run: { font: FONT, size: 22 }, paragraph: { indent: { left: 400, hanging: 240 } } } }] },
      { reference: 'ordered', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', start: 1, alignment: AlignmentType.LEFT, style: { run: { font: FONT, size: 22 }, paragraph: { indent: { left: 430, hanging: 290 } } } }] },
    ] },
    sections: [{
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: 1100, bottom: 1100, left: MARGIN, right: MARGIN, header: 480, footer: 480 } } },
      headers: { default: new Header({ children: [new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, color: 'CDD7DB', size: 4 } },
        children: [run(TITLE, { size: 17, color: '647A83' })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run('V0.1-M0-A  |  ', { size: 17, color: '647A83' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 17, color: '647A83' })],
      })] }) },
      children,
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  if (sha256(fs.readFileSync(SOURCE)) !== sourceHash) throw new Error('Source changed during generation');
  // Exclusive creation, including race protection: never truncate an existing file.
  fs.writeFileSync(TARGET, buffer, { flag: 'wx' });
  console.log(JSON.stringify({ status: 'DOCX_GENERATED', target: TARGET, bytes: buffer.length, stats, source_sha256: sourceHash }, null, 2));
  const result = spawnSync('python', ['-c', XML_AUDIT, SOURCE, TARGET, AUDIT, sourceHash], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Independent DOCX audit failed; generated file preserved, not overwritten.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
