'use strict';
// New immersive HUD checks only. Never imports or edits the inherited regression scripts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ROOT = path.resolve(__dirname, '..');
const PRODUCT = path.join(ROOT, 'index.html');
const MODULE = process.env.PLAYWRIGHT_MODULE_PATH || process.env.PLAYWRIGHT_CORE_PATH || path.join(ROOT, 'node_modules', 'playwright-core');
const { chromium } = require(MODULE);
const EDGE = process.env.FORGE_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.FORGE_UI_OUTPUT ? path.resolve(process.env.FORGE_UI_OUTPUT) : path.join(ROOT, 'test-results', 'ui-' + stamp);
if (fs.existsSync(OUT)) throw Error('Use a new UI output directory');
fs.mkdirSync(OUT,{recursive:true});
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const protectedFiles = [PRODUCT, ...fs.readdirSync(path.join(ROOT, 'Source')).map(f => path.join(ROOT, 'Source', f)), ...fs.readdirSync(__dirname).filter(f => f !== 'immersive-ui.cjs').map(f => path.join(__dirname, f))].filter(f => fs.statSync(f).isFile());
const beforeHashes = Object.fromEntries(protectedFiles.map(f => [f, sha(f)]));
const report = { schema: 'immersive-ui-real-browser/1', product: PRODUCT, outputDirectory: OUT, script: __filename, startedAt: new Date().toISOString(), browser: {}, cases: [], screenshots: [], scenarios: [], touchHandlers: [], errors: [], limitations: [], inputMethod: 'Playwright real mouse/keyboard and native CDP Input.dispatchTouchEvent/dispatchKeyEvent; passive trusted-event audit only; API/Three objects read-only', clockMethod: 'Installed Playwright clock; runFor for rendered gestures, fastForward only elapsed thermal clock (12s), never Run mutation', screenshotsCountedAsTests: false, performanceCountedAsTests: false };
let browser;
const names = new Set();
function check(mode, name, ok, actual, reproduce) {
  const full = mode + '.' + name;
  if (names.has(full)) throw Error('Duplicate assertion name: ' + full);
  names.add(full);
  const c = { name: full, status: ok ? 'pass' : 'fail', actual };
  if (!ok && reproduce) c.minimalReproduction = reproduce;
  report.cases.push(c);
  if (!ok) console.log(JSON.stringify({ failure: full, actual, reproduce }));
}
function counts(cases) { return cases.reduce((a, c) => (a[c.status] = (a[c.status] || 0) + 1, a), { pass: 0, fail: 0 }); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const work = s => ({ stage: s.stage, material: s.material, silver: s.silver, started: s.started, location: s.location, tool: s.tool, face: s.face, thick: s.thick, bias: s.bias, hits: s.hits, damage: s.damage, scores: s.scores, grind: s.grind, scars: s.scars, repairs: s.repairs, runeSegment: s.runeSegment, runeFraction: s.runeFraction });
const fabrication = s => ({ thick: s.thick, bias: s.bias, hits: s.hits, damage: s.damage, scores: s.scores, stage: s.stage, started: s.started });

async function actualThree(cdp) {
  const proto = expression => cdp.send('Runtime.evaluate', { expression });
  const meshProto = await proto('THREE.Mesh.prototype');
  const cameraProto = await proto('THREE.PerspectiveCamera.prototype');
  const meshes = await cdp.send('Runtime.queryObjects', { prototypeObjectId: meshProto.result.objectId });
  const cameras = await cdp.send('Runtime.queryObjects', { prototypeObjectId: cameraProto.result.objectId });
  const result = await cdp.send('Runtime.callFunctionOn', {
    objectId: meshes.objects.objectId, arguments: [{ objectId: cameras.objects.objectId }], returnByValue: true,
    functionDeclaration: `function(cameras) {
      const blade = this.find(m => m.userData?.kind === 'blade' && m.parent?.parent?.isScene);
      const camera = cameras.find(c => c.fov === 43 && c.near === .1 && c.far === 100 && !c.parent);
      const scene = blade.parent.parent;
      const guides = scene.children.find(g => g.isGroup && g.children.some(c => c.material?.color && ['c5ac73','757c62'].includes(c.material.color.getHexString())));
      const r = document.getElementById('world').getBoundingClientRect();
      const p = blade.geometry.attributes.position, points = [];
      for (let i=0;i<p.count;i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(blade.matrixWorld).project(camera);
        points.push({ x:r.left+(v.x+1)*r.width/2, y:r.top+(1-v.y)*r.height/2 });
      }
      return { guideGroup: guides ? { uuid:guides.uuid, type:guides.type, isGroup:guides.isGroup, visible:guides.visible, children:guides.children.length } : null,
        camera:{ position:camera.position.toArray(), matrix:camera.matrixWorld.toArray(), aspect:camera.aspect },
        blade:{ visible:blade.parent.visible, vertices:p.count, triangles:Array.from({length:points.length/3},(_,i)=>points.slice(i*3,i*3+3)), screen:{ left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)) } } };
    }`
  });
  await cdp.send('Runtime.releaseObject', { objectId: meshes.objects.objectId });
  await cdp.send('Runtime.releaseObject', { objectId: cameras.objects.objectId });
  if (result.exceptionDetails) throw Error('Read-only Three heap probe: ' + JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function runMode(mode) {
  const mobile = mode === 'mobile';
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: true, isMobile: mobile, deviceScaleFactor: 1, reducedMotion: 'no-preference', acceptDownloads: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.setDefaultTimeout(6000);
  const localErrors = [], requests = [];
  page.on('pageerror', e => localErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') localErrors.push(m.text()); });
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await page.addInitScript(() => {
    window.__immersivePassiveAudit = [];
    for (const name of ['pointerdown','pointermove','pointerup','pointercancel','click','keydown','keyup','input','blur','focus','visibilitychange']) {
      const target = ['blur','focus','visibilitychange'].includes(name) ? window : document;
      target.addEventListener(name, e => {
        const record={ type:name, trusted:e.isTrusted, target:e.target?.id || e.target?.tagName || 'window', key:e.key, code:e.code, repeat:e.repeat, pointerType:e.pointerType, x:e.clientX, y:e.clientY, hidden:document.hidden };
        window.__immersivePassiveAudit.push(record);
        if(name==='keydown')queueMicrotask(()=>{record.defaultPrevented=e.defaultPrevented;record.focusAfter=document.activeElement?.id||document.activeElement?.tagName;});
      }, true);
    }
  });
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now + 100));
  const snap = () => page.evaluate(() => actionForge3D.snapshot());
  const info = () => page.evaluate(() => actionForge3D.sceneInfo());
  const read = id => page.locator('#' + id).evaluate(e => ({ text:e.textContent, disabled:e.disabled, hidden:e.hidden, title:e.title, pressed:e.getAttribute('aria-pressed'), ready:e.dataset.ready, display:getComputedStyle(e).display, value:e.value }));
  const tick = ms => page.clock.runFor(ms);
  const elapsed = ms => page.clock.fastForward(ms);
  const point = async selector => { await page.locator(selector).scrollIntoViewIfNeeded(); const r = await page.locator(selector).boundingBox(); if (!r) throw Error('No visible box: ' + selector); return { x:r.x+r.width/2, y:r.y+r.height/2 }; };
  const nativeTouch = async (p, type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x:p.x, y:p.y, radiusX:2, radiusY:2, force:1, id:1 }] });
  const touchCounts = new Map();
  const click = async id => {
    // Instrument the ACTUAL first touch, including controls first used during setup/cleanup.
    if(!touchCounts.has(id) && await page.locator('#'+id).evaluate(e=>typeof e.onclick==='function')) return firstTouch(id);
    if (mobile) { const p = await point('#' + id); await nativeTouch(p, 'touchStart'); await nativeTouch(p, 'touchEnd'); } else await page.locator('#' + id).click(); await elapsed(600); await tick(32);
  };
  async function firstTouch(id, expectation) {
    const occurrence=(touchCounts.get(id)||0)+1;touchCounts.set(id,occurrence);
    const pre = await snap();
    const func = await cdp.send('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(id)}).onclick` });
    if (!func.result.objectId) throw Error('Missing handler: ' + id);
    await cdp.send('Debugger.enable');
    const bp = await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: func.result.objectId });
    let calls = 0;
    const listener = event => { if (event.hitBreakpoints?.includes(bp.breakpointId)) calls++; cdp.send('Debugger.resume').catch(() => {}); };
    cdp.on('Debugger.paused', listener);
    const p = await point('#' + id);
    const auditAt = await page.evaluate(() => __immersivePassiveAudit.length);
    try { await nativeTouch(p, 'touchStart'); await nativeTouch(p, 'touchEnd'); await tick(64); }
    finally { await cdp.send('Debugger.removeBreakpoint', { breakpointId:bp.breakpointId }); cdp.off('Debugger.paused', listener); await cdp.send('Debugger.disable'); }
    const post = await snap();
    const events = await page.evaluate(n => __immersivePassiveAudit.slice(n), auditAt);
    const expected = expectation ? await expectation(pre, post) : true;
    const evidence = { id, occurrence, actualFirstTouch:occurrence===1, calls, stateBefore:pre, stateAfter:post, events };
    report.touchHandlers.push({ mode, ...evidence });
    check(mode, (occurrence===1?'首触一次.':'复触一次.') + id + (occurrence===1?'':'.'+occurrence), calls === 1 && expected && events.some(e => e.type === 'pointerup' && e.pointerType === 'touch' && e.trusted), evidence, ['真实触摸 #' + id + '；期望一次业务handler和一次状态切换。']);
    await elapsed(600); await tick(32);
  }
  async function canvasFocus() {
    await page.locator('#world').scrollIntoViewIfNeeded();
    const p = await page.locator('#world').evaluate(c => {
      const r=c.getBoundingClientRect();
      for (const [dx,dy] of [[.05,.72],[.9,.55],[.06,.55],[.5,.72],[.9,.72]]) {
        const x=r.left+r.width*dx,y=r.top+r.height*dy;
        if (document.elementFromPoint(x,y)===c && !actionForge3D.pick(x,y)) return {x,y};
      }
      return null;
    });
    if (!p) throw Error('Cannot focus actual canvas with a background mouse click');
    await page.mouse.click(p.x, p.y);
    return p;
  }
  async function range(value) {
    const p = await point('#draft');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Home');
    for (let i=0;i<value;i++) await page.keyboard.press('ArrowRight');
  }
  async function lift(section, raise, recover, endScreenshot) {
    await page.locator('#world').scrollIntoViewIfNeeded();
    const p = (await page.evaluate(() => actionForge3D.targets())).sections[section];
    const picked = await page.evaluate(p => actionForge3D.pick(p.x,p.y), p);
    if (!picked || picked.section !== section) throw Error('Real blade target miss: ' + JSON.stringify({p,picked,section}));
    if (mobile) await nativeTouch(p,'touchStart'); else { await page.mouse.move(p.x,p.y); await page.mouse.down(); }
    if (raise > 0) { const up={x:p.x,y:p.y-raise}; if(mobile) {await nativeTouch(up,'touchMove');await tick(64);} else await page.mouse.move(up.x,up.y,{steps:6}); }
    const end = { x:p.x, y:raise>0?p.y-raise+recover:p.y+recover };
    if (mobile) {await nativeTouch(end,'touchMove');await tick(96);} else await page.mouse.move(end.x,end.y,{steps:6});
    await tick(32);
    const meter = await page.locator('#gesture-meter').evaluate(e => ({ hidden:e.hidden,ready:e.dataset.ready,label:document.getElementById('gesture-label').textContent,fill:document.getElementById('gesture-fill').style.width,feedback:document.getElementById('feedback').textContent,lastNativeMoves:window.__immersivePassiveAudit.filter(a=>a.type==='pointermove').slice(-4) }));
    if (endScreenshot) await screenshot(endScreenshot);
    if (mobile) await nativeTouch(end,'touchEnd'); else await page.mouse.up();
    await tick(32);
    return meter;
  }
  async function screenshot(label, fullPage=false) {
    const file = path.join(OUT, mode + '-' + label + '.png');
    const request = { format:'png', captureBeyondViewport:true, fromSurface:true };
    if(fullPage) { const m = await cdp.send('Page.getLayoutMetrics');const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight})); request.clip={x:0,y:0,width:Math.max(viewport.width,m.cssContentSize.width),height:Math.max(viewport.height,m.cssContentSize.height),scale:1}; }
    const png = await cdp.send('Page.captureScreenshot', request);
    fs.writeFileSync(file,Buffer.from(png.data,'base64'));
    const bytes = fs.readFileSync(file);
    report.screenshots.push({ mode,label,path:file,method:'native CDP Page.captureScreenshot (no fonts wait)',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,sha256:sha(file) });
  }
  async function layout(label, expectMaterialHidden) {
    const dom = await page.evaluate(() => {
      const c=document.getElementById('world'),r=c.getBoundingClientRect();
      const counts={};document.querySelectorAll('[id]').forEach(e=>counts[e.id]=(counts[e.id]||0)+1);
      return { viewport:{w:innerWidth,h:innerHeight},scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,canvas:{x:r.x,y:r.y,w:r.width,h:r.height}, materialsDisplay:getComputedStyle(document.querySelector('.materials')).display,duplicateIDs:Object.entries(counts).filter(([id,n])=>n>1), stage:document.body.dataset.stage };
    });
    check(mode,label+'.材料显隐',expectMaterialHidden?dom.materialsDisplay==='none':dom.materialsDisplay!=='none',dom);
    check(mode,label+'.画布宽大',dom.canvas.w>=dom.viewport.w*(mobile?.90:.94)&&dom.canvas.h>=(mobile?320:600),dom);
    check(mode,label+'.无水平溢出',dom.scrollWidth<=dom.viewport.w&&dom.bodyScrollWidth<=dom.viewport.w,dom,['打开对应尺寸，检查documentElement/body.scrollWidth与innerWidth。']);
    check(mode,label+'.无重复ID',dom.duplicateIDs.length===0,dom);
  }
  async function thermalEvidence(label) {
    const s=await snap();
    const d=await page.evaluate(()=>({left:parseFloat(document.getElementById('temperature-needle').style.left),bandLeft:parseFloat(document.getElementById('temperature-band').style.left),bandWidth:parseFloat(document.getElementById('temperature-band').style.width),label:document.getElementById('temperature-meter').textContent,footer:document.querySelector('.footer').textContent}));
    check(mode,label+'.温针绑定真实温标',Math.abs(d.left-s.temp)<1e-4&&d.bandLeft===s.band[0]&&d.bandWidth===s.band[1]-s.band[0],{snapshot:s,DOM:d});
    check(mode,label+'.温区不是时机奖励',/适宜温区/.test(d.label)&&!/时机|奖励窗|倒计时/.test(d.label)&&/无时机奖励/.test(d.footer),d);
  }
  async function scenario(name, fn) {
    console.log(JSON.stringify({mode,scenario:name}));
    try { await fn(); report.scenarios.push({mode,name,completed:true}); }
    catch(e) { report.scenarios.push({mode,name,completed:false,harnessError:e.stack}); report.errors.push({mode,scenario:name,type:'harness',message:e.stack}); console.log(JSON.stringify({mode,harnessError:name,error:e.message})); }
  }
  try {
    await page.goto(pathToFileURL(PRODUCT).href,{waitUntil:'load'}); await tick(48);
    check(mode,'真实WebGL启动',await page.evaluate(()=>!!window.actionForge3D&&document.getElementById('engine-error').hidden),await info());
    await scenario('初始与首次触摸菜单',async()=>{
      await screenshot('initial-panorama',true);
      check(mode,'原生全页截图完整覆盖视口宽度',report.screenshots.at(-1).width>=await page.evaluate(()=>innerWidth),report.screenshots.at(-1));
      await layout('初始',false);
      const disabled=await read('next');
      check(mode,'未选主材禁止确认并说明择材',disabled.disabled&&/主材|材料|选/.test((await read('instruction')).text),{button:disabled,instruction:await read('instruction')});
      await firstTouch('guides',async()=> (await read('guides')).pressed==='false');
      await click('guides');
      await firstTouch('view-wide',async()=> (await info()).view==='wide'&&!(await info()).orbitMode);
      await firstTouch('view-close',async()=> (await info()).view==='close');
      await firstTouch('view-orbit',async()=> (await info()).orbitMode===true);
      await click('view-wide');
      await firstTouch('notes',async()=>await page.locator('#notes-dialog').evaluate(e=>e.open));
      await firstTouch('close-notes',async()=>!await page.locator('#notes-dialog').evaluate(e=>e.open));
      await firstTouch('cinema',async()=>await page.locator('body').evaluate(e=>e.classList.contains('cinema')));
      await firstTouch('cinema-peek',async()=>!await page.locator('body').evaluate(e=>e.classList.contains('cinema')));
      await firstTouch('sound',async()=>/音效开/.test((await read('sound')).text)); await click('sound');
      await firstTouch('help',async()=>await page.locator('#manual').evaluate(e=>e.open));
      await firstTouch('close-manual',async()=>!await page.locator('#manual').evaluate(e=>e.open));
      await firstTouch('fullscreen');
      const f=await page.evaluate(()=>({enabled:document.fullscreenEnabled,element:document.fullscreenElement?.className||null,containsTools:!!document.fullscreenElement?.contains(document.getElementById('tool-tray')),feedback:document.getElementById('feedback').textContent}));
      if(f.element) {check(mode,'全屏包含shell及tools',f.element==='shell'&&f.containsTools,f);await click('fullscreen');}
      else {report.limitations.push({mode,type:'fullscreen',actual:f,note:'真实入口被浏览器限制；未绕过权限，不计通过/失败。'});}
      await click('mat-qing'); await click('silver');
      check(mode,'真实择材青纹铁辅银单次切换',(await snap()).material==='qing'&&(await snap()).silver,await snap());
      await click('silver');
      await canvasFocus();
      await page.keyboard.down('Enter');
      const begun=await snap();
      await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,autoRepeat:true});
      const repeated=await snap(); await page.keyboard.up('Enter');
      check(mode,'Enter确认一次且keyrepeat不开始',begun.stage===1&&!begun.started&&same(begun,repeated),{begun,repeated});
      await layout('stage1',true);
    });
    await scenario('开始门禁与工具快捷键',async()=>{
      if((await snap()).stage!==1)throw Error('stage1 precondition');
      const origin=await snap();
      for(const id of ['flip','reheat','to-anvil']){
        const b=await read(id),reason=(await read('instruction')).text;
        check(mode,'未开始disabled及明确原因.'+id,b.disabled&&!b.hidden&&/开始本步|点击开始/.test(reason),{button:b,sharedInstruction:reason});
      }
      for(const [key,tool] of [['2','tap'],['3','lift'],['1','tongs']]) {
        await canvasFocus();await page.keyboard.press(key);const s=await snap();
        check(mode,'数字'+key+'正确择工具且不加工',s.tool===tool&&same(fabrication(s),fabrication(origin)),s);
      }
      await firstTouch('tool-tongs',(a,b)=>b.tool==='tongs'&&same(fabrication(a),fabrication(b)));
      await firstTouch('tool-tap',(a,b)=>b.tool==='tap'&&same(fabrication(a),fabrication(b)));
      await firstTouch('tool-lift',(a,b)=>b.tool==='lift'&&same(fabrication(a),fabrication(b)));
      const icons=await page.locator('.tool').evaluateAll(es=>es.map(e=>({id:e.id,svg:!!e.querySelector('svg[aria-hidden="true"] path'),label:e.getAttribute('aria-label'),key:e.querySelector('kbd')?.textContent})));
      check(mode,'新工具图标及语义快捷键',icons.length===3&&icons.every(e=>e.svg&&e.label&&/[123]/.test(e.key)),icons);
      await page.locator('#world').scrollIntoViewIfNeeded();
      await lift(0,60,52);
      check(mode,'未开始真实提锤不加工',same(fabrication(origin),fabrication(await snap())),{before:origin,after:await snap(),feedback:(await read('feedback')).text});
      await canvasFocus(); await page.keyboard.down('Enter');const once=await snap();
      await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,autoRepeat:true});
      await page.keyboard.up('Enter');const after=await snap();
      check(mode,'Enter开始恰一次且repeat不推进',once.started&&once.stage===1&&same(once,after),{once,after});
      const next=await read('next');
      check(mode,'欠锻disabled且具体厚薄偏差原因',next.disabled&&/厚薄.*偏差/.test(next.text),next);
      await firstTouch('flip',(a,b)=>b.face===1-a.face&&same(fabrication(a),fabrication(b)));
      await canvasFocus();const f=await snap();await page.keyboard.press('f');
      check(mode,'F真实翻面一次不加工',(await snap()).face===1-f.face&&same(fabrication(f),fabrication(await snap())),{before:f,after:await snap()});
      await firstTouch('reheat',(a,b)=>b.location==='furnace'&&b.tool==='tongs'&&same(fabrication(a),fabrication(b)));
      await range(60);
      const onRange=await snap(); await page.keyboard.press('2'); await page.keyboard.press('3');
      check(mode,'滑杆数字热键不截输入',(await snap()).tool===onRange.tool&&(await snap()).draft===.6, {before:onRange,after:await snap(),active:await page.evaluate(()=>document.activeElement.id)});
      await canvasFocus();await elapsed(12000);await tick(32);
      const hot=await snap();
      check(mode,'真实UI风门60与clock12秒进入热态',hot.draft===.6&&hot.location==='furnace'&&hot.temp>=hot.band[0]&&hot.temp<=hot.band[1]+3&&hot.hits===0,hot);
      await thermalEvidence('热态');
      await firstTouch('to-anvil',(a,b)=>b.location==='anvil'&&b.tool==='tongs'&&same(fabrication(a),fabrication(b)));
      await canvasFocus(); await page.keyboard.press('r');
      check(mode,'R真实送炉且不加工',(await snap()).location==='furnace'&&(await snap()).hits===0,await snap());
      await page.keyboard.press('e');
      check(mode,'E真实移砧台且不加工',(await snap()).location==='anvil'&&(await snap()).tool==='tongs'&&(await snap()).hits===0,await snap());
    });
    await scenario('Q真实旋转与失焦取消',async()=>{
      await click('tool-lift');await canvasFocus();
      const s=await snap(),cameraBefore=(await actualThree(cdp)).camera;
      await page.keyboard.down('q');
      const p=(await page.evaluate(()=>actionForge3D.targets())).sections[1];
      await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+60,p.y+15,{steps:6});await tick(32);
      const rotated=await actualThree(cdp);
      await screenshot('q-orbit');await page.mouse.up();await page.keyboard.up('q');
      check(mode,'Q按住拖动真实相机改变',!same(cameraBefore.matrix,rotated.camera.matrix),{cameraBefore,cameraAfter:rotated.camera});
      check(mode,'Q松开返回操作且不加工',!(await info()).orbitMode&&(await info()).gesture===null&&same(fabrication(s),fabrication(await snap())),{before:s,after:await snap(),scene:await info()});
      await click('view-orbit');await canvasFocus();await page.keyboard.down('q');await page.keyboard.up('q');
      const priorOrbit=await info();
      check(mode,'Q从已有orbit真也恢复操作',priorOrbit.orbitMode===false,priorOrbit,['开始锻形后点“旋转视角”使orbit=true。点击画布背景，按下并松开Q。期望返回工具操作，实际仍为旋转模式。']);
      if(priorOrbit.orbitMode)await click('view-orbit');
      await canvasFocus();await page.keyboard.down('q');
      const auxiliary=await context.newPage();await auxiliary.goto('about:blank');
      await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      await page.bringToFront();
      const auditAt=await page.evaluate(()=>__immersivePassiveAudit.length);
      await auxiliary.bringToFront();
      const blurred=await snap(),bi=await info();
      const events=await page.evaluate(n=>__immersivePassiveAudit.slice(n),auditAt);
      check(mode,'Q失焦可信blur取消不黏住',blurred.paused&&!bi.orbitMode&&bi.gesture===null&&events.some(e=>e.type==='blur'&&e.trusted),{blurred,scene:bi,events});
      await elapsed(1200);const freeze=await snap();
      check(mode,'Q失焦冻结温态并保留未加工',same(freeze,blurred),{blurred,freeze});
      await page.bringToFront();await page.keyboard.up('q');await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});await auxiliary.close();
      await click('resume');await canvasFocus();
      check(mode,'Q失焦回来需恢复且无旋转黏住',!(await snap()).paused&&!(await info()).orbitMode&&same(fabrication(s),fabrication(await snap())),{state:await snap(),scene:await info()});
    });
    await scenario('提锤力度与24px真实阈值',async()=>{
      if((await snap()).paused)await click('resume');
      await click('reheat');await range(60);await canvasFocus();await elapsed(12000);await tick(32);await click('to-anvil');await click('view-close');await click('tool-lift');
      const old=await snap();
      const meter=await lift(0,60,52,'hammer-force');const hit=await snap();
      check(mode,'提60回52meter显示可提交正确力度',!meter.hidden&&meter.ready==='true'&&/松手落锤.*力度55%/.test(meter.label)&&Math.abs(parseFloat(meter.fill)-60/110*100)<.01,meter);
      check(mode,'提60回52真实减薄恰一击',hit.hits===old.hits+1&&Math.abs((old.thick[0]-hit.thick[0])-60/110*4.3)<1e-6&&hit.thick.slice(1).every((v,i)=>v===old.thick[i+1]),{before:old,after:hit,feedback:(await read('feedback')).text});
      await elapsed(180);await tick(32);
      const before23=await snap();const m23=await lift(1,0,23);const after23=await snap();
      check(mode,'下划23px阈值拒绝不加工',m23.ready==='false'&&same(fabrication(before23),fabrication(after23))&&/至少24px/.test((await read('feedback')).text),{meter:m23,before:before23,after:after23,feedback:(await read('feedback')).text});
      await thermalEvidence('砧台');
      const heap=await actualThree(cdp);
      const overlays=await page.evaluate(blade=>{
        const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
        const insideTri=(p,t)=>{const a=cross(t[0],t[1],p),b=cross(t[1],t[2],p),c=cross(t[2],t[0],p);return (a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0);};
        const intersects=(r,t)=>{
          const corners=[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];
          if(t.some(p=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom)||corners.some(p=>insideTri(p,t)))return true;
          for(let i=0;i<3;i++)for(let j=0;j<4;j++){const a=t[i],b=t[(i+1)%3],c=corners[j],d=corners[(j+1)%4];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return true;}
          return false;
        };
        return ['stage-heading','context-hint','heat-hud','state-label','temperature-meter','gesture-meter'].map(id=>{
          const e=document.getElementById(id),r=e.getBoundingClientRect(),texts=[];
          const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node;
          while(node=walker.nextNode()){if(!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const tr of range.getClientRects())if(tr.width&&tr.height)texts.push({text:node.textContent.trim(),left:tr.left,right:tr.right,top:tr.top,bottom:tr.bottom});}
          const collisions=texts.filter(tr=>blade.triangles.some(t=>intersects(tr,t)));
          return {id,text:e.textContent,visible:!!r.width&&!!r.height,overlaps:collisions.length>0,collisions,textRects:texts,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
        });
      },heap.blade);
      check(mode,'加工HUD文本不遮器胚',overlays.every(o=>!o.overlaps),{blade:heap.blade,overlays},['在该尺寸进入锻形、移砧台、器胚特写，对比真实文字Range与真实blade投影三角形（非AABB误报）。']);
      if(mobile)await screenshot('processing',true);
    });
    await scenario('V真实器图Group不影响工艺',async()=>{
      await canvasFocus();const s=await snap(),g0=await actualThree(cdp);
      await page.keyboard.press('v');const g1=await actualThree(cdp),s1=await snap();
      check(mode,'V真实ThreeGroup关闭可见但state-score不变',g0.guideGroup?.isGroup&&g0.guideGroup.visible===true&&g1.guideGroup?.visible===false&&g0.guideGroup.uuid===g1.guideGroup.uuid&&same(s,s1),{before:g0.guideGroup,after:g1.guideGroup,stateBefore:s,stateAfter:s1});
      await page.keyboard.press('v');const g2=await actualThree(cdp);
      check(mode,'V恢复真实Group可见且state-score不变',g2.guideGroup?.visible===true&&same(s,await snap()),{group:g2.guideGroup,state:await snap()});
    });
    await scenario('H净观取消与外部退出',async()=>{
      await click('tool-lift');await page.locator('#world').scrollIntoViewIfNeeded();
      const p=(await page.evaluate(()=>actionForge3D.targets())).sections[2],origin=await snap();
      await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x,p.y-60,{steps:5});await page.mouse.move(p.x,p.y-8,{steps:5});await tick(32);
      await page.keyboard.press('h');
      const cinema=await page.locator('body').evaluate(e=>e.classList.contains('cinema'));
      const canceled=await info();await page.mouse.up();
      check(mode,'H净观有真实可见退出按钮',cinema&&await page.locator('#cinema-peek').isVisible(),await read('cinema-peek'));
      check(mode,'H净观取消已备落锤不误提交',canceled.gesture===null&&same(fabrication(origin),fabrication(await snap())),{before:origin,after:await snap(),scene:canceled});
      await screenshot('cinema');
      const fitted=(await actualThree(cdp)).blade.screen,viewportRect=await page.locator('#world').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
      check(mode,'净观纵横比自适配完整器胚',fitted.left>=viewportRect.left&&fitted.right<=viewportRect.right&&fitted.top>=viewportRect.top&&fitted.bottom<=viewportRect.bottom,{blade:fitted,canvas:viewportRect});
      await page.keyboard.press('Escape');
      check(mode,'Esc恢复净观HUD',!await page.locator('body').evaluate(e=>e.classList.contains('cinema'))&&await page.locator('.panel').isVisible(),{scene:await info()});
      await canvasFocus();await page.keyboard.press('h');
      await page.keyboard.press('h');
      check(mode,'H重复真实切换可退出净观',!await page.locator('body').evaluate(e=>e.classList.contains('cinema')),await read('cinema'));
      // Hidden external controls are activated only through real keyboard shortcuts, never JS onclick.
      await canvasFocus();await page.keyboard.press('h');await page.keyboard.press('l');
      check(mode,'外部炉录能退出净观并暂停',!await page.locator('body').evaluate(e=>e.classList.contains('cinema'))&&(await snap()).paused&&await page.locator('#notes-dialog').evaluate(e=>e.open),{state:await snap()});
      await click('close-notes');await click('resume');
      await canvasFocus();await page.keyboard.press('h');
      // These two checks are normal controls AFTER a real Esc exit, not hidden callbacks.
      await page.keyboard.press('Escape');
      await click('help');check(mode,'Esc退出净观后help正常开手册',!await page.locator('body').evaluate(e=>e.classList.contains('cinema'))&&await page.locator('#manual').evaluate(e=>e.open),{manualOpen:await page.locator('#manual').evaluate(e=>e.open)});
      await click('close-manual');await click('resume');
      await click('reset');check(mode,'净观退出后reset正常询问而不清炉',!await page.locator('body').evaluate(e=>e.classList.contains('cinema'))&&await page.locator('#reset-dialog').evaluate(e=>e.open)&&(await snap()).stage===1,{state:await snap()});
      await firstTouch('cancel-reset',async(a,b)=>b.stage===a.stage&&b.paused&&!await page.locator('#reset-dialog').evaluate(e=>e.open));await click('resume');
      report.limitations.push({mode,type:'hidden-external-help-reset',note:'净观将help/reset display:none且没有键盘映射，真实输入无法触发隐藏控件；已核对源码包装退出，但不把Esc退出后的help/reset当作隐藏外部触发通过。'});
    });
    await scenario('炉录Tab焦点隔离与暂停',async()=>{
      if((await snap()).paused)await click('resume');
      await canvasFocus();await page.keyboard.press('Tab');
      const open=await page.locator('#notes-dialog').evaluate(e=>e.open),pause=await snap();
      check(mode,'canvas焦点Tab开炉录并暂停',open&&pause.paused,{open,state:pause,active:await page.evaluate(()=>document.activeElement.id)});
      await screenshot('notes');await elapsed(1200);
      check(mode,'炉录打开实际冻结温标clock',same(pause,await snap()),{before:pause,after:await snap()});
      const a0=await page.evaluate(()=>document.activeElement.id);await page.keyboard.press('Tab');const a1=await page.evaluate(()=>document.activeElement.id);await page.keyboard.press('Shift+Tab');
      const tabAudit=await page.evaluate(()=>__immersivePassiveAudit.filter(e=>e.type==='keydown'&&e.code==='Tab').slice(-2));
      check(mode,'炉录dialog内Tab正常焦点遍历不拦截',await page.locator('#notes-dialog').evaluate(e=>e.open)&&(await snap()).paused&&tabAudit.every(e=>e.defaultPrevented===false&&e.trusted)&&await page.evaluate(()=>document.activeElement.closest('dialog')?.id==='notes-dialog'),{beforeFocus:a0,afterFocus:a1,returned:await page.evaluate(()=>document.activeElement.id),tabAudit,singleFocusableButton:true});
      await click('close-notes');
      check(mode,'炉录close仍保持暂停',(await snap()).paused&&!await page.locator('#notes-dialog').evaluate(e=>e.open),await snap());
      await page.keyboard.press('p');check(mode,'炉录close后P可恢复',!(await snap()).paused,await snap());
      await click('guides');
      const from=await page.evaluate(()=>document.activeElement.id);await page.keyboard.press('Tab');const to=await page.evaluate(()=>document.activeElement.id);
      check(mode,'普通按钮Tab正常移动不全局劫持',from==='guides'&&to==='cinema'&&!await page.locator('#notes-dialog').evaluate(e=>e.open),{from,to});
      await click('guides');
      await point('#draft');const rp=await point('#draft');await page.mouse.click(rp.x,rp.y);await page.keyboard.press('Tab');
      check(mode,'输入滑杆Tab不打开炉录',!await page.locator('#notes-dialog').evaluate(e=>e.open),{active:await page.evaluate(()=>document.activeElement.id)});
      // Click non-focusable footer text: native browser moves focus to body.
      const footer=await point('.footer');await page.mouse.click(footer.x,footer.y);
      const bodyFocus=await page.evaluate(()=>document.activeElement.tagName);await page.keyboard.press('Tab');
      check(mode,'body焦点Tab开炉录',bodyFocus==='BODY'&&await page.locator('#notes-dialog').evaluate(e=>e.open)&&(await snap()).paused,{bodyFocus,active:await page.evaluate(()=>document.activeElement.id)});
      await click('close-notes');await click('resume');
    });
    await scenario('reducedmotion真实CSS与后续新图标',async()=>{
      const normal=await page.locator('#guides').evaluate(e=>({transition:getComputedStyle(e).transitionDuration,animation:getComputedStyle(e).animationName}));
      await page.emulateMedia({reducedMotion:'reduce'});
      const reduced=await page.locator('#guides').evaluate(e=>({match:matchMedia('(prefers-reduced-motion: reduce)').matches,transition:getComputedStyle(e).transitionDuration,animation:getComputedStyle(e).animationName}));
      check(mode,'停用动画reducedmotion真实CSS有效',normal.transition!=='0s'&&reduced.match&&reduced.transition==='0s'&&reduced.animation==='none',{normal,reduced});
      await page.emulateMedia({reducedMotion:'no-preference'});
      const resumed=await page.locator('#guides').evaluate(e=>getComputedStyle(e).transitionDuration);
      check(mode,'关闭reducedmotion恢复原CSS过渡',resumed===normal.transition,{normal:normal.transition,resumed});
      await firstTouch('pause',(a,b)=>!a.paused&&b.paused&&same(work(a),work(b)));
      await firstTouch('resume',(a,b)=>a.paused&&!b.paused&&same(work(a),work(b)));
      await firstTouch('finish',(a,b)=>a.stage===1&&b.stage===2&&!b.started);
      await firstTouch('next',(a,b)=>a.stage===2&&!a.started&&b.stage===2&&b.started);
      await click('finish');check(mode,'真实保留工艺推进stage2',(await snap()).stage===3,await snap());
      await click('next');await click('finish');check(mode,'真实保留工艺推进stage3',(await snap()).stage===4,await snap());
      await firstTouch('tool-stone',(a,b)=>b.tool==='stone'&&same(fabrication(a),fabrication(b)));
      const stoneIcon=await page.locator('#tool-stone svg path').getAttribute('d');check(mode,'砂石新图标存在',!!stoneIcon,stoneIcon);
      await click('next');await click('finish');
      await firstTouch('tool-pen',(a,b)=>b.tool==='pen'&&same(fabrication(a),fabrication(b)));
      await firstTouch('tool-repair',(a,b)=>b.tool==='repair'&&same(fabrication(a),fabrication(b)));
      const runeIcons=await page.locator('#tool-tray .tool').evaluateAll(es=>es.map(e=>({id:e.id,path:e.querySelector('svg path')?.getAttribute('d')})));
      check(mode,'刻笔修纹新图标存在且不同',runeIcons.length===2&&runeIcons.every(e=>e.path)&&runeIcons[0].path!==runeIcons[1].path,runeIcons);
      await click('next');await click('finish');
      const result=await snap();check(mode,'未加工工艺不被UI按钮补分',result.stage===6&&result.scores.quench===0&&result.scores.temper===0&&result.scores.grind===0&&result.scores.rune===0,result);
      await firstTouch('reset',(a,b)=>a.stage===6&&b.stage===0&&!b.material&&b.hits===0);
      await click('mat-qing');await click('next');await click('next');
      await click('reset');
      await firstTouch('confirm-reset',async(a,b)=>a.stage===1&&b.stage===0&&!b.material&&b.hits===0&&!await page.locator('#reset-dialog').evaluate(e=>e.open));
    });
  } finally {
    const audit=await page.evaluate(()=>window.__immersivePassiveAudit).catch(()=>[]);
    check(mode,'全部输入真实可信无dispatchJS',audit.length>30&&audit.every(e=>e.trusted),{count:audit.length,untrusted:audit.filter(e=>!e.trusted),types:counts(audit.map(e=>({status:e.type+':'+(e.pointerType||'native')})))});
    check(mode,'浏览器无JS错误或联网',localErrors.length===0&&requests.length===0,{errors:localErrors,requests});
    fs.writeFileSync(path.join(OUT,mode+'-input-audit.json'),JSON.stringify(audit,null,2));
    report.errors.push(...localErrors.map(message=>({mode,type:'browser',message})));
    await context.close(); // This script owns this context and browser only.
    fs.writeFileSync(path.join(OUT,'ui-report.json'),JSON.stringify(report,null,2));
  }
}

(async()=>{
  try {
    const args=['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--no-startup-window','--user-data-dir='+path.join(OUT,'edge-ui-owned-profile')];
    browser=await chromium.launch({executablePath:EDGE,headless:true,chromiumSandbox:true,ignoreDefaultArgs:true,args});
    const cdp=await browser.newBrowserCDPSession();
    const system=await cdp.send('SystemInfo.getInfo');
    report.browser={executable:EDGE,playwrightModule:MODULE,version:await cdp.send('Browser.getVersion'),headless:true,chromiumSandbox:true,commandLine:system.commandLine,gpu:system.gpu};
    check('environment','nativeEdgeSandbox无安全绕过',system.gpu.auxAttributes.sandboxed===true&&!/--no-sandbox|--disable-web-security|--enable-unsafe-swiftshader|--unsafely-disable/.test(system.commandLine),{commandLine:system.commandLine,gpuSandboxed:system.gpu.auxAttributes.sandboxed});
    for(const mode of ['desktop','mobile'])await runMode(mode);
  } catch(e) { report.errors.push({type:'fatal-harness',message:e.stack}); }
  finally {
    if(browser)await browser.close();
    report.finishedAt=new Date().toISOString();
    report.protectedFiles=protectedFiles.map(f=>({path:f,before:beforeHashes[f],after:sha(f),unchanged:beforeHashes[f]===sha(f)}));
    check('environment','SourceHTML既有回归脚本未改',report.protectedFiles.every(f=>f.unchanged),report.protectedFiles);
    report.counts=counts(report.cases);report.newNamedAssertions=report.cases.length;
    report.modeCounts=Object.fromEntries(['environment','desktop','mobile'].map(m=>[m,counts(report.cases.filter(c=>c.name.startsWith(m+'.')))]));
    report.failedCases=report.cases.filter(c=>c.status==='fail');
    report.scriptSHA256=sha(__filename);
    report.completed=report.scenarios.length===16&&report.scenarios.every(s=>s.completed)&&!report.errors.some(e=>/harness/.test(e.type));
    fs.writeFileSync(path.join(OUT,'ui-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({report:path.join(OUT,'ui-report.json'),newNamedAssertions:report.newNamedAssertions,counts:report.counts,completed:report.completed,errors:report.errors,failures:report.failedCases.map(c=>c.name),screenshots:report.screenshots.map(s=>s.path)}));
    if(report.counts.fail||!report.completed)process.exitCode=1;
  }
})();
