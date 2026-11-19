'use strict';
// Portable real-browser regression suite; no writes to the playable HTML.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const PW_PATH = process.env.PLAYWRIGHT_MODULE_PATH || 'playwright-core';
const { chromium } = require(PW_PATH);
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(process.env.FORGE_HTML_PATH || path.join(ROOT, 'index.html'));
const OUT = path.resolve(process.env.FORGE_TEST_OUTPUT || path.join(ROOT, 'test-results'));
function browserPath() {
  if (process.env.FORGE_BROWSER_PATH) {
    if (!fs.existsSync(process.env.FORGE_BROWSER_PATH)) throw new Error('FORGE_BROWSER_PATH does not exist.');
    return process.env.FORGE_BROWSER_PATH;
  }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
  ] : process.platform === 'darwin' ? [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ] : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(p => fs.existsSync(p)) || null;
}
const EDGE = browserPath();
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '_' + crypto.randomUUID().slice(0, 8);
const reportPath = path.join(OUT, `browser_report_${stamp}.json`);
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(HTML)).digest('hex');
const report = {
  status: 'running', startedAt: new Date().toISOString(), html: path.resolve(HTML),
  script: __filename, report: reportPath, htmlSha256Before: hash(),
  node: process.version, playwright: require(PW_PATH + '/package.json').version,
  executable: EDGE, headless: true, url: pathToFileURL(HTML).href,
  method: 'Actual browser DOM keyboard, mouse and touch input; Playwright clock.runFor only advances time; read-only forgeView.snapshot; independent core runs only for supplementary checks. No live-state, DOM-value or stage assignment.',
  harnessNotes: [
    'Ready SVG nodes inherit aria-disabled; force omits stability waits but still sends real browser pointer input and checks that inactive product input is ignored.',
    'Keyboard defaultPrevented is recorded on window after the product document listener.',
    'Pause keyboard probes focus non-control overlay text; pressing Space on the focused resume tool would legitimately resume.'
  ],
  cases: [], screenshots: [], downloads: [], uiEvents: [], diagnostics: {
    pageerrors: [], consoleErrors: [], failedRequests: [], httpErrors: [], requests: []
  }, limitations: []
};
class ProductBug extends Error {
  constructor(message, actual) { super(message); this.name = 'ProductBug'; this.actual = actual; }
}
function check(condition, message, actual) { if (!condition) throw new ProductBug(message, actual); }
function same(actual, expected, message) {
  try { assert.deepStrictEqual(actual, expected); }
  catch { throw new ProductBug(message, { actual, expected }); }
}
const cases = [];
const add = (name, body, options = {}) => cases.push({ name, body, kind: 'browser_ui', ...options });
let browser, desktop, mobile, p, m, lastPage, optimalResult;
const snaps = page => page.evaluate(() => window.forgeView.snapshot());
const runFor = (page, ms) => page.clock.runFor(Math.max(1, Math.round(ms)));
async function click(page, selector) {
  const l = page.locator(selector);
  check(await l.isVisible(), `Required control not visible: ${selector}`);
  check(await l.isEnabled(), `Required control not enabled: ${selector}`);
  // force only omits animation-stability waits with a frozen RAF clock; it still uses real browser input.
  if (page === m) await l.tap({ force: true }); else await l.click({ force: true });
}
async function canvasEvidence(page) {
  // Inspect the pixels already drawn by actual refresh/ResizeObserver/RAF; never invoke private drawing code.
  const v = await page.evaluate(() => {
    const c = document.getElementById('scene'), ctx = c.getContext('2d'), rect = c.getBoundingClientRect();
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set(); let opaque = 0, subjectPixels = 0;
    for (let y = 0; y < c.height; y += 3) for (let x = 0; x < c.width; x += 3) {
      const i = 4 * (y * c.width + x), [r,g,b,a] = pixels.slice(i, i + 4);
      if (a) opaque++;
      colors.add(`${r},${g},${b},${a}`);
      if (x > c.width * .2 && x < c.width * .8 && y > c.height * .2 && y < c.height * .85 && r + g + b > 240) subjectPixels++;
    }
    const t = ctx.getTransform(), scale = Math.min(c.width / 780, c.height / 450);
    return { width: c.width, height: c.height, rect: rect.toJSON(), opaque, distinctColors: colors.size, subjectPixels,
      transform: { a: t.a, d: t.d, e: t.e, f: t.f }, expected: { scale, x: (c.width - 780 * scale) / 2, y: (c.height - 450 * scale) / 2 } };
  });
  check(v.width > 0 && v.height > 0 && v.opaque > 100 && v.distinctColors > 30 && v.subjectPixels > 100,
    'Canvas must contain a drawn forge subject, not a blank/background-only frame', v);
  check(Math.abs(v.transform.a - v.expected.scale) < 1e-6 && Math.abs(v.transform.d - v.expected.scale) < 1e-6 &&
    Math.abs(v.transform.e - v.expected.x) < 1e-6 && Math.abs(v.transform.f - v.expected.y) < 1e-6,
    'Canvas must draw with equal scale and centered letterboxing', v);
  return v;
}
async function shot(page, label, fullPage = false) {
  const file = path.join(OUT, `${stamp}_${label}.png`);
  const before = await snaps(page);
  const canvas = await canvasEvidence(page); // Current refresh/RAF pixels, before screenshot.
  await page.screenshot({ path: file, fullPage, animations: 'allow' });
  report.screenshots.push({ label, path: file, viewport: page.viewportSize(), fullPage, stage: before.stage, canvas });
  return file;
}
async function overflow(page, label) {
  const v = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
    offenders: [...document.querySelectorAll('.shell button,.rune-node .node-ring')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1);
    }).map(e => ({ id: e.id, text: e.textContent.trim(), rect: e.getBoundingClientRect().toJSON() }))
  }));
  check(v.document <= v.viewport && v.body <= v.viewport && v.offenders.length === 0,
    `Horizontal overflow at ${label}`, v);
  return v;
}
async function newGame(context, label) {
  const page = await context.newPage(); lastPage = page;
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.diagnostics.pageerrors.push({ page: label, text: e.message }));
  page.on('console', e => { if (e.type() === 'error') report.diagnostics.consoleErrors.push({ page: label, text: e.text() }); });
  page.on('request', r => report.diagnostics.requests.push({ page: label, url: r.url(), method: r.method() }));
  page.on('requestfailed', r => report.diagnostics.failedRequests.push({ page: label, url: r.url(), error: r.failure() }));
  page.on('response', r => { if (r.status() >= 400) report.diagnostics.httpErrors.push({ page: label, url: r.url(), status: r.status() }); });
  await page.exposeFunction('__browserTestRecord', event => report.uiEvents.push({ page: label, ...event }));
  await page.addInitScript(() => {
    const record = e => window.__browserTestRecord({
      type: e.type, trusted: e.isTrusted, target: e.target && (e.target.id || e.target.getAttribute?.('data-node') || e.target.tagName),
      pointerType: e.pointerType, code: e.code, repeat: e.repeat, defaultPrevented: e.defaultPrevented,
      value: e.type === 'input' ? e.target.value : undefined,
      visibility: document.visibilityState, focus: document.hasFocus(), time: performance.now()
    });
    for (const type of ['click', 'input', 'pointerdown', 'pointermove', 'pointerup', 'visibilitychange']) document.addEventListener(type, record, true);
    window.addEventListener('keydown', record); // After document listeners, including the product handler installed after this init script.
    for (const type of ['blur', 'focus']) window.addEventListener(type, record);
  });
  await page.clock.install({ time: new Date('2025-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2025-01-01T00:00:01Z'));
  await page.goto(report.url, { waitUntil: 'load' });
  await runFor(page, 64);
  check(await page.evaluate(() => typeof window.forgeView?.snapshot === 'function'), 'Read-only diagnostics absent');
  return page;
}
async function ready(page, stage) {
  await click(page, '#main-action');
  const before = await snaps(page);
  same({ stage: before.stage, active: before.active, done: before.done, elapsed: before.elapsed },
    { stage, active: false, done: false, elapsed: 0 }, `Primary must enter stage ${stage} in ready mode`);
  await runFor(page, 1600);
  same(await snaps(page), before, `Ready stage ${stage} must not consume time or progress`);
  return before;
}
async function fuel(page, value) {
  // Native range-key events, not evaluate/value assignment or dispatchEvent.
  await page.locator('#fuel').press('Home');
  if (value === 100) await page.locator('#fuel').press('End');
  else for (let i = 0; i < value; i++) await page.locator('#fuel').press('ArrowRight');
  same(await page.locator('#fuel').inputValue(), String(value), 'Wind-gate slider value');
  same(await page.locator('#fuel-output').textContent(), `${value}%`, 'Wind-gate input handler output');
}
async function heat(page, good = true) {
  await fuel(page, good ? 100 : 0);
  await click(page, '#main-action');
  check((await snaps(page)).active, 'Igniting furnace must start heat');
  if (good) {
    const [low, high] = (await page.locator('#note-heat').textContent()).split('–').map(Number);
    const center = (low + high) / 2;
    for (let i = 0; i < 45 && (await snaps(page)).temperature < center - 1.5; i++) await runFor(page, 50);
    check((await snaps(page)).temperature >= center - 1.5, '100% actual wind input must raise furnace temperature');
    await fuel(page, Math.round(.28 * (center - 22) / 40 * 100));
  }
  await runFor(page, 14500);
  const s = await snaps(page);
  check(s.stage === 1 && s.done && !s.active, 'Heat must finish without advancing automatically', s);
  if (good) check(s.scores.heat >= 60, 'Controlled recipe heat score must be at least 60', s);
  else same(s.scores.heat, 0, 'Zero wind must produce zero heat score');
  return s;
}
const targets = [.5, .64, .36, .58, .43, .67, .5];
const lastHitTimes = new WeakMap();
async function aim(page, good = true) {
  const s = await snaps(page);
  check(s.stage === 2 && s.active && !s.paused && !s.done, 'Hammer aiming requires active stage 2', s);
  // Solve the sine wave from the read-only elapsed snapshot; never set game time, scores or position.
  const earliest = Math.max(s.elapsed + .032, (lastHitTimes.get(page) ?? -10) + .300);
  const angle = good ? Math.asin((targets[s.hits.length] - .5) / .46) : 3 * Math.PI / 2;
  const bases = good ? [angle, Math.PI - angle] : [angle];
  const candidates = bases.map(a => {
    const k = Math.ceil((earliest * 3.45 - 1.12 - a) / (2 * Math.PI));
    return (a + 1.12 + 2 * Math.PI * k) / 3.45;
  });
  const targetTime = Math.min(...candidates);
  check(targetTime - (lastHitTimes.get(page) ?? -10) >= .28, 'Test must never target a sub-0.28s consecutive strike');
  await runFor(page, Math.ceil((targetTime - s.elapsed) * 1000));
  const aimed = await snaps(page);
  check(aimed.elapsed - (lastHitTimes.get(page) ?? -10) >= .28, 'Browser elapsed must satisfy hammer cooldown', aimed);
  if (good) check(Math.abs(.5 + .46 * Math.sin(aimed.elapsed * 3.45 - 1.12) - targets[aimed.hits.length]) < .035,
    'Real browser marker must be close to target center', { targetTime, aimed });
  return aimed;
}
async function hammer(page, good = true) {
  await aim(page, good);
  const before = await snaps(page);
  await click(page, '#main-action');
  const after = await snaps(page);
  same(after.hits.length, before.hits.length + 1, 'One click must consume exactly one hammer strike');
  lastHitTimes.set(page, after.elapsed);
  if (good) check(after.hits.at(-1) >= 90, 'Center-aligned UI strike score must be >=90', after);
  else same(after.hits.at(-1), 0, 'Far-off-center UI strike must score zero');
  return after;
}
async function node(page, i, part = '.node-ring') {
  const l = page.locator(`[data-node="${i}"] ${part}`);
  check(await l.isVisible(), `Rune node ${i} must be visible`);
  // Force omits stability/aria-disabled checks, not browser event delivery. Ready SVG intentionally rejects input.
  if (page === m) await l.tap({ force: true }); else await l.click({ force: true });
}
async function completeRunes(page) {
  // Read the displayed 1..6 route rather than assuming Qing's order for every recipe.
  const route = await page.locator('.rune-node').evaluateAll(nodes => nodes.map(g => ({
    node: Number(g.dataset.node), order: Number(g.querySelector('.node-order').textContent.split('/')[0])
  })).sort((a,b) => a.order - b.order).map(g => g.node));
  for (let i = 0; i < route.length; i++) {
    await node(page, route[i], i % 2 ? '.node-glyph' : '.node-ring');
    same((await snaps(page)).runeProgress, i + 1, 'Real SVG glyph/circle locator pointerdown must connect one correct rune node');
  }
}
async function confirmedReset(page) { await click(page, '#reset-btn'); await click(page, '#confirm-reset'); }

add('01 Desktop initial materials and full ready UI', async () => {
  p = await newGame(desktop, 'desktop');
  const s = await snaps(p); same(s.stage, 0, 'Initial selection stage');
  for (const id of ['[data-material="qing"]', '[data-material="xuan"]', '#silver-btn', '#main-action', '#stage-notes'])
    check(await p.locator(id).isVisible(), `Initial material/control must be visible: ${id}`);
  same(await p.locator('[data-material="qing"]').getAttribute('aria-pressed'), 'true', 'Default Qing material');
  await shot(p, 'desktop_initial_1280x900');
  return overflow(p, 'desktop initial');
}, { source: [150, 160], reproduction: 'Open file URL in Edge at 1280x900 and inspect all material cards and start button.' });
add('02 Two exclusive primary materials and silver parameters', async () => {
  const values = [];
  for (const [material, silver, band, nature] of [
    ['qing', false, '62–78', '稳固'], ['qing', true, '64–76', '稳固'],
    ['xuan', true, '70–74', '锋锐'], ['xuan', false, '68–76', '锋锐'], ['qing', false, '62–78', '稳固']
  ]) {
    await click(p, `[data-material="${material}"]`);
    if ((await snaps(p)).silver !== silver) await click(p, '#silver-btn');
    const s = await snaps(p); same([s.material, s.silver], [material, silver], 'Selected recipe');
    same(await p.locator('#note-heat').textContent(), band, 'Heat window must change with materials');
    same(await p.locator('#note-nature').textContent(), nature, 'Primary nature must change');
    same(await p.locator('[data-material][aria-pressed="true"]').count(), 1, 'Exactly one main material selected');
    values.push({ material, silver, band, nature });
  }
  return values;
}, { source: [102, 113, 150, 175] });
add('03 Primary enters heat ready without timing', () => ready(p, 1), { source: [120, 168] });
add('04 Optimal Qing heat by real wind input and clock', () => heat(p, true), { source: [124, 176, 207] });
add('05 Primary enters hammer ready without timing', () => ready(p, 2), { source: [121, 133, 168] });
add('06 Center strike and repeated clicks inside cooldown', async () => {
  await click(p, '#main-action');
  const first = await hammer(p);
  await p.locator('#main-action').click({ force: true });
  await p.locator('#main-action').click({ force: true });
  same((await snaps(p)).hits, first.hits, 'Rapid repeated button clicks must not add strikes inside cooldown');
  return first;
}, { source: [129, 168, 174] });
add('07 Space auto-repeat ignored even after strike cooldown', async () => {
  await p.locator('#scene').click({ force: true }); // Remove button focus for initial key strike.
  await aim(p);
  const before = await snaps(p);
  await p.keyboard.down('Space');
  const hit = await snaps(p); same(hit.hits.length, before.hits.length + 1, 'Initial Space keydown is one strike');
  check(hit.hits.at(-1) >= 90, 'Space strike is center aligned', hit);
  lastHitTimes.set(p, hit.elapsed);
  // Put focus on the primary button using native Tab, without producing an extra mouse strike.
  for (let i = 0; i < 4 && !(await p.locator('#main-action').evaluate(e => e === document.activeElement)); i++) await p.keyboard.press('Tab');
  if (!(await p.locator('#main-action').evaluate(e => e === document.activeElement))) throw new Error('HARNESS: native Tab did not focus primary');
  await runFor(p, 400);
  await p.keyboard.down('Space');
  await runFor(p, 400);
  await p.keyboard.down('Space');
  await p.keyboard.up('Space');
  same((await snaps(p)).hits, hit.hits, 'Repeat Space on focused primary must prevent native activation after cooldown/key release');
  const repeats = report.uiEvents.filter(e => e.page === 'desktop' && e.type === 'keydown' && e.code === 'Space' && e.repeat);
  check(repeats.length >= 2 && repeats.every(e => e.trusted && e.defaultPrevented), 'Repeat Space events must be trusted and defaultPrevented', repeats);
  return hit;
}, { source: [129, 182] });
add('08 Seven real center-aligned hammer strikes complete shape', async () => {
  while ((await snaps(p)).hits.length < 7) await hammer(p);
  const s = await snaps(p);
  check(s.done && !s.active && s.stage === 2, 'Seven strikes stop at completed hammer stage', s);
  check(s.scores.hammer >= 90, 'Optimal real seven-hammer average >=90', s);
  return s;
}, { source: [103, 116, 129] });
add('09 Primary enters rune ready; inactive pointer input ignored', async () => {
  await ready(p, 3);
  same(await p.locator('.rune-node').count(), 6, 'All six rune nodes rendered');
  const inspectBoard = () => p.evaluate(() => {
    const board = document.getElementById('rune-board');
    return { constructor: board.constructor.name, hiddenAttribute: board.hasAttribute('hidden'),
      hiddenProperty: board.hidden, ownHiddenProperty: Object.hasOwn(board, 'hidden'),
      display: getComputedStyle(board).display, rect: board.getBoundingClientRect().toJSON(),
      nodeCount: board.querySelectorAll('.rune-node').length };
  });
  const boardReady = await inspectBoard();
  check(!boardReady.hiddenAttribute && boardReady.display !== 'none', 'Rune SVG hidden attribute must be removed on entry', boardReady);
  await node(p, 0);
  same((await snaps(p)).runeProgress, 0, 'Ready rune board must ignore pointer input until pen starts');
  return { boardReady, snapshot: await snaps(p) };
}, { source: [57, 160, 171, 184], reproduction: 'Reach rune ready using actual UI. Inspect SVG visibility, then send a real locator click to its circle. It must remain ready with progress 0 until 提笔.' });
add('10 Six correct rune nodes via actual pointerdown', async () => {
  await click(p, '#main-action'); await completeRunes(p);
  const s = await snaps(p); same(s.scores.rune, 100, 'Perfect pointer route scores 100');
  same(await p.locator('.rune-node.done').count(), 6, 'All six nodes visually completed');
  return s;
}, { source: [130, 169, 183] });
add('11 Primary enters quench ready without cooling', () => ready(p, 4), { source: [121, 133, 168] });
add('12 Quench inside real temperature window', async () => {
  await click(p, '#main-action'); await runFor(p, 4100);
  const before = await snaps(p); check(before.temperature >= 48 && before.temperature <= 60, 'Actual quench temperature in band', before);
  await click(p, '#main-action'); const s = await snaps(p);
  same(s.scores.quench, 100, 'Window-timed UI quench scores 100');
  same(s.quenched, true, 'Real UI quench marks entry into water');
  await shot(p, 'desktop_quenched_in_water_1280x900'); return s;
}, { source: [126, 132, 169, 205] });
add('13 Real result, four scores, attributes and desktop screenshot', async () => {
  await click(p, '#main-action'); const s = await snaps(p); optimalResult = s.result;
  same(s.stage, 5, 'Manual final action produces finished stage');
  same(s.result.grade, '灵品', 'Optimal Qing UI run must be spiritual grade');
  for (const key of ['heat', 'hammer', 'rune', 'quench'])
    same(Number(await p.locator(`#score-${key}`).textContent()), s.result.scores[key], `Visible ${key} score`);
  for (const key of ['sharp', 'stable', 'spirit'])
    same(Number(await p.locator(`#${key}-value`).textContent()), s.result.attributes[key], `Visible ${key} attribute`);
  same(await p.locator('#result-grade').textContent(), s.result.grade, 'Result grade text');
  same(await p.locator('#result-score').textContent(), `${s.result.quality} / 100`, 'Weighted result score text');
  await shot(p, 'desktop_finished_1280x900'); return { ...s.result, layout: await overflow(p, 'desktop result') };
}, { source: [134, 171] });
add('14 Browser-exported JSON saved and validated', async () => {
  const waiting = p.waitForEvent('download'); await click(p, '#export-result'); const download = await waiting;
  const file = path.join(OUT, `${stamp}_Qing_UI_export.json`); await download.saveAs(file);
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  same(payload.version, 'web-0.1', 'Export version');
  for (const key of ['name', 'quality', 'grade', 'material', 'silver', 'attributes', 'scores', 'flaws', 'records'])
    same(payload[key], optimalResult[key], `Downloaded JSON field ${key}`);
  same((await snaps(p)).result, optimalResult, 'Export does not mutate result');
  report.downloads.push({ path: file, suggestedFilename: download.suggestedFilename(), bytes: fs.statSync(file).size });
  return payload;
}, { source: [181] });
add('15 Forge again resets finished run', async () => {
  await click(p, '#forge-again'); const s = await snaps(p);
  same([s.stage, s.active, s.paused, s.elapsed, s.hits.length, s.result], [0, false, false, 0, 0, null], 'Result restart resets progress');
  same(s.scores, { heat: 0, hammer: 0, rune: 0, quench: 0 }, 'Result restart clears all scores');
  same(await p.locator('#fuel').inputValue(), '58', 'Restart resets wind slider');
  same(await p.locator('#notes-title').textContent(), '师门札记', 'Restart restores master notes title');
  const notes = await p.locator('#note-rule').textContent();
  for (const text of ['器无贵贱', '青纹铁', '玄寒铁', '引灵银']) check(notes.includes(text), 'Restart restores material notes, not stale quench notes', notes);
  check(await p.locator('#stage-notes').isVisible() && !(await p.locator('#result-notes').isVisible()), 'Restart restores correct notes panels');
  return await snaps(p);
}, { source: [162, 174, 181] });
add('16 Explicit pause freezes time and blocks actions until manual resume', async () => {
  p = await newGame(desktop, 'pause-reset');
  await ready(p, 1); await fuel(p, 100); await click(p, '#main-action'); await runFor(p, 1000);
  await click(p, '#pause-btn'); const frozen = await snaps(p); check(frozen.paused, 'Pause state enabled');
  await runFor(p, 2500); same(await snaps(p), frozen, 'Paused heat freezes all snapshot fields');
  check(!(await p.locator('#main-action').isEnabled()) && !(await p.locator('#fuel').isEnabled()), 'Pause disables control input');
  // Space on the still-focused pause tool is a legitimate explicit resume, not a game-input defect.
  await p.locator('#pause-overlay strong').click({ force: true });
  if (await p.evaluate(() => document.activeElement?.closest('button,input,textarea,select') !== null))
    throw new Error('HARNESS: pause keyboard probe still focuses an actionable control');
  await p.keyboard.press('Space'); same(await snaps(p), frozen, 'Space on non-control scene while paused does nothing');
  await click(p, '#resume-btn'); same((await snaps(p)).elapsed, frozen.elapsed, 'Resume does not jump time');
  await runFor(p, 500); check((await snaps(p)).elapsed > frozen.elapsed, 'Only manual resume restarts timing');
}, { source: [119, 123, 172, 178, 182] });
add('17 Mid-run reset requires confirmation; cancel preserves paused progress', async () => {
  const before = await snaps(p); await click(p, '#reset-btn');
  check(await p.locator('#reset-dialog').isVisible(), 'Mid-run reset opens confirmation dialog');
  const expected = { ...before, paused: true };
  same(await snaps(p), expected, 'Opening reset preserves progress and pauses');
  await click(p, '#cancel-reset'); same(await snaps(p), expected, 'Cancel keeps paused progress');
  await runFor(p, 2000); same(await snaps(p), expected, 'Cancel must not auto-resume');
  await click(p, '#resume-btn'); await runFor(p, 64); check(!(await snaps(p)).paused, 'Cancel path supports explicit resume');
  return expected;
}, { source: [172, 180] });
add('18 Confirming mid-run reset clears run', async () => {
  await confirmedReset(p); const s = await snaps(p);
  same([s.stage, s.elapsed, s.active, s.paused, s.result], [0, 0, false, false, null], 'Confirmed reset returns to clean selection');
}, { source: [173, 180] });
add('19 Real browser loss of focus freezes; return needs manual resume', async () => {
  p = await newGame(desktop, 'blur');
  await ready(p, 1); await click(p, '#main-action'); await runFor(p, 500);
  // Disable Chromium's testing-only forced focus emulation to allow actual tab focus/visibility events.
  // This is not a dispatched blur event and changes no OS/browser security setting.
  const cdp = await desktop.newCDPSession(p);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  const away = await desktop.newPage();
  const awayCdp = await desktop.newCDPSession(away);
  await awayCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await away.bringToFront();
  const focus = await p.evaluate(() => ({ focus: document.hasFocus(), visibility: document.visibilityState }));
  const frozen = await snaps(p);
  if (focus.focus && focus.visibility === 'visible') {
    await away.close();
    throw new Error('HARNESS: headless Edge did not deliver a genuine background-tab/blur state; cannot claim blur validation.');
  }
  check(frozen.paused, 'Actual browser blur/background visibility must pause', { focus, frozen });
  await runFor(p, 2400); same(await snaps(p), frozen, 'Browser-background heat must freeze');
  await away.close(); await p.bringToFront();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await runFor(p, 1500); same(await snaps(p), frozen, 'Returning browser focus must not auto-resume');
  await click(p, '#resume-btn'); await runFor(p, 400);
  check((await snaps(p)).elapsed > frozen.elapsed, 'Manual continue after blur restores timing');
  return { focus, frozen };
}, { source: [172, 187], reproduction: 'Begin heat, foreground a second Edge tab, wait, return to game tab; only Continue should restart.' });
add('20 All-mistake heat with native zero wind', async () => {
  p = await newGame(desktop, 'all-mistakes'); await ready(p, 1); return heat(p, false);
}, { source: [124, 177] });
add('21 All-mistake seven off-center real strikes', async () => {
  await ready(p, 2); lastHitTimes.delete(p); await click(p, '#main-action');
  for (let i = 0; i < 7; i++) await hammer(p, false);
  const s = await snaps(p); same(s.scores.hammer, 0, 'Seven misses score zero but finish'); check(s.done, 'Missed hammer stage still completes'); return s;
}, { source: [107, 129] });
add('22 Drag skips completed nodes; wrong order and exactly one retrace', async () => {
  await ready(p, 3); await click(p, '#main-action'); await node(p, 0, '.node-glyph');
  same((await snaps(p)).runeProgress, 1, 'Real SVG text-target click advances first node');
  const boxes = await Promise.all([0,1].map(i => p.locator(`[data-node="${i}"] .node-ring`).boundingBox()));
  if (boxes.some(b => !b)) throw new Error('HARNESS: SVG drag target box missing');
  const centers = boxes.map(b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
  await p.mouse.move(centers[1].x, centers[1].y); await p.mouse.down();
  same((await snaps(p)).runeProgress, 2, 'Real pointerdown begins stroke on next circle');
  await runFor(p, 120); await p.mouse.move(centers[0].x, centers[0].y, { steps: 8 });
  await runFor(p, 120); await p.mouse.move(centers[1].x, centers[1].y, { steps: 8 });
  await runFor(p, 120); await p.mouse.move(centers[0].x, centers[0].y, { steps: 8 });
  await p.mouse.up(); const drag = await snaps(p);
  same([drag.runeProgress, drag.runeMistakes], [2, 0], 'Dragging across already completed nodes must not add jitter mistakes');
  await node(p, 3);
  same((await snaps(p)).runeMistakes, 1, 'Wrong pointer order counts one mistake');
  await click(p, '#retry-rune'); const retraced = await snaps(p);
  same([retraced.retraced, retraced.runeProgress, retraced.runeMistakes], [true, 0, 0], 'One retrace clears mistakes and preserves penalty');
  check(!(await p.locator('#retry-rune').isVisible()), 'A second retrace must not be offered');
  for (let i = 0; i < 8; i++) await node(p, 5);
  await completeRunes(p); const s = await snaps(p);
  same(s.scores.rune, 0, 'Severe mistakes make zero-score complete rune'); check(s.done && s.retraced, 'Rune completes despite mistakes');
  return { drag, retraced, completed: s };
}, { source: [117, 130, 131, 178, 184, 185] });
add('23 Quench timeout still produces a flawed finished item', async () => {
  await ready(p, 4); await click(p, '#main-action'); await runFor(p, 7500);
  const cold = await snaps(p); same(cold.scores.quench, 0, 'Untouched quench timeout is zero'); check(cold.done && !cold.active, 'Timeout stops at done');
  same(cold.quenched, false, 'Natural cooling must not mark the item as quenched');
  await shot(p, 'desktop_natural_cooling_above_water_1280x900');
  await click(p, '#main-action'); const s = await snaps(p);
  same(s.stage, 5, 'All-mistake route still creates an item'); same(s.result.grade, '瑕品', 'All-mistake grade is flawed');
  same(s.result.scores, { heat: 0, hammer: 0, rune: 0, quench: 0 }, 'Actual UI all-zero scores');
  check(s.result.flaws.some(x => x.startsWith('暗裂')), 'Severe heat/quench failure records dark cracks');
  await shot(p, 'desktop_all_mistakes_finished_1280x900'); return s.result;
}, { source: [126, 134, 171] });
add('24 Mobile 390x844 initial full-page screenshot and touch selection', async () => {
  m = await newGame(mobile, 'mobile');
  await shot(m, 'mobile_initial_390x844_full', true);
  await click(m, '[data-material="xuan"]'); await click(m, '#silver-btn');
  same([(await snaps(m)).material, (await snaps(m)).silver], ['xuan', true], 'Native touch selects materials');
  return overflow(m, 'mobile initial');
}, { source: [10, 150, 176] });
add('25 Mobile actual touch route to rune and full-page layout', async () => {
  await ready(m, 1); await heat(m, true); await ready(m, 2); await click(m, '#main-action');
  for (let i = 0; i < 7; i++) await hammer(m);
  await ready(m, 3); await click(m, '#main-action');
  await shot(m, 'mobile_rune_390x844_full', true); return overflow(m, 'mobile rune');
}, { source: [10, 129, 170, 183] });
add('26 Mobile Xuan plus silver six-node touch engraving and final quench', async () => {
  await completeRunes(m); same((await snaps(m)).scores.rune, 100, 'Touch pointer route scores 100');
  await ready(m, 4); await click(m, '#main-action'); await runFor(m, 4200);
  const before = await snaps(m); check(before.temperature >= 50 && before.temperature <= 56, 'Real Xuan quench window', before);
  await click(m, '#main-action'); same((await snaps(m)).quenched, true, 'Actual entry into water sets quenched');
  await shot(m, 'mobile_Xuan_silver_quenched_390x844_full', true); await click(m, '#main-action');
  const s = await snaps(m);
  same([s.result.material, s.result.silver, s.result.grade], ['玄寒铁', true, '灵品'], 'Full mobile Xuan plus silver touch flow produces spiritual item');
  const q = Math.round(.3 * s.scores.heat + .3 * s.scores.hammer + .2 * s.scores.rune + .2 * s.scores.quench);
  same(s.result.quality, q, 'Actual mobile result weighted quality');
  await shot(m, 'mobile_finished_390x844_full', true);
  return { ...s.result, layout: await overflow(m, 'mobile finished') };
}, { source: [130, 132, 134, 184] });
add('27 Supplementary independent core formula and bounds checks', async () => {
  const before = await snaps(p);
  const outputs = await p.evaluate(() => {
    const { Run, Rules } = window.LingForge;
    const outputs = [];
    for (const material of ['qing', 'xuan']) for (const silver of [false, true]) {
      const r = new Run(material, silver); r.begin(); r.start(); r.setFuel(1);
      while (r.temperature < (r.heatBand[0] + r.heatBand[1]) / 2) r.tick(.04);
      r.setFuel(.28 * ((r.heatBand[0] + r.heatBand[1]) / 2 - 22) / 40); r.tick(14);
      r.advance(); r.start();
      for (let i = 0; i < 7; i++) {
        const angle = Math.asin((r.hammerTarget - .5) / .46);
        const t = (angle + 1.12 + 2 * Math.PI * (i + 1)) / 3.45;
        r.tick(t - r.elapsed); r.hit();
      }
      r.advance(); r.start(); for (const node of r.runeRoute) r.runeNode(node);
      r.advance(); r.start(); r.tick((95 - (r.config.quench[0] + r.config.quench[1]) / 2) / 10); r.quench(); r.advance();
      outputs.push(r.snapshot());
    }
    const probe = new Run(); const initial = probe.snapshot();
    const rejects = [probe.tick(NaN), probe.tick(-1), probe.choose('missing', false), probe.setFuel(Infinity)];
    return { outputs, rejects, probeUnchanged: JSON.stringify(initial) === JSON.stringify(probe.snapshot()),
      boundaries: [Rules.heatScore(0), Rules.heatScore(14), Rules.hammerScore(.5, .5, .18), Rules.quenchScore(54, [48, 60]), Rules.quenchScore(25, [48, 60])] };
  });
  same(await snaps(p), before, 'Independent formula probes must not alter actual UI run');
  same(outputs.rejects, [false, false, false, false], 'Invalid independent inputs rejected');
  check(outputs.probeUnchanged, 'Invalid independent inputs leave probe unchanged');
  same(outputs.boundaries, [0, 100, 100, 100, 31], 'Formula boundaries');
  for (const s of outputs.outputs) {
    same(s.stage, 5, 'Independent four-recipe formula run completes');
    same([s.scores.hammer, s.scores.rune, s.scores.quench], [100, 100, 100], 'Independent perfect formula components');
    const q = Math.round(.3 * s.scores.heat + .3 * s.scores.hammer + .2 * s.scores.rune + .2 * s.scores.quench);
    same(s.result.quality, q, 'Independent result uses documented four weights');
  }
  return outputs;
}, { kind: 'supplementary_core', source: [104, 107, 108, 119, 123, 134] });
add('28 Real-browser diagnostics and trusted-input evidence', async () => {
  // Drain exposeFunction callbacks before reading evidence; this is not game-time manipulation.
  await p.evaluate(() => Promise.resolve()); await m.evaluate(() => Promise.resolve());
  same(report.diagnostics.pageerrors, [], 'No pageerror'); same(report.diagnostics.consoleErrors, [], 'No console.error');
  same(report.diagnostics.failedRequests, [], 'No failed requests'); same(report.diagnostics.httpErrors, [], 'No HTTP failures');
  check(report.uiEvents.some(e => e.type === 'input' && e.trusted && e.value === '100'), 'Heat uses trusted actual range input');
  check(report.uiEvents.some(e => e.type === 'keydown' && e.trusted && e.repeat && e.code === 'Space'), 'Space repeat was genuinely tested');
  check(report.uiEvents.filter(e => e.page === 'mobile' && e.type === 'pointerdown' && e.trusted && e.pointerType === 'touch').length >= 6,
    'Mobile run must contain at least six trusted touch pointerdowns');
  check(report.uiEvents.some(e => e.type === 'pointermove' && e.trusted && e.pointerType === 'mouse'), 'Drag route uses real browser mouse movement');
  check(report.uiEvents.some(e => e.page === 'blur' && ['blur', 'visibilitychange'].includes(e.type) && e.trusted && (!e.focus || e.visibility === 'hidden')),
    'Blur case contains trusted actual browser background evidence');
  check(!report.diagnostics.requests.some(e => /^https?:/i.test(e.url)), 'Single HTML must not depend on remote network resources');
  return { diagnostics: report.diagnostics, trustedInputEvents: report.uiEvents.filter(e => e.trusted).length };
}, { source: [182, 188, 208] });
add('29 Double-click selection primary must not ignite without separate start', async () => {
  // Same delivered HTML, fresh actual page, frozen clock, real mouse double-click.
  const d = await newGame(desktop, 'duplicate-start'); lastPage = d;
  await d.locator('#main-action').dblclick({ force: true });
  const immediate = await snaps(d);
  await runFor(d, 800); const after = await snaps(d);
  same([immediate.stage, immediate.active, immediate.elapsed], [1, false, 0],
    'BUG: Double-click 投料入炉 also triggers 点燃炉火 instead of leaving the new heat stage ready');
  same(after, immediate, 'Duplicate advance must not start counting ready-stage time');
  return { immediate, after };
}, { source: [120, 121, 168, 174], reproduction: 'Fresh selection page: double-click the primary 投料入炉 button. Expected: stage 1 ready, active=false, elapsed=0 until a separate ignition. Actual: inspect snapshot and 800ms clock advancement. No DOM/game state assignment is used.' });
add('30 Completed hammer double-click must not advance or start rune', async () => {
  // Reach the last hammer with real input; the seventh strike and duplicate must not consume two actions.
  p = await newGame(desktop, 'duplicate-final-hammer'); lastPage = p;
  await ready(p, 1); await heat(p, true); await ready(p, 2); await click(p, '#main-action');
  for (let i = 0; i < 6; i++) await hammer(p);
  await aim(p); await p.locator('#main-action').dblclick({ force: true });
  const s = await snaps(p);
  same([s.stage, s.done, s.hits.length], [2, true, 7], 'Duplicate final hammer click must not advance the completed stage');
  return s;
}, { source: [129, 133, 169, 175], reproduction: 'After six UI hammers, double-click the seventh strike. Expected: hammer done awaiting separate advance; duplicate must not be interpreted as a separate advance.' });
add('31 Third real UI run produces good grade with measured mistakes', async () => {
  const g = await newGame(desktop, 'good-grade');
  await ready(g, 1); const heatResult = await heat(g, true); await ready(g, 2); await click(g, '#main-action');
  for (let i = 0; i < 7; i++) await hammer(g);
  await ready(g, 3); await click(g, '#main-action');
  for (let i = 0; i < 3; i++) await node(g, 5);
  await completeRunes(g); same((await snaps(g)).scores.rune, 64, 'Three wrong UI nodes produce rune 64');
  await ready(g, 4); await click(g, '#main-action'); await runFor(g, 1500);
  const warm = await snaps(g); check(warm.temperature > 60, 'This actual quench is intentionally early', warm);
  await click(g, '#main-action'); await click(g, '#main-action');
  const s = await snaps(g); same(s.result.grade, '良品', 'Measured moderate mistakes produce actual good grade');
  check(s.result.quality >= 50 && s.result.quality < 80, 'Good quality uses actual measured components', s.result);
  await shot(g, 'desktop_good_grade_finished_1280x900');
  return { ...s.result, heatEvidence: heatResult, quenchBefore: warm };
}, { source: [108, 124, 130, 132, 134] });

(async () => {
  report.registeredCases = cases.length;
  report.plannedBrowserUiCases = cases.filter(c => c.kind === 'browser_ui').length;
  report.plannedSupplementaryCases = cases.filter(c => c.kind !== 'browser_ui').length;
  const dependencies = { 2:[1], 3:[2], 4:[3], 5:[4], 6:[5], 7:[6], 8:[7], 9:[8], 10:[9], 11:[10], 12:[11], 13:[12], 14:[13], 15:[13],
    17:[16], 18:[17], 21:[20], 22:[21], 23:[22], 25:[24], 26:[25] };
  // Diagnostics must include every real UI run; independent groups continue even after a bug.
  const executionCases = [...cases.filter(c => !c.name.startsWith('28 ')), cases.find(c => c.name.startsWith('28 '))];
  try {
    browser = await chromium.launch(EDGE ? { executablePath: EDGE, headless: true } : { headless: true });
    report.browserVersion = browser.version();
    desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true });
    for (const c of executionCases) {
      const id = Number(c.name.slice(0,2));
      const blocked = (dependencies[id] || []).filter(dep => !report.cases.some(r => Number(r.name.slice(0,2)) === dep && r.status === 'passed'));
      const item = { name: c.name, kind: c.kind, status: 'running', source: c.source?.map(line => `${path.resolve(HTML)}:${line}`), reproduction: c.reproduction };
      report.cases.push(item);
      if (blocked.length) { item.status = 'not_run_dependency'; item.blockedBy = blocked; console.log(`SKIP ${c.name}: prerequisites ${blocked.join(',')}`); continue; }
      console.log(`RUN ${c.name}`);
      try { item.details = await c.body(); item.status = 'passed'; console.log(`PASS ${c.name}`); }
      catch (error) {
        item.status = error instanceof ProductBug ? 'product_bug' : 'harness_error';
        item.message = error.message; item.actual = error.actual; item.stack = error.stack;
        if (!report.firstFailure) report.firstFailure = item;
        const evidencePage = lastPage && !lastPage.isClosed() ? lastPage : p;
        try { item.snapshot = await snaps(evidencePage); item.screenshot = await shot(evidencePage, `failure_case_${id}`, true); }
        catch (captureError) { item.captureError = captureError.message; }
        console.log(`FAIL ${item.status}: ${error.message}`);
      }
    }
    report.status = report.cases.some(c => c.status === 'product_bug') ? 'product_bug' :
      report.cases.some(c => c.status === 'harness_error') ? 'harness_error' :
      report.cases.some(c => c.status.startsWith('not_run')) ? 'incomplete' : 'passed';
  } catch (error) {
    report.status = 'launch_or_setup_error'; report.error = { message: error.message, stack: error.stack };
    for (const c of executionCases.filter(c => !report.cases.some(r => r.name === c.name))) report.cases.push({ name: c.name, kind: c.kind, status: 'not_run_setup_error' });
    console.log(`STOP launch/setup: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(e => report.limitations.push(`Browser close: ${e.message}`));
    report.htmlSha256After = hash(); report.htmlUnchanged = report.htmlSha256Before === report.htmlSha256After;
    if (!report.htmlUnchanged) report.status = 'html_changed_externally';
    report.finishedAt = new Date().toISOString();
    report.counts = {
      registered: cases.length,
      executed: report.cases.filter(c => ['passed','product_bug','harness_error'].includes(c.status)).length,
      passed: report.cases.filter(c => c.status === 'passed').length,
      browserUiPassed: report.cases.filter(c => c.kind === 'browser_ui' && c.status === 'passed').length,
      browserUiFailed: report.cases.filter(c => c.kind === 'browser_ui' && ['product_bug', 'harness_error'].includes(c.status)).length,
      supplementaryPassed: report.cases.filter(c => c.kind !== 'browser_ui' && c.status === 'passed').length,
      supplementaryFailed: report.cases.filter(c => c.kind !== 'browser_ui' && ['product_bug', 'harness_error'].includes(c.status)).length,
      productBugs: report.cases.filter(c => c.status === 'product_bug').length,
      harnessErrors: report.cases.filter(c => c.status === 'harness_error').length,
      notRun: report.cases.filter(c => c.status.startsWith('not_run')).length,
      pageerrors: report.diagnostics.pageerrors.length, consoleErrors: report.diagnostics.consoleErrors.length,
      failedRequests: report.diagnostics.failedRequests.length, screenshots: report.screenshots.length
    };
    report.uiResults = report.cases.filter(c => [13,23,26,31].includes(Number(c.name.slice(0,2))) && c.details?.grade).map(c => ({
      case: c.name, material: c.details.material, silver: c.details.silver, scores: c.details.scores, quality: c.details.quality, grade: c.details.grade
    }));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, browser: report.browserVersion, report: reportPath,
      counts: report.counts, uiResults: report.uiResults, screenshots: report.screenshots.map(s => s.path), htmlUnchanged: report.htmlUnchanged }, null, 2));
    process.exitCode = report.status === 'passed' ? 0 : report.status === 'product_bug' ? 2 : 3;
  }
})();
