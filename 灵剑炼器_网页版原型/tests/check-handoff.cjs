'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '交付文件清单.json');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function requireTrue(condition, message) { if (!condition) throw new Error(message); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
requireTrue(Array.isArray(manifest.files) && manifest.files.length > 0, 'Manifest is empty.');
const declared = new Set();
for (const entry of manifest.files) {
  requireTrue(typeof entry.path === 'string' && !path.isAbsolute(entry.path) && !entry.path.split(/[\\/]/).includes('..'), 'Unsafe manifest path.');
  requireTrue(!declared.has(entry.path), 'Duplicate manifest entry: ' + entry.path);
  declared.add(entry.path);
  const data = fs.readFileSync(path.join(root, entry.path));
  requireTrue(data.length === entry.bytes, 'Size mismatch: ' + entry.path);
  requireTrue(sha(data) === entry.sha256, 'SHA-256 mismatch: ' + entry.path);
}
function collect(dir, prefix = '') {
  let files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'test-results', '.git'].includes(item.name) || ['.DS_Store', 'Thumbs.db'].includes(item.name)) continue;
    const rel = (prefix ? prefix + '/' : '') + item.name;
    if (item.isDirectory()) files.push(...collect(path.join(dir, item.name), rel));
    else if (item.isFile() && rel !== '交付文件清单.json') files.push(rel);
    else if (item.isSymbolicLink()) throw new Error('Symbolic links are not expected in the handoff.');
  }
  return files;
}
const actual = collect(root);
requireTrue(actual.length === declared.size && actual.every(p => declared.has(p)), 'Unlisted or missing handoff files.');
const html = fs.readFileSync(path.join(root, 'index.html'));
requireTrue(html.equals(fs.readFileSync(path.join(root, '照夜炼器_可玩原型.html'))), 'Playable copy differs from canonical index.html.');
const report = JSON.parse(fs.readFileSync(path.join(root, 'Verification/final_browser_report.json'), 'utf8'));
requireTrue(report.status === 'passed' && report.counts.executed === 31 && report.counts.passed === 31 && report.counts.notRun === 0, 'Recorded browser regression is not fully passing.');
requireTrue(report.htmlSha256Before === sha(html) && report.htmlSha256After === sha(html), 'Recorded browser results are for another HTML version; rerun before handing off.');
requireTrue(report.screenshots.length === 10 && report.downloads.length >= 1, 'Final evidence is incomplete.');
for (const item of [...report.screenshots, ...report.downloads]) {
  requireTrue(typeof item.path === 'string' && !path.isAbsolute(item.path), 'Evidence path must be relative.');
  requireTrue(fs.statSync(path.join(root, item.path)).size > 0, 'Missing evidence: ' + item.path);
}
const p = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
requireTrue(p.devDependencies['playwright-core'] === '1.62.1' && lock.packages['node_modules/playwright-core'].version === '1.62.1', 'Pinned browser dependency differs.');
console.log(JSON.stringify({
  status: 'HANDOFF_CHECK_PASSED',
  files: manifest.files.length + 1,
  canonicalHtmlSha256: sha(html),
  recordedBrowserCases: report.counts.passed,
  recordedBrowserUiCases: report.counts.browserUiPassed,
  finalScreenshots: report.screenshots.length,
  checksOnly: true,
  note: 'This checks files and prior evidence, not a fresh browser run. Use npm test to rerun.'
}, null, 2));
