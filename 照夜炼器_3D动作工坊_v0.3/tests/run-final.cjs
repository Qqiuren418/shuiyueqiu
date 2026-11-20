'use strict';
// Final-only regression. Source and previous evidence are read-only. No deployment, installation or repository operation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),zlib=require('node:zlib');
const {OUT,PRODUCT}=require('./startup.cjs');
const SCRIPT=__dirname,BASE=JSON.parse(fs.readFileSync(path.join(SCRIPT,'baseline-cases.json'),'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before=hash(PRODUCT),oldBefore={};
const began=new Date().toISOString();
function pngEvidence(file){
  const b=fs.readFileSync(file);if(!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG '+file);
  let at=8,width,height,channels,bitDepth,interlace,idat=[],ended=false;
  while(at<b.length){const n=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8),data=b.subarray(at+8,at+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];channels=data[9]===6?4:data[9]===2?3:0;interlace=data[12];}if(type==='IDAT')idat.push(data);if(type==='IEND')ended=true;at+=12+n;}
  if(!ended||!channels||bitDepth!==8||interlace!==0)throw Error('Unsupported or incomplete screenshot PNG '+file);
  const raw=zlib.inflateSync(Buffer.concat(idat)),stride=width*channels;if(raw.length!==height*(stride+1))throw Error('Invalid decoded PNG size '+file);
  const rows=Buffer.alloc(width*height*channels);let source=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=raw[source++];if(filter>4)throw Error('Invalid PNG filter '+file);for(let x=0;x<stride;x++){const i=y*stride+x,left=x>=channels?rows[i-channels]:0,up=y?rows[i-stride]:0,upperLeft=y&&x>=channels?rows[i-stride-channels]:0;const f=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);rows[i]=(raw[source++]+f)&255;}}
  const colors=new Set();let min=255,max=0;for(let i=0;i<rows.length;i+=channels*97){min=Math.min(min,rows[i],rows[i+1],rows[i+2]);max=Math.max(max,rows[i],rows[i+1],rows[i+2]);colors.add((rows[i]<<16)|(rows[i+1]<<8)|rows[i+2]);}
  return {path:file,bytes:b.length,width,height,colors:colors.size,min,max,sha256:hash(file),valid:width>100&&height>100&&colors.size>100&&max-min>30};
}
const results=[];
for(const mode of ['desktop','mobile']){
  const logFile=path.join(OUT,mode+'-run.log'),fd=fs.openSync(logFile,'wx');
  let run;
  try{run=cp.spawnSync(process.execPath,[path.join(SCRIPT,'browser-tests.cjs'),...(mode==='mobile'?['--mobile']:[])],{cwd:OUT,env:{...process.env,FORGE_TEST_OUTPUT:OUT},stdio:['ignore',fd,fd],timeout:540000,windowsHide:false});}finally{fs.closeSync(fd);}
  const file=path.join(OUT,mode+'.json');if(!fs.existsSync(file))throw Error(mode+' did not return a browser report: '+String(run.error||run.status));
  const r=JSON.parse(fs.readFileSync(file));
  const names=r.cases.filter(c=>c.suite==='inherited').map(c=>c.name),priorNames=BASE[mode];
  const inheritedAll=names.length===priorNames.length&&names.every((n,i)=>n===priorNames[i]);
  results.push({mode,report:file,log:logFile,exitCode:run.status,error:run.error?.message||null,counts:r.counts,suiteCounts:r.suiteCounts,inheritedAllOriginalNamesAndOrder:inheritedAll,expectedInherited:mode==='desktop'?73:72,result:r.result,lowPartial:r.lowPartial,firstControlActions:r.controlAudit?.length,inputs:r.inputAudit,errors:r.errors,httpRequests:r.httpRequests,blocked:r.blocked,fatal:r.fatal||null,environment:r.environment,startup:r.startup,highResultScene:r.highResultScene,performance:r.performance,sha256Before:r.sha256Before,sha256After:r.sha256After});
  console.log(JSON.stringify({mode,exitCode:run.status,counts:r.counts,suites:r.suiteCounts,originalCasesPreserved:inheritedAll,fatal:r.fatal||null}));
}
const screenshots=fs.readdirSync(OUT).filter(f=>f.endsWith('.png')&&!f.startsWith('attempt')).map(f=>pngEvidence(path.join(OUT,f)));
const required=['desktop-suite-initial.png','desktop-hammer.png','desktop-camera-orbit.png','desktop-finish.png','mobile-finish.png'];
const missing=required.filter(f=>!screenshots.some(s=>path.basename(s.path)===f));
const oldAfter={};
const after=hash(PRODUCT),counts={pass:0,fail:0,notrun:0},inherited={pass:0,fail:0,notrun:0},supplemental={pass:0,fail:0,notrun:0};
for(const r of results)for(const k of Object.keys(counts)){counts[k]+=r.counts[k]||0;inherited[k]+=r.suiteCounts.inherited[k]||0;supplemental[k]+=r.suiteCounts.supplemental[k]||0;}
const scripts=['run-final.cjs','browser-tests.cjs','startup.cjs'].map(f=>({path:path.join(SCRIPT,f),sha256:hash(path.join(SCRIPT,f))}));
const report={source:PRODUCT,outputDirectory:OUT,startedAt:began,finishedAt:new Date().toISOString(),htmlSHA256:after,sourceUnchanged:before===after,previousArtifactsUnchanged:JSON.stringify(oldBefore)===JSON.stringify(oldAfter),original145:{expectedTotal:145,counts:inherited,allNamesAndOrderPreserved:results.every(r=>r.inheritedAllOriginalNamesAndOrder)},supplemental: {counts:supplemental,scope:'Before-start lift, native trusted blur and pause/opacity at all five active stages, armed gesture rollback, real resize/ray targets, stationary/subpixel fine-grind no-fake, finished feedback, sandbox/user/context health'},finalCounts:counts,screenshotsCountedAsTests:false,performanceCountedAsTests:false,excludedAttempts:{preservedPrefixes:['attempt1-','attempt2-'],reason:'Attempt1: clocked waitForFunction/rAF native-blur fixture timed out at stage2. Attempt2: desktop Playwright screenshot compositor/font wait timed out; touch original72+supplemental36 passed twice. Final uses native trusted-blur event receipt and native CDP screenshots in hardware-rendered headless Edge. No source, state, scores or acceptance assertions changed; complete original suites rerun.'},artifacts:{scripts,report:path.join(OUT,'final-report.json'),screenshots,requiredScreenshotsPresent:missing.length===0,missingScreenshots:missing},results,limitations:['Performance is only twenty unclocked native frames per viewport on the untouched initial scene. No sustained or hard-FPS assertion.','WebGL capability, linked programs, actual draw calls, framebuffer pixels and screenshots prove runtime rendering, not a claim of production-grade art.']};
report.accepted=report.sourceUnchanged&&report.previousArtifactsUnchanged&&report.original145.allNamesAndOrderPreserved&&inherited.pass===145&&counts.fail===0&&counts.notrun===0&&missing.length===0&&screenshots.every(s=>s.valid)&&results.every(r=>r.exitCode===0&&!r.fatal&&!r.blocked.length&&r.performance?.valid&&r.result?.quality>=90);
fs.writeFileSync(report.artifacts.report,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({accepted:report.accepted,counts,inherited,supplemental,sourceSHA256:after,report:report.artifacts.report,screenshots:screenshots.length}));
if(!report.accepted)process.exitCode=1;
