'use strict';
const fs=require('node:fs'),path=require('node:path');
const {PRODUCT,OUT,EDGE,sha,heapRead,surfaceRead,shaderRead,framebuffer,chromium,pathToFileURL}=require('./startup.cjs');
const mobile=process.argv.includes('--mobile');
const gesturesOnly=process.argv.includes('--gestures-only');
const tag=mobile?'mobile':'desktop';
const report={mode:tag,viewport:mobile?'390x844':'1440x1200',product:PRODUCT,sha256Before:sha(),launchArgs:[],cases:[],errors:[],httpRequests:[],downloads:[],inputAudit:null,blocked:[],screenshots:[],inheritance:{script:'recorded-baseline-145',expectedCases:mobile?72:73,unchangedAssertionNames:true},execution:{headful:false,chromiumSandbox:true,installedRuntimeOnly:true,api:'actionForge3D read-only; no state/scores injection'}};
let browser,context,page,cdp,blurTab,blurTabCDP,inputTime=Date.now()/1000,lastTouch=null,supplemental=false;
const snap=()=>page.evaluate(()=>actionForge3D.snapshot());
const info=()=>page.evaluate(()=>actionForge3D.sceneInfo());
const targets=()=>page.evaluate(()=>actionForge3D.targets());
const pick=p=>page.evaluate(p=>actionForge3D.pick(p.x,p.y),p);
const write=()=>fs.writeFileSync(path.join(OUT,`${tag}${gesturesOnly?'-gestures':''}.json`),JSON.stringify(report,null,2));
function check(name,ok,evidence={}){const c={suite:supplemental?'supplemental':'inherited',name,status:ok?'pass':'fail',evidence};report.cases.push(c);write();console.log(`${tag}: ${c.status.toUpperCase()} ${name}${ok?'':' '+JSON.stringify(evidence).slice(0,700)}`);return ok;}
function extra(name,ok,evidence={}){const prior=supplemental;supplemental=true;try{return check(name,ok,evidence);}finally{supplemental=prior;}}
function notrun(name,cause){report.cases.push({suite:supplemental?'supplemental':'inherited',name,status:'notrun',cause});write();}
async function clock(ms,animation=false){if(animation)await page.clock.runFor(ms);else await page.clock.fastForward(ms);}
async function screenshot(options){
  const request={format:'png',fromSurface:true,captureBeyondViewport:!!options.fullPage};
  if(options.fullPage){const layout=await cdp.send('Page.getLayoutMetrics'),size=layout.cssContentSize;request.clip={x:0,y:0,width:size.width,height:size.height,scale:1};}
  const image=await cdp.send('Page.captureScreenshot',request);fs.writeFileSync(options.path,Buffer.from(image.data,'base64'));
  report.screenshots.push({path:options.path,method:'native CDP Page.captureScreenshot',fullPage:!!options.fullPage});
}
async function visibleCanvas(){await page.locator('#world').scrollIntoViewIfNeeded();}
async function touch(type,p){inputTime=Math.max(inputTime+.020,Date.now()/1000);if(p)lastTouch=p;await cdp.send('Input.dispatchTouchEvent',{type,timestamp:inputTime,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x:p.x,y:p.y,radiusX:3,radiusY:3,force:.5,id:1}]});}
async function down(p){if(mobile)await touch('touchStart',p);else{await page.mouse.move(p.x,p.y);await page.mouse.down();}}
async function move(p,steps=1){if(mobile)await touch('touchMove',p);else await page.mouse.move(p.x,p.y,{steps});}
async function up(p){if(mobile)await touch('touchEnd');else await page.mouse.up();}
async function tap(p){await down(p);await clock(32,true);await up(p);}
async function button(id){
  const l=page.locator(id);await l.scrollIntoViewIfNeeded();const before=await snap(),auditBefore=await page.evaluate(()=>window.__testInputAudit.trusted);
  if(mobile){const b=await l.boundingBox();await tap({x:b.x+b.width/2,y:b.y+b.height/2});}else await l.click();await clock(32,true);
  const after=await snap(),eventCount=(await page.evaluate(()=>window.__testInputAudit.trusted))-auditBefore;
  let ok=true;
  if(id==='#next'&&before.stage<6)ok=before.stage===0?after.stage===1&&!after.started:!before.started?after.stage===before.stage&&after.started:after.stage===before.stage+1&&!after.started;
  if(id==='#finish')ok=after.stage===before.stage+1&&!after.started;
  if(id.startsWith('#tool-'))ok=after.tool===id.slice(6);
  if(id==='#flip')ok=after.face===1-before.face;
  if(id==='#pause')ok=after.paused===!before.paused;
  if(id==='#resume')ok=!after.paused;
  if(id==='#reheat')ok=after.tool==='tongs'&&after.location==='furnace';
  if(id==='#to-anvil')ok=after.tool==='tongs'&&after.location==='anvil';
  if(id==='#mat-qing')ok=after.material==='qing';
  if(id==='#mat-silver')ok=after.silver===!before.silver;
  (report.controlAudit||=[]).push({id,firstAttempt:true,ok,eventCount,before:{stage:before.stage,started:before.started,tool:before.tool,face:before.face,paused:before.paused},after:{stage:after.stage,started:after.started,tool:after.tool,face:after.face,paused:after.paused}});
  if(!ok)check('first control action exactly once '+id,false,report.controlAudit.at(-1));
}
async function nativeRange(id,value){const l=page.locator(id);if(mobile){await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();await tap({x:b.x+b.width/2,y:b.y+b.height/2});}else await l.click();await l.press('Home');for(let i=0;i<value;i++)await l.press('ArrowRight');}
async function section(i){await visibleCanvas();return (await targets()).sections[i];}
const mutated=(a,b)=>a.hits!==b.hits||a.damage!==b.damage||JSON.stringify(a.thick)!==JSON.stringify(b.thick)||JSON.stringify(a.bias)!==JSON.stringify(b.bias);
async function stroke(points,{cancel=false,hold=0}={}){await down(points[0]);for(let i=1;i<points.length;i++){await move(points[i],3);await clock(16,true);}if(hold)await clock(hold,true);if(cancel)await touch('touchCancel');else await up(points[points.length-1]);await clock(16,true);}
async function heat(){const layout=()=>page.evaluate(()=>({inner:[innerWidth,innerHeight],visual:{scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop},focus:document.activeElement?.id,paused:actionForge3D.snapshot().paused}));const steps=[{name:'before',layout:await layout(),snapshot:await snap()}];await button('#reheat');steps.push({name:'after-reheat',layout:await layout(),snapshot:await snap()});await nativeRange('#draft',60);steps.push({name:'after-draft',layout:await layout(),snapshot:await snap()});await clock(12000);const s=await snap();report.heatDiagnostics=steps;await button('#to-anvil');return s;}
async function lift(i,kind){await clock(160);const p=await section(i),a=await snap();await down(p);let end;
  if(kind==='up60recover52'||kind==='up-only'||kind==='up32'){const height=kind==='up32'?32:60;await move({x:p.x,y:p.y-height},8);await clock(48,true);end={x:p.x,y:kind==='up-only'?p.y-60:kind==='up32'?p.y:p.y-8};if(kind!=='up-only')await move(end,8);}
  else{end={x:p.x,y:p.y+(kind==='down24'?24:kind==='down23'?23:60)};await move(end,8);}
  const held=await snap();await up(end);await clock(16,true);const b=await snap(),n=await info();
  return {before:a,heldHits:held.hits,after:b,feedback:n.feedback,delta:a.thick[i]-b.thick[i],point:p};
}
async function gestures(){
  await button('#mat-qing');await button('#next');await button('#tool-tap');let a=await snap();await tap(await section(0));let b=await snap(),n=await info();
  check('before-start tap has explicit feedback and no mutation',!mutated(a,b)&&/尚未开始/.test(n.feedback),{hits:b.hits,feedback:n.feedback});
  await button('#tool-lift');const unstarted=await lift(0,'down60');extra('before-start lift has explicit reason and no thickness bias hits damage changes',!mutated(unstarted.before,unstarted.after)&&/尚未开始/.test(unstarted.feedback),{feedback:unstarted.feedback,hits:unstarted.after.hits});await button('#tool-tap');
  await button('#next');a=await snap();await tap(await section(0));b=await snap();n=await info();
  check('cold tap precheck: thickness bias hits damage unchanged',!mutated(a,b)&&/不在可塑区.*未加工/.test(n.feedback),{temp:b.temp,hits:b.hits,damage:b.damage,feedback:n.feedback});
  await button('#tool-lift');const cold=await lift(0,'down60');check('cold lift has warning and no mutation',!mutated(cold.before,cold.after)&&/未加工/.test(cold.feedback),{feedback:cold.feedback,hits:cold.after.hits});
  const heated=await heat();if(!check('reheat auto tongs/furnace + native draft60 + clock12s',heated.location==='furnace'&&heated.tool==='tongs'&&heated.draft===.6&&Math.abs(heated.temp-70)<1,{temp:heated.temp,tool:heated.tool,location:heated.location,draft:heated.draft})){report.blocked.push('heat UI prerequisite failed');notrun('warm gestures and fullgoodpath','heat UI prerequisite failed');return false;}
  n=await info();check('to-anvil switches to true close view',(await snap()).location==='anvil'&&n.view==='close',{view:n.view});
  await button('#tool-tap');const p=await section(0);const picked=await pick(p);const frontProbe=await surfaceRead(cdp,{screenPoints:(await targets()).sections});
  check('front winding outward + true section targets hit actual top .13',frontProbe.normals.upperPositive>=24&&frontProbe.normals.upperNegative===0&&frontProbe.normals.lowerNegative>=24&&frontProbe.rays.every(r=>r&&Math.abs(r.local[1]-.13)<.003&&r.worldNormal[1]>0),frontProbe);
  a=await snap();const oldMesh=await heapRead(cdp);await down(p);n=await info();await clock(80,true);const head1=await heapRead(cdp);await screenshot({path:path.join(OUT,`${tag}-hammer.png`),fullPage:!mobile});await clock(112,true);const head2=await heapRead(cdp);await up(p);b=await snap();
  check('tap actual section0 precisely picked; .25 power reduces 1.075',picked?.section===0&&b.hits===a.hits+1&&Math.abs(a.thick[0]-b.thick[0]-1.075)<1e-8&&b.thick.slice(1).every((v,i)=>v===a.thick[i+1]),{pick:picked,delta:a.thick[0]-b.thick[0],hits:b.hits-a.hits});
  const h1=head1.head,h2=head2.head,motion=Math.hypot(...h1.world.map((v,i)=>v-h2.world[i])),pixelMotion=Math.abs(h1.screen.top-h2.screen.top);
  const canvasBox=await page.locator('#world').boundingBox();
  check('hammer actual head visible + animation motion + actual blade mesh deformed',n.hammerAnimating&&h1.visible&&h2.visible&&motion>.1&&pixelMotion>3&&h1.vertices===24&&head1.blade.vertices===150&&oldMesh.blade.vertexSum!==head1.blade.vertexSum&&h1.screen.bottom>canvasBox.y&&h1.screen.top<canvasBox.y+canvasBox.height,{scene:n,head1:h1,head2:h2,motion,pixelMotion,meshCount:head1.actualMeshCount,bladeVertexSums:[oldMesh.blade.vertexSum,head1.blade.vertexSum]});
  await button('#tool-lift');let r=await lift(1,'up60recover52');check('lift up60 recovery52 release8 above anchor -> exactly one hit',r.heldHits===r.before.hits&&r.after.hits===r.before.hits+1&&Math.abs(r.delta-60/110*4.3)<1e-7,{delta:r.delta,feedback:r.feedback,hits:r.after.hits-r.before.hits});
  r=await lift(2,'down60');check('lift only-down60 release -> exactly one hit',r.heldHits===r.before.hits&&r.after.hits===r.before.hits+1,{delta:r.delta,feedback:r.feedback});
  r=await lift(2,'up32');check('lift up32 down32 release -> exactly one hit',r.heldHits===r.before.hits&&r.after.hits===r.before.hits+1&&Math.abs(r.delta-32/110*4.3)<1e-7,{delta:r.delta,feedback:r.feedback});
  r=await lift(3,'down24');check('lift only-down24 threshold inclusive -> one hit',r.after.hits===r.before.hits+1,{delta:r.delta,feedback:r.feedback});
  r=await lift(3,'down23');check('lift only-down23 rejected with reason',!mutated(r.before,r.after)&&/没有形成下砸/.test(r.feedback),{feedback:r.feedback});
  r=await lift(3,'up-only');check('upward-only rejected with clear reason',!mutated(r.before,r.after)&&/没有形成下砸/.test(r.feedback),{feedback:r.feedback});
  // Genuine CDP touchCancel is used even on the desktop mouse suite, never synthetic JS events.
  await clock(160);const cp=await section(4);a=await snap();await touch('touchStart',cp);await touch('touchMove',{x:cp.x,y:cp.y+60});await touch('touchCancel');await clock(32,true);b=await snap();n=await info();check('real pointercancel clears gesture without hit',!mutated(a,b)&&n.gesture===null&&/取消/.test(n.feedback),{feedback:n.feedback,gesture:n.gesture});
  if(!mobile){a=await snap();await page.mouse.click(cp.x,cp.y,{button:'right'});b=await snap();check('right click does not hit',!mutated(a,b),{hits:b.hits});}
  await clock(160);const op=await section(5),box=await page.locator('#world').boundingBox();a=await snap();await down(op);await move({x:op.x,y:op.y+60},8);await move({x:box.x-8,y:op.y+60},8);const outsideHeld=await snap();await up({x:box.x-8,y:op.y+60});await clock(16,true);b=await snap();n=await info();check('release outside canvas with captured valid travel safely commits one locked hit',outsideHeld.hits===a.hits&&b.hits===a.hits+1&&n.gesture===null&&b.thick.slice(0,5).every((v,i)=>v===a.thick[i]),{hits:b.hits-a.hits,delta:a.thick[5]-b.thick[5],feedback:n.feedback});
  await button('#tool-tap');await clock(160);const bp=await section(2);a=await snap();const errorsBefore=report.errors.length;await down(bp);await move({x:bp.x+12,y:bp.y+8},3);await move(bp,3);await up(bp);b=await snap();check('tap dragged after pointerdown remains one gesture one hit',b.hits===a.hits+1,{hits:b.hits-a.hits});check('tap spent gesture pointermove must not throw',report.errors.length===errorsBefore,{newErrors:report.errors.slice(errorsBefore)});
  for(const view of ['#view-wide','#view-close']){await button(view);await clock(160);const q=await section(2),pck=await pick(q);a=await snap();await tap(q);b=await snap();check(`${view.slice(1)} actual section maps correctly`,pck?.section===2&&b.hits===a.hits+1&&b.thick.every((v,i)=>i===2||v===a.thick[i]),{point:q,pick:pck,view:(await info()).view});}
  await button('#view-orbit');await visibleCanvas();const t=await targets();a=await snap();const cameraBefore=(await heapRead(cdp)).camera;await stroke([t.bladeCenter,{x:t.bladeCenter.x+45,y:t.bladeCenter.y+18}]);const cameraAfter=(await heapRead(cdp)).camera;await screenshot({path:path.join(OUT,`${tag}-camera-orbit.png`),fullPage:!mobile});b=await snap();check('rotate uses real perspective camera and does not forge',JSON.stringify(cameraBefore.position)!==JSON.stringify(cameraAfter.position)&&!mutated(a,b),{before:cameraBefore.position,after:cameraAfter.position});await button('#view-orbit');await clock(160);const rq=await section(3),rp=await pick(rq);a=await snap();await tap(rq);b=await snap();check('rotated camera actual section ray mapping',rp?.section===3&&b.hits===a.hits+1&&b.thick.every((v,i)=>i===3||v===a.thick[i]),{point:rq,pick:rp});
  await visibleCanvas();const bb=await page.locator('#world').boundingBox(),background={x:bb.x+bb.width*.88,y:bb.y+bb.height*.20};a=await snap();await tap(background);b=await snap();n=await info();check('non-blade background no phantom floor hit',!mutated(a,b)&&/落点不在剑胚表面/.test(n.feedback),{pick:await pick(background),feedback:n.feedback});
  await button('#view-wide');await visibleCanvas();const center=(await targets()).bladeCenter;await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,450);await clock(32,true);const shrunk=await targets();const mappings=[];for(let i=0;i<6;i++)mappings.push(await pick(shrunk.sections[i]));await clock(160);a=await snap();await tap(shrunk.sections[4]);b=await snap();check('zoom-shrunk target tolerance never maps centers to another section',mappings.every((p,i)=>p?.section===i)&&b.hits===a.hits+1&&b.thick.every((v,i)=>i===4||v===a.thick[i]),{picks:mappings,points:shrunk.sections});
  await button('#view-close');await button('#flip');await clock(160);const back=await section(1),backPick=await pick(back);const backProbe=await surfaceRead(cdp,{screenPoints:(await targets()).sections});
  check('flipped actual underside -.1 returns visible world top with outward normals',backProbe.rays.every(r=>r&&Math.abs(r.local[1]+.1)<.003&&r.normal[1]<0&&r.worldNormal[1]>0),{rays:backProbe.rays});
  await screenshot({path:path.join(OUT,`${tag}-framePBR-close.png`),fullPage:!mobile});a=await snap();await tap(back);b=await snap();check('back face top-visible actualpick and strike correct section',backPick?.section===1&&b.hits===a.hits+1&&b.bias[1]<a.bias[1],{pick:backPick,face:b.face,delta:a.thick[1]-b.thick[1]});
  await button('#tool-lift');await clock(160);const lock=await section(0);a=await snap();await down(lock);const dest=await targets();await move({x:dest.sections[5].x,y:lock.y+60},8);await up({x:dest.sections[5].x,y:lock.y+60});b=await snap();check('lift pointerdown locks section despite lateral release',b.hits===a.hits+1&&b.thick.every((v,i)=>i===0||v===a.thick[i]),{hits:b.hits-a.hits,delta:a.thick[0]-b.thick[0]});
  await button('#tool-tap');await clock(160);const cool=await section(5);await tap(cool);const one=await snap();await tap(cool);const two=await snap();check('core cooldown rejects too-close second tap',one.hits===two.hits,{clockDelta:two.clock-one.clock,feedback:(await info()).feedback});await clock(160);await tap(cool);const three=await snap();check('clock >= .12s permits next hit',three.hits===two.hits+1,{clockDelta:three.clock-two.clock});
  for(const control of ['#tool-tap','#tool-lift','#tool-tongs','#view-wide','#view-close','#pause']){
    await button('#view-orbit');const orbitBefore=(await info()).orbitMode;await button(control);const state=await info();
    check(control+' exits orbit on first native action',orbitBefore&&state.orbitMode===false,{orbitBefore,orbitAfter:state.orbitMode});
    if(control==='#pause'){const frozen=await snap();await clock(1000);const held=await snap();check('pause freezes clock heat and work',held.clock===frozen.clock&&held.temp===frozen.temp&&!mutated(frozen,held),{before:frozen.clock,after:held.clock});await button('#resume');}
  }
  await button('#tool-tap');await clock(160);a=await snap();await tap(await section(3));b=await snap();check('tool/view/pause orbit exit does not intercept next machining',b.hits===a.hits+1,{hits:b.hits-a.hits,feedback:(await info()).feedback});
  const touchReady=await page.evaluate(()=>Array.from(document.querySelectorAll('button')).filter(b=>typeof b.onclick==='function').map(b=>({id:b.id,ready:b.dataset.touchReady==='1'})));
  check('every static and current dynamic onclick button has touch adapter',touchReady.every(b=>b.ready),{buttons:touchReady});
  const wrong=await page.evaluate(()=>{const xs=[[NaN,NaN],[Infinity,-Infinity],[undefined,undefined],['x',null],[-1e6,-1e6]];return xs.map(([x,y])=>{try{return {result:actionForge3D.pick(x,y)};}catch(e){return {error:e.message};}});});check('readonly wronginput pick does not throw JS error',wrong.every(v=>!v.error),{results:wrong});
}
async function adaptiveForge(){
  await button('#view-close');let s=await snap();if(s.face)await button('#flip');await button('#tool-tap');const goals=[21,20,19,17,14,8],hitLog=[];
  for(let i=0;i<6;i++){
    for(let guard=0;guard<20;guard++){
      s=await snap();const gap=s.thick[i]-goals[i];if(gap<=.65)break;
      if(s.temp<s.band[0]+1){await heat();await button('#tool-tap');}
      s=await snap();const face=s.bias[i]>=0?1:0;if(s.face!==face)await button('#flip');
      const power=gap>3.3?.5:.25;await button(power===.5?'#tool-lift':'#tool-tap');await clock(160);const p=await section(i),before=await snap();
      if(power===.5)await stroke([p,{x:p.x,y:p.y-55},{x:p.x,y:p.y}]);else await tap(p);
      const after=await snap();hitLog.push({section:i,power,face:after.face,delta:before.thick[i]-after.thick[i],hit:after.hits-before.hits});
      if(after.hits!==before.hits+1){report.blocked.push('adaptive forge input not accepted');return check('adaptive real forge shapeReady',false,{last:hitLog.at(-1),feedback:(await info()).feedback});}
    }
  }
  s=await snap();report.forgeHitLog=hitLog;return check('adaptive real forge thickness +/-2.5 and bias flip -> shapeReady',s.shapeReady&&s.ready&&s.thick.every((v,i)=>Math.abs(v-goals[i])<=2.5)&&s.bias.every(v=>Math.abs(v)<=2.6),{thick:s.thick,bias:s.bias,hits:s.hits,damage:s.damage,shape:s.shape});
}
async function carryTo(station){
  await button('#view-wide');await visibleCanvas();const t=await targets();await down(t.grip);let s=await snap();const captured=s.carrying;const destination=t[station];await move(destination,20);await clock(160);const held=await snap();await up(destination);await clock(32,true);const released=await snap();
  return {captured,held:{location:held.location,carrying:held.carrying,quenchStart:held.quenchStart,quenchWet:held.quenchWet},released,point:{grip:t.grip,destination}};
}
async function nearAirNoWork(stage){
  await visibleCanvas();const base=(await targets()).edges[0][24],candidates=[];
  for(const dy of [-9,-7,-5,-3,3,5,7,9])for(const dx of [-2,0,2])candidates.push({x:base.x+dx,y:base.y+dy});
  const rays=(await surfaceRead(cdp,{screenPoints:candidates})).rays;let point=null;
  for(let i=0;i<candidates.length;i++)if(!rays[i]){const p=await pick(candidates[i]);if(p&&!p.direct){point=candidates[i];break;}}
  if(!point)throw Error('test fixture needs near-edge air point');
  const end={x:point.x+1,y:point.y};const pair=await surfaceRead(cdp,{screenPoints:[point,end]});if(pair.rays.some(Boolean))throw Error('test fixture air substep crosses real blade');
  const before=await snap();await stroke([point,end]);const after=await snap();
  check('stage'+stage+' soft-edge air does not fake mesh or plane machining',JSON.stringify(before.grindCells)===JSON.stringify(after.grindCells)&&before.runeSegment===after.runeSegment&&before.runeFraction===after.runeFraction&&JSON.stringify(before.scars)===JSON.stringify(after.scars),{point,end,rays:pair.rays,hammerSoftPick:await pick(point),gesture:(await info()).gesture});
}
function workState(s){const {paused,clock,carrying,...work}=s;return work;}
async function lifecycle(stage){
  await visibleCanvas();
  const tool=stage===1?'lift':stage<4?'tongs':stage===4?'stone':'pen';
  await button('#tool-'+tool);await visibleCanvas();
  let p;
  if(stage===4)p=(await surfaceRead(cdp,{kind:'edge',side:0,count:97})).points[24];
  else if(stage===5){const s=await snap();p=(await surfaceRead(cdp,{kind:'rune',segment:s.runeSegment,from:s.runeFraction,to:1,count:61})).points[0];}
  else p=(await targets())[stage===1?'sections':'grip'];
  if(stage===1)p=p[4];
  const origin=await snap();await down(p);
  const end=stage===1?{x:p.x,y:p.y+60}:stage<4?{x:p.x+18,y:p.y-12}:p;
  if(stage<4)await move(end,4);
  const armed=await info();const auditBefore=await page.evaluate(()=>window.__testLifecycleAudit.length);
  await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:false});await page.bringToFront();
  const blurEvent=page.waitForEvent('console',{predicate:m=>m.text()==='REGRESSION_TRUSTED_NATIVE_BLUR',timeout:5000});
  await blurTab.bringToFront();await blurEvent;
  const blurred=await snap(),blurInfo=await info();const events=await page.evaluate(n=>window.__testLifecycleAudit.slice(n),auditBefore);
  extra('stage'+stage+' trusted native blur cancels pending '+armed.gesture+' without work',blurred.paused&&blurInfo.gesture===null&&!blurred.carrying&&JSON.stringify(workState(origin))===JSON.stringify(workState(blurred))&&events.some(e=>e.type==='blur'&&e.trusted),{origin,blurred,armed:armed.gesture,events,gesture:blurInfo.gesture});
  await clock(1000,true);const frozen=await snap();
  extra('stage'+stage+' blur freezes all heat work coverage and clock',JSON.stringify(frozen)===JSON.stringify(blurred),{before:blurred,after:frozen});
  await page.bringToFront();await up(end);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const returned=await snap();
  extra('stage'+stage+' refocus remains paused until one resume action',returned.paused&&returned.hits===origin.hits&&JSON.stringify(workState(returned))===JSON.stringify(workState(blurred)),{paused:returned.paused,hits:returned.hits});
  await button('#resume');const resumed=await snap();
  extra('stage'+stage+' first native resume restores operation only once',!resumed.paused&&resumed.stage===stage&&resumed.hits===origin.hits,{stage:resumed.stage,paused:resumed.paused,hits:resumed.hits});
  await button('#pause');const paused=await snap();
  const overlay=await page.locator('#paused').evaluate(e=>{const c=getComputedStyle(e),canvas=document.querySelector('#world'),b=canvas.getBoundingClientRect();return {hidden:e.hidden,opacity:c.opacity,background:c.backgroundColor,display:c.display,canvasOpacity:getComputedStyle(canvas).opacity,canvasWidth:b.width,canvasHeight:b.height};});
  const gl=await framebuffer(page);await clock(1000,true);const after=await snap();
  const alpha=/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(overlay.background);
  extra('stage'+stage+' pause overlay preserves visible nonblank native GL with translucent opacity',!overlay.hidden&&Number(overlay.opacity)>0&&Number(overlay.canvasOpacity)>0&&(!alpha||Number(alpha[1])<1)&&gl.colors>100&&gl.glError===0&&JSON.stringify(paused)===JSON.stringify(after),{overlay,framebuffer:gl,clockBefore:paused.clock,clockAfter:after.clock});
  await button('#resume');
}
async function resizeProof(label,hit=false){
  await visibleCanvas();const before=await snap(),old=await heapRead(cdp);
  const size=mobile?{width:412,height:915}:{width:1180,height:940};
  await page.setViewportSize(size);await clock(48,true);await visibleCanvas();
  const mesh=await heapRead(cdp),t=await targets(),r=await page.locator('#world').boundingBox(),picks=[];
  for(const p of t.sections)picks.push(await pick(p));
  const gl=await framebuffer(page);
  extra(label+' resize rebuilds real perspective projection and preserves processing state',!mutated(before,await snap())&&picks.every((v,i)=>v?.section===i)&&gl.colors>100&&gl.glError===0&&r.width>0&&r.height>0&&JSON.stringify(old.camera.projection)!==JSON.stringify(mesh.camera.projection),{size,canvas:r,camera:mesh.camera,picks,framebuffer:gl});
  if(hit){await button('#tool-tap');await clock(160);const p=await section(4),a=await snap();await tap(p);const b=await snap();extra(label+' resized true target first tap gives one hit',b.hits===a.hits+1&&b.thick.every((v,i)=>i===4||v===a.thick[i]),{hits:b.hits-a.hits,delta:a.thick[4]-b.thick[4]});}
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1200});await clock(48,true);await visibleCanvas();
}
async function stationaryGrind(){
  await visibleCanvas();const point=(await surfaceRead(cdp,{kind:'edge',side:0,count:97})).points[24];
  const a=await snap();await down(point);await clock(1000,true);await up(point);const b=await snap();
  extra('stage4 stationary contact hold is not fake fine grinding progress',JSON.stringify(a.grindCells)===JSON.stringify(b.grindCells)&&JSON.stringify(a.grind)===JSON.stringify(b.grind),{point,before:a.grind,after:b.grind});
  await down(point);for(let j=0;j<10;j++)await move({x:point.x+(j%2?.1:-.1),y:point.y});await up(point);const c=await snap();
  extra('stage4 subpixel same point jitter cannot fill fine grind cells',JSON.stringify(b.grindCells)===JSON.stringify(c.grindCells),{before:b.grind,after:c.grind});
}
async function sampleFrames(){
  const performanceContext=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1200},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:true});
  const measurement=await performanceContext.newPage(),d=await performanceContext.newCDPSession(measurement);
  measurement.on('request',r=>{if(/^https?:/.test(r.url()))report.httpRequests.push(r.url());});
  measurement.on('pageerror',e=>report.errors.push({type:'performance-pageerror',message:e.message}));
  measurement.on('console',m=>{if(m.type()==='error')report.errors.push({type:'performance-console',message:m.text()});});
  try{
    await measurement.goto(pathToFileURL(PRODUCT).href,{waitUntil:'load'});
    const samples=await measurement.evaluate(async()=>{const a=[];let previous;for(let i=0;i<21;i++){const t=await new Promise(resolve=>requestAnimationFrame(resolve));if(previous!==undefined)a.push(t-previous);previous=t;}return a;});
    const sh=await shaderRead(d),scene=await measurement.evaluate(()=>actionForge3D.sceneInfo()),gl=await framebuffer(measurement);
    report.performance={sampleKind:'native unclocked requestAnimationFrame in separate untouched initial-scene UI; short sample only, not sustained or hard FPS',sampleFrames:samples.length,maxFrameMs:Math.max(...samples),minFrameMs:Math.min(...samples),meanFrameMs:samples.reduce((a,b)=>a+b,0)/samples.length,frameIntervalsMs:samples,actualDrawCalls:sh.calls,actualTriangles:sh.triangles,debugDrawCalls:scene.drawCalls,framebuffer:gl,valid:samples.length===20&&samples.every(n=>Number.isFinite(n)&&n>0)&&sh.calls>0&&sh.triangles>0&&scene.drawCalls===sh.calls&&sh.glError===0};
  }finally{await performanceContext.close();}
}
async function goodpath(){  await lifecycle(1);await resizeProof('stage1',true);
  if(!await adaptiveForge()){notrun('stage2-6 full goodpath','shapeReady blocked');return;}
  await button('#next');let s=await snap();check('stage2 entered via actual advance UI',s.stage===2&&!s.started,{stage:s.stage});await button('#next');await button('#reheat');await nativeRange('#draft',60);await clock(12000);s=await snap();report.quenchPreheat=s.temp;await lifecycle(2);
  const carry=await carryTo('pool');check('stage2 actual grip->pool: only release commits',carry.captured&&carry.held.carrying&&carry.held.location==='furnace'&&carry.held.quenchStart===null&&carry.released.location==='pool'&&!carry.released.carrying,{captured:carry.captured,held:carry.held,released:{location:carry.released.location,quenchStart:carry.released.quenchStart,submersion:carry.released.submersion},point:carry.point});
  if(carry.released.location!=='pool'){report.blocked.push('pool carry blocked');notrun('stage2-6 full goodpath','pool carry blocked');return;}
  await nativeRange('#depth',50);await visibleCanvas();const shallow=await surfaceRead(cdp,{screenPoints:[(await targets()).bladeCenter]});const shallowBefore=await snap();await clock(1000);const shallowAfter=await snap();
  check('half immersion real root above water tip below + only covered segments cool',shallow.pool.waterY===.91&&shallow.pool.rootTop>.91&&shallow.pool.tipTop<.91&&!shallow.pool.allBelow&&shallowAfter.quenchWet.slice(0,3).every((v,i)=>v===shallowBefore.quenchWet[i])&&shallowAfter.quenchWet.slice(3).every((v,i)=>v>shallowBefore.quenchWet[i+3]),{geometry:shallow.pool,wetBefore:shallowBefore.quenchWet,wet:shallowAfter.quenchWet,beforeTemps:shallowBefore.quenchTemp,afterTemps:shallowAfter.quenchTemp});
  await screenshot({path:path.join(OUT,`${tag}-pool-half.png`),fullPage:!mobile});await nativeRange('#depth',100);await visibleCanvas();const fullPool=await surfaceRead(cdp,{screenPoints:[(await targets()).bladeCenter]});
  check('full immersion every real blade vertex under .91 transparent water and actual ray to blade',fullPool.pool.allBelow&&fullPool.pool.belowCount===150&&fullPool.pool.transparent&&fullPool.pool.opacity>0&&fullPool.pool.opacity<1&&fullPool.rays[0]!==null,{pool:fullPool.pool,rays:fullPool.rays});
  await clock(10000);s=await snap();if(!check('stage2 clock10s full wet/cold ready',s.quenchDone&&s.quenchWet.every(v=>v>=.9)&&s.quenchTemp.every(v=>v<=32),{quenchWet:s.quenchWet,quenchTemp:s.quenchTemp,ready:s.ready})){notrun('stage3-6 full goodpath','quench not ready');return;}
  await button('#next');await button('#next');await nativeRange('#draft',40);const furnace=await carryTo('furnace');check('stage3 actual tongs -> furnace release',furnace.released.location==='furnace',{location:furnace.released.location});await clock(12000);await button('#flip');await clock(4000);s=await snap();if(!check('stage3 draft40 clock12 + flip4s both faces tempered',s.stage===3&&s.ready&&Math.min(...s.temper)>=2.8&&s.damage===0,{temp:s.temp,temper:s.temper,damage:s.damage})){notrun('stage4-6 full goodpath','temper not ready');return;}await lifecycle(3);
  await button('#next');await button('#next');await button('#view-close');await visibleCanvas();let edgeTargets=await targets();const edgePick=[];for(let side=0;side<2;side++)for(let i=1;i<73;i+=6)edgePick.push({side,index:i,pick:await pick(edgeTargets.edges[side][i])});report.edgeSurfacePicks=edgePick;
  airdraw: {const bb=await page.locator('#world').boundingBox(),a=await snap();await stroke([{x:bb.x+bb.width*.10,y:bb.y+bb.height*.18},{x:bb.x+bb.width*.30,y:bb.y+bb.height*.18}]);const b=await snap();check('stage4 distant air drag does not grind',JSON.stringify(a.grindCells)===JSON.stringify(b.grindCells),{before:a.grind,after:b.grind});}
  await nearAirNoWork(4);await stationaryGrind();await lifecycle(4);await resizeProof('stage4');
  for(let pass=0;pass<4;pass++){for(let side=0;side<2;side++){await visibleCanvas();const probe=await surfaceRead(cdp,{kind:'edge',side,count:97});if(probe.points.some(p=>!p||!p.hit))throw Error('test fixture edge projection has no direct mesh ray');(report.grindSurfaceProof||=[]).push({side,pass,first:probe.points[0],last:probe.points.at(-1),maxLocalError:Math.max(...probe.points.map(p=>Math.hypot(...p.expected.map((v,i)=>v-p.hit.local[i]))))});await stroke(pass%2?[...probe.points].reverse():probe.points);}s=await snap();report.grindSweeps=pass+1;if(s.ready)break;}
  await screenshot({path:path.join(OUT,`${tag}-grind.png`),fullPage:!mobile});s=await snap();report.grindOutcome={grind:s.grind,grindCells:s.grindCells};
  if(!check('stage4 actual ray-surface strokes fit every segment/cell',s.ready&&s.grind.flat().every(v=>v>=.95),{sweeps:report.grindSweeps,grind:s.grind,unfit:s.grindCells.flat(2).filter(v=>v<.95).length,surfaceDirect:edgePick.filter(p=>p.pick?.direct).length,surfaceSamples:edgePick.length})){report.blocked.push('true-surface grinding cannot fit cells');notrun('stage5-6 normal high-quality flow','grind ready blocked');return;}await button('#next');
  await button('#next');await button('#view-close');await button('#tool-repair');await button('#tool-pen');await nearAirNoWork(5);await visibleCanvas();let ts=await targets(),before=await snap();await tap(ts.runes[6]);s=await snap();check('stage5 endpoint tap cannot skip rune path',s.runeSegment===before.runeSegment&&s.runeFraction===before.runeFraction,{segment:s.runeSegment,fraction:s.runeFraction});
  const runeSegments=[];
  await visibleCanvas();const firstPartial=await surfaceRead(cdp,{kind:'rune',segment:0,from:0,to:.92,count:61});await stroke(firstPartial.points);s=await snap();report.firstRunePartial={segment:s.runeSegment,fraction:s.runeFraction,scars:s.scars};
  check('first rune deliberate 92 percent partial remains resumable without scars',s.runeSegment===0&&Math.abs(s.runeFraction-.92)<.015&&s.scars.every(v=>v===0),report.firstRunePartial);
  await lifecycle(5);await resizeProof('stage5');
  for(let i=0;i<6;i++){
    await visibleCanvas();const prior=await snap();if(prior.runeSegment!==i){report.blocked.push('unexpected rune segment before real trace '+i);break;}
    const probe=await surfaceRead(cdp,{kind:'rune',segment:i,from:Math.max(0,prior.runeFraction-.005),to:1,count:61});
    if(probe.points.some(p=>!p||!p.hit))throw Error('test fixture rune projection has no direct mesh ray');
    const proof={piece:i,from:probe.points[0],to:probe.points.at(-1),maxLocalError:Math.max(...probe.points.map(p=>Math.hypot(...p.expected.map((v,j)=>v-p.hit.local[j])))),before:{segment:prior.runeSegment,fraction:prior.runeFraction}};
    // Mouse is positioned while up; substeps follow fresh, real mesh projections, never stale elevated UI nodes.
    await stroke(probe.points);s=await snap();proof.after={segment:s.runeSegment,fraction:s.runeFraction};proof.scars=s.scars;runeSegments.push(proof);
    check('rune segment '+(i+1)+' true ray coordinates completed by native input',s.runeSegment===i+1&&s.scars.every(v=>v===0),proof);
    if(i===0)await screenshot({path:path.join(OUT,`${tag}-rune-first-resumed.png`),fullPage:!mobile});
    if(s.runeSegment<=i){report.blocked.push('actual mesh rune route did not complete piece '+i);break;}
  }
  report.runeSegments=runeSegments;report.runeMeshProbe=await heapRead(cdp);s=await snap();await screenshot({path:path.join(OUT,`${tag}-rune.png`),fullPage:!mobile});const runeOK=check('stage5 all six real segments complete without scars; no force finish',s.ready&&s.runeSegment===6&&s.scars.every(v=>v===0),{segment:s.runeSegment,fraction:s.runeFraction,scars:s.scars});if(!runeOK){notrun('stage6 full high-quality normal advance','rune ready blocked');return;}await button('#next');
  s=await snap();report.result=s.result;await visibleCanvas();await screenshot({path:path.join(OUT,`${tag}-finish.png`),fullPage:!mobile});await screenshot({path:path.join(OUT,`${tag}-result.png`),fullPage:true});check('actual result full good score and no flaws',s.stage===6&&s.result?.quality>=90&&Object.values(s.result.scores).every(v=>v>=90)&&s.result.flaws.length===0,{result:s.result});
  const finishInstruction=await page.locator('#instruction').innerText();check('stage6 finished product instruction must not ask to start processing',!/开始本步|未开始/.test(finishInstruction)&&/成品|旋转|查看/.test(finishInstruction),{stage:s.stage,started:s.started,instruction:finishInstruction,screenshot:path.join(OUT,`${tag}-finish.png`)});
  const finalFeedback=(await info()).feedback;extra('stage6 normal completion feedback is 本炉完成, not 开始本步',/本炉完成/.test(finalFeedback)&&!/开始本步|未开始/.test(finalFeedback),{feedback:finalFeedback});
  report.highResultScene={debug:await info(),actual:await shaderRead(cdp),heap:await heapRead(cdp),framebuffer:await framebuffer(page)};await resizeProof('finished stage6');
  // v0.4 export metadata is the only migrated assertion contract; retain the inherited case name and score/quality equality checks.
  const downloadPromise=page.waitForEvent('download');await button('#export');const d=await downloadPromise;const file=path.join(OUT,`${tag}-actual-ui-export.json`);await d.saveAs(file);report.downloads.push({suggested:d.suggestedFilename(),path:file});const exported=JSON.parse(fs.readFileSync(file));check('actual UI export once equals result + v0.3 rendering',exported.version==='web-0.4'&&exported.rendering==='WebGL 3D original ink-bronze immersive workshop'&&JSON.stringify(exported.scores)===JSON.stringify(s.result.scores)&&exported.quality===s.result.quality,{path:file,version:exported.version,rendering:exported.rendering,quality:exported.quality,contractMigration:{from:{version:'web-0.3',rendering:'WebGL 3D procedural PBR workshop'},to:{version:'web-0.4',rendering:'WebGL 3D original ink-bronze immersive workshop'},unchanged:'case name, exact scores equality, exact quality equality'}});
}
async function lowpath(){
  await button('#reset');if((await snap()).stage!==0)await button('#confirm-reset');await button('#mat-qing');await button('#next');
  for(let i=1;i<=5;i++){await button('#next');await button('#finish');}let s=await snap();report.skippedResult=s.result;
  check('finish-skipped stages retain low scores and unique low flags',s.stage===6&&s.result.grade==='瑕品'&&s.result.quality<=49&&s.result.scores.quench===0&&s.result.scores.temper===0&&s.result.scores.grind===0&&s.result.scores.rune===0&&s.result.flaws.length>=4,{result:s.result});
  await button('#reset');await button('#mat-qing');await button('#next');await button('#next');await heat();await button('#tool-tap');await clock(160);await tap(await section(0));await button('#finish');
  await button('#next');await button('#reheat');await nativeRange('#draft',60);await clock(12000);await carryTo('pool');await nativeRange('#depth',33);await clock(1000);await button('#finish');
  await button('#next');await nativeRange('#draft',40);await carryTo('furnace');await clock(6000);await button('#finish');
  await button('#next');await button('#view-close');await visibleCanvas();const edge=await surfaceRead(cdp,{kind:'edge',side:0,count:97});await stroke(edge.points.slice(0,12));await button('#finish');
  await button('#next');await button('#view-close');await visibleCanvas();const partial=await surfaceRead(cdp,{kind:'rune',segment:0,from:0,to:.35,count:31});await stroke(partial.points);const unfinished=await snap();await button('#finish');s=await snap();report.lowPartial={unfinishedRune:{segment:unfinished.runeSegment,fraction:unfinished.runeFraction},result:s.result};
  check('actual partial work forced finish preserves low scores and flaws; not auto-completed',s.stage===6&&s.result.grade==='瑕品'&&s.result.quality<=49&&Object.values(s.result.scores).every(v=>v>0&&v<70)&&s.result.flaws.length>=4&&unfinished.runeSegment===0&&unfinished.runeFraction>.2&&unfinished.runeFraction<.5,report.lowPartial);
  await screenshot({path:path.join(OUT,`${tag}-low-partial.png`),fullPage:true});
}
async function main(){try{
  report.launchArgs=['--headless=new','--remote-debugging-pipe','--no-first-run','--no-default-browser-check','--no-startup-window','--user-data-dir='+path.join(OUT,'edge-native-final-'+tag)];
  browser=await chromium.launch({executablePath:EDGE,headless:true,chromiumSandbox:true,ignoreDefaultArgs:true,args:report.launchArgs});context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1200},deviceScaleFactor:mobile?2:1,hasTouch:true,isMobile:mobile,acceptDownloads:true});page=await context.newPage();cdp=await context.newCDPSession(page);page.setDefaultTimeout(10000);
  const browserCDP=await browser.newBrowserCDPSession(),system=await browserCDP.send('SystemInfo.getInfo');report.environment={browser:await browserCDP.send('Browser.getVersion'),commandLine:system.commandLine,gpu:system.gpu,standardToken:require('node:child_process').execFileSync('C:/Windows/System32/whoami.exe',['/groups']).toString('utf8')};
  extra('standard medium-integrity user and sandboxed native GPU without safety bypass flags',report.environment.standardToken.includes('S-1-16-8192')&&!report.environment.standardToken.includes('S-1-16-12288')&&system.gpu.auxAttributes.sandboxed===true&&!/--no-sandbox|--disable-web-security|--enable-unsafe-swiftshader|--unsafely-disable|--disable-client-side-phishing-detection/.test(system.commandLine),{integritySID:'S-1-16-8192',gpuSandboxed:system.gpu.auxAttributes.sandboxed,commandLine:system.commandLine});
  page.on('pageerror',e=>report.errors.push({type:'pageerror',message:e.message,stack:e.stack}));page.on('console',m=>{if(m.type()==='error')report.errors.push({type:'console',message:m.text()});});page.on('request',r=>{if(/^https?:/.test(r.url()))report.httpRequests.push(r.url());});
  await page.addInitScript(()=>{window.__testInputAudit={trusted:0,untrusted:0,types:{},last:[]};for(const name of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click','keydown','input'])document.addEventListener(name,e=>{const a=window.__testInputAudit;a[e.isTrusted?'trusted':'untrusted']++;const t=name+':'+(e.pointerType||'native');a.types[t]=(a.types[t]||0)+1;if(name!=='pointermove')a.last.push({type:name,pointerType:e.pointerType,trusted:e.isTrusted,target:e.target.id,x:e.clientX,y:e.clientY,key:e.key});if(a.last.length>180)a.last.shift();},true);});
  await page.addInitScript(()=>{window.__testLifecycleAudit=[];for(const t of ['blur','focus','visibilitychange','webglcontextlost','webglcontextrestored'])window.addEventListener(t,e=>{window.__testLifecycleAudit.push({type:e.type,trusted:e.isTrusted,hidden:document.hidden});if(e.type==='blur'&&e.isTrusted)console.info('REGRESSION_TRUSTED_NATIVE_BLUR');},true);});
  page.on('close',()=>{(report.browserEvents||=[]).push('primary-page-close');});page.on('crash',()=>{(report.browserEvents||=[]).push('primary-page-crash');});
  blurTab=await context.newPage();blurTabCDP=await context.newCDPSession(blurTab);await blurTabCDP.send('Emulation.setFocusEmulationEnabled',{enabled:false});await blurTab.goto('about:blank');await page.bringToFront();
  const now=Date.now();await page.clock.install({time:new Date(now)});await page.clock.pauseAt(new Date(now+100));await page.goto(pathToFileURL(PRODUCT).href,{waitUntil:'load'});await clock(48,true);await screenshot({path:path.join(OUT,`${tag}-suite-initial.png`),fullPage:!mobile});
  if(!await page.evaluate(()=>!!window.actionForge3D)){report.blocked.push('constructor blocker');throw Error('constructor blocker');}
  report.startup={scene:await info(),framebuffer:await framebuffer(page),shaders:await shaderRead(cdp)};check('runtime v0.3 real WebGL visible before input',report.startup.scene.revision==='128'&&report.startup.scene.meshCount>150&&report.startup.scene.drawCalls>0&&report.startup.framebuffer.colors>100,report.startup);
  const sh=report.startup.shaders;check('strict actual WebGL compiled shaders linked programs drawcalls and shadows',sh.calls>0&&sh.triangles>0&&sh.shadow&&sh.glError===0&&sh.programs.length>0&&sh.programs.every(p=>p.linked&&p.shaders.every(s=>s.compiled)),sh);
  const gesturesOK=await gestures();if(!gesturesOnly){if(gesturesOK!==false)await goodpath();await lowpath();await sampleFrames();}else notrun('stage2-6 full goodpath','gesture-only diagnostic run');
}catch(e){report.fatal=e.stack;report.blocked.push(e.message);process.exitCode=1;}finally{
  if(page&&!page.isClosed()){report.inputAudit=await page.evaluate(()=>window.__testInputAudit).catch(()=>null);report.lifecycleAudit=await page.evaluate(()=>window.__testLifecycleAudit).catch(()=>[]);const engineHidden=await page.locator('#engine-error').evaluate(e=>e.hidden).catch(()=>false);extra('native WebGL context has no loss or error UI throughout the full pipeline',engineHidden&&!report.lifecycleAudit.some(e=>e.type==='webglcontextlost'),{engineErrorHidden:engineHidden,contextEvents:report.lifecycleAudit.filter(e=>e.type.startsWith('webgl'))});await screenshot({path:path.join(OUT,`${tag}${gesturesOnly?'-gestures':''}-last.png`),fullPage:true}).catch(()=>{});}
  check('all first click/touch control actions applied once without recovery or doubles',!!report.controlAudit?.length&&report.controlAudit.every(v=>v.ok),{controls:report.controlAudit?.length,failures:report.controlAudit?.filter(v=>!v.ok),mobile});report.sha256After=sha();check('product SHA256 unchanged',report.sha256Before===report.sha256After,{sha256:report.sha256After});check('no HTTP requests',report.httpRequests.length===0,{requests:report.httpRequests});check('no console/page JS errors',report.errors.length===0,{errors:report.errors});if(report.inputAudit)check('browser inputs trusted; no synthetic dispatch',report.inputAudit.untrusted===0&&report.inputAudit.trusted>10,{trusted:report.inputAudit.trusted,untrusted:report.inputAudit.untrusted,types:report.inputAudit.types});report.counts=report.cases.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{});report.suiteCounts={};for(const suite of ['inherited','supplemental'])report.suiteCounts[suite]=report.cases.filter(c=>c.suite===suite).reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{});if(report.counts.fail||report.fatal)process.exitCode=1;write();if(browser)await browser.close();console.log(JSON.stringify({tag,counts:report.counts,suiteCounts:report.suiteCounts,blocked:report.blocked,fatal:report.fatal||null,report:path.join(OUT,`${tag}${gesturesOnly?'-gestures':''}.json`)}));
}}
main();
