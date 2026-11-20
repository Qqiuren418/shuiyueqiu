'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright-core');
const ROOT=path.resolve(__dirname,'..');
const PRODUCT=path.resolve(process.env.FORGE_HTML_PATH||path.join(ROOT,'index.html'));
const OUT=path.resolve(process.env.FORGE_TEST_OUTPUT||path.join(ROOT,'test-results',new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,8)));
fs.mkdirSync(OUT,{recursive:true});
const candidates=process.platform==='win32'?[path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe')]:process.platform==='darwin'?['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/microsoft-edge','/usr/bin/google-chrome','/usr/bin/chromium'];
const EDGE=process.env.FORGE_BROWSER_PATH||candidates.find(p=>fs.existsSync(p))||chromium.executablePath();
const sha=()=>crypto.createHash('sha256').update(fs.readFileSync(PRODUCT)).digest('hex');
async function heapRead(cdp){
  const remote=async expression=>(await cdp.send('Runtime.evaluate',{expression})).result.objectId;
  const meshes=await cdp.send('Runtime.queryObjects',{prototypeObjectId:await remote('THREE.Mesh.prototype')});
  const cameras=await cdp.send('Runtime.queryObjects',{prototypeObjectId:await remote('THREE.PerspectiveCamera.prototype')});
  const result=await cdp.send('Runtime.callFunctionOn',{objectId:meshes.objects.objectId,arguments:[{objectId:cameras.objects.objectId}],returnByValue:true,functionDeclaration:`function(cameras){
    const camera=cameras.find(c=>c.isPerspectiveCamera&&c.parent===null&&c.fov===43&&c.near===.1&&c.far===100);
    const canvas=document.getElementById('world'),r=canvas.getBoundingClientRect();
    const visible=m=>{for(let n=m;n;n=n.parent)if(!n.visible)return false;return true;};
    const project=v=>{const p=v.clone().project(camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,z:p.z};};
    const head=this.find(m=>m.name==='hammer-head'&&m.parent?.parent?.isScene);
    const blade=this.find(m=>m.userData?.kind==='blade'&&m.parent?.parent?.isScene);
    function describe(m){if(!m)return null;const a=m.geometry.attributes.position;const b=new THREE.Box3().setFromBufferAttribute(a);const corners=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])corners.push(project(new THREE.Vector3(x,y,z).applyMatrix4(m.matrixWorld)));return {visible:visible(m),type:m.geometry.type,vertices:a.count,world:new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).toArray(),screen:{left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))},vertexSum:Array.from(a.array).reduce((s,v,i)=>s+v*(i%17+1),0)};}
    const runeRays=[];if(actionForge3D.snapshot().stage===5){const rc=new THREE.Raycaster();const inverse=new THREE.Matrix4().copy(blade.parent.matrixWorld).invert();for(const p of actionForge3D.targets().runes){rc.setFromCamera(new THREE.Vector2((p.x-r.left)/r.width*2-1,-(p.y-r.top)/r.height*2+1),camera);const h=rc.intersectObject(blade,false)[0];runeRays.push(h?{local:h.point.clone().applyMatrix4(inverse).toArray(),normal:h.face.normal.toArray(),faceIndex:h.faceIndex}:null);}}
    let upperPositive=0,upperNegative=0;const positions=blade?.geometry.attributes.position,normals=blade?.geometry.attributes.normal;if(positions&&normals)for(let i=0;i<positions.count;i+=3){if((positions.getY(i)+positions.getY(i+1)+positions.getY(i+2))/3>0){if(normals.getY(i)>0)upperPositive++;else upperNegative++;}}
    return {actualMeshCount:this.filter(m=>m.parent).length,camera:{type:camera.type,fov:camera.fov,aspect:camera.aspect,projection:camera.projectionMatrix.toArray(),position:camera.position.toArray(),matrix:camera.matrixWorld.toArray()},head:describe(head),blade:describe(blade),upperFaceNormals:{positive:upperPositive,negative:upperNegative},runeRays};
  }`});
  await cdp.send('Runtime.releaseObject',{objectId:meshes.objects.objectId});
  await cdp.send('Runtime.releaseObject',{objectId:cameras.objects.objectId});
  if(result.exceptionDetails)throw new Error('READONLY_HEAP_PROBE: '+JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function framebuffer(page){return page.evaluate(()=>{
  const canvas=document.getElementById('world');const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');if(!gl)return null;
  const a=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a);
  let min=255,max=0,nonblack=0;const colors=new Set();for(let i=0;i<a.length;i+=4*97){min=Math.min(min,a[i],a[i+1],a[i+2]);max=Math.max(max,a[i],a[i+1],a[i+2]);if(a[i]+a[i+1]+a[i+2]>12)nonblack++;colors.add((a[i]<<16)|(a[i+1]<<8)|a[i+2]);}
  const ext=gl.getExtension('WEBGL_debug_renderer_info');return {width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,min,max,colors:colors.size,nonblack,glError:gl.getError(),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
});}
async function main(){
  const report={product:PRODUCT,sha256Before:sha(),launchArgs:[],cases:[],errors:[],httpRequests:[]};let browser;
  try{
    browser=await chromium.launch({executablePath:EDGE,headless:true,args:[]});
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();
    page.on('pageerror',e=>report.errors.push({type:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')report.errors.push({type:'console',message:m.text()});});page.on('request',r=>{if(/^https?:/.test(r.url()))report.httpRequests.push(r.url());});
    await page.goto(pathToFileURL(PRODUCT).href,{waitUntil:'load'});await page.screenshot({path:path.join(OUT,'desktop-initial.png'),fullPage:true});
    report.constructorBlocker=await page.evaluate(()=>({api:!!window.actionForge3D,engineError:!document.getElementById('engine-error').hidden,message:document.getElementById('engine-error-message').textContent}));
    if(!report.constructorBlocker.api)throw new Error('WebGL/application constructor blocker: '+JSON.stringify(report.constructorBlocker));
    report.scene=await page.evaluate(()=>window.actionForge3D.sceneInfo());report.framebuffer=await framebuffer(page);report.heap=await heapRead(await context.newCDPSession(page));
    const s=report.scene,f=report.framebuffer;
    report.cases.push({name:'real WebGL r128 startup',status:s.renderer==='THREE.WebGLRenderer'&&s.revision==='128'&&s.meshCount>150&&s.perspectiveCamera&&s.shadows&&s.drawCalls>0&&f.colors>100&&f.max-f.min>30&&f.glError===0?'pass':'fail'});
  }catch(e){report.fatal=e.stack;process.exitCode=1;}finally{report.sha256After=sha();report.productUnmodified=report.sha256Before===report.sha256After;fs.writeFileSync(path.join(OUT,'startup.json'),JSON.stringify(report,null,2));if(browser)await browser.close();console.log(JSON.stringify(report));}
}
async function surfaceRead(cdp,request={}){
  const objects=await cdp.send('Runtime.queryObjects',{prototypeObjectId:(await cdp.send('Runtime.evaluate',{expression:'THREE.Mesh.prototype'})).result.objectId});
  const cameras=await cdp.send('Runtime.queryObjects',{prototypeObjectId:(await cdp.send('Runtime.evaluate',{expression:'THREE.PerspectiveCamera.prototype'})).result.objectId});
  const result=await cdp.send('Runtime.callFunctionOn',{objectId:objects.objects.objectId,arguments:[{objectId:cameras.objects.objectId},{value:request}],returnByValue:true,functionDeclaration:`function(cameras,request){
    const blade=this.find(m=>m.userData?.kind==='blade'&&m.parent?.parent?.isScene),group=blade.parent;
    const camera=cameras.find(c=>c.isPerspectiveCamera&&c.parent===null&&c.fov===43&&c.near===.1&&c.far===100);
    const r=document.getElementById('world').getBoundingClientRect(),s=actionForge3D.snapshot(),rc=new THREE.Raycaster();
    const project=p=>{const v=p.clone().project(camera);return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};};
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(blade.matrixWorld);
    const screenHit=p=>{rc.setFromCamera(new THREE.Vector2((p.x-r.left)/r.width*2-1,-(p.y-r.top)/r.height*2+1),camera);const h=rc.intersectObject(blade,false)[0];return h?{local:group.worldToLocal(h.point.clone()).toArray(),world:h.point.toArray(),normal:h.face.normal.toArray(),worldNormal:h.face.normal.clone().applyMatrix3(normalMatrix).normalize().toArray(),faceIndex:h.faceIndex}:null;};
    const vertical=(x,z)=>{
      for(const [dx,dz] of [[0,0],[-1e-7,0],[1e-7,0],[0,-1e-7],[0,1e-7],[-1e-6,-1e-6],[1e-6,1e-6]]){
        const o=group.localToWorld(new THREE.Vector3(x+dx,1,z+dz)),d=new THREE.Vector3(0,-1,0).transformDirection(group.matrixWorld);rc.set(o,d);const h=rc.intersectObject(blade,false)[0];if(!h)continue;
        const p=project(h.point),hit=screenHit(p);if(hit)return {...p,expected:group.worldToLocal(h.point.clone()).toArray(),hit,fixtureEpsilon:[dx,dz]};
      }
      return null;
    };
    const points=[];
    if(request.kind==='rune'){
      const A=s.runePoints[request.segment],B=s.runePoints[request.segment+1],from=request.from??0,to=request.to??1,count=request.count??49;
      for(let j=0;j<count;j++){const t=from+(to-from)*j/(count-1),x=(A[0]+(B[0]-A[0])*t-290)/75-2.4,z=(A[1]+(B[1]-A[1])*t-222)*.014;points.push(vertical(x,z));}
    }else if(request.kind==='edge'){
      const count=request.count??97;for(let j=0;j<count;j++){const x=-2.4+.004+(4.8-.010)*j/(count-1),f=(x+2.4)/.8,i=Math.min(5,Math.floor(f)),t=f-i,w=(s.thick[i]*(1-t)+(i<5?s.thick[i+1]:.012/.014)*t)*.014,b=(s.bias[i]*(1-t)+(i<5?s.bias[i+1]:0)*t)*.014;points.push(vertical(x,b+(request.side===0?-1:1)*w*.90));}
    }
    const water=this.find(m=>m.material?.isMeshPhysicalMaterial&&m.geometry?.type==='PlaneGeometry'&&m.parent?.isScene);
    const a=blade.geometry.attributes.position,worldVertices=[],root=[],tip=[];for(let i=0;i<a.count;i++){const v=new THREE.Vector3().fromBufferAttribute(a,i),world=v.clone().applyMatrix4(blade.matrixWorld).toArray();worldVertices.push(world);if(v.x<-2.399)root.push(world[1]);if(v.x>2.399)tip.push(world[1]);}
    let upperPositive=0,upperNegative=0,lowerPositive=0,lowerNegative=0;const n=blade.geometry.attributes.normal;
    for(let i=0;i<a.count;i+=3){const cy=(a.getY(i)+a.getY(i+1)+a.getY(i+2))/3,ny=n.getY(i);if(cy>0&&Math.abs(ny)>.01){ny>0?upperPositive++:upperNegative++;}if(cy<0&&Math.abs(ny)>.01){ny>0?lowerPositive++:lowerNegative++;}}
    return {points,rays:(request.screenPoints||[]).map(screenHit),normals:{upperPositive,upperNegative,lowerPositive,lowerNegative},pool:{waterY:water?.position.y,transparent:water?.material.transparent,opacity:water?.material.opacity,rotation:group.rotation.toArray(),rootTop:Math.max(...root),rootBottom:Math.min(...root),tipTop:Math.max(...tip),tipBottom:Math.min(...tip),allBelow:worldVertices.every(v=>v[1]<water.position.y),belowCount:worldVertices.filter(v=>v[1]<water.position.y).length,vertices:worldVertices.length},pbr:{type:blade.material.type,metalness:blade.material.metalness,roughness:blade.material.roughness,environment:!!blade.parent.parent.environment,castShadow:blade.castShadow,receiveShadow:blade.receiveShadow}};
  }`});
  await cdp.send('Runtime.releaseObject',{objectId:objects.objects.objectId});await cdp.send('Runtime.releaseObject',{objectId:cameras.objects.objectId});
  if(result.exceptionDetails)throw Error('READONLY_SURFACE_PROBE '+JSON.stringify(result.exceptionDetails));return result.result.value;
}
async function shaderRead(cdp){
  const objects=await cdp.send('Runtime.queryObjects',{prototypeObjectId:(await cdp.send('Runtime.evaluate',{expression:'THREE.WebGLRenderer.prototype'})).result.objectId});
  const result=await cdp.send('Runtime.callFunctionOn',{objectId:objects.objects.objectId,returnByValue:true,functionDeclaration:`function(){const renderer=this.find(r=>r.domElement?.id==='world'),gl=renderer.getContext();return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,outputEncoding:renderer.outputEncoding,toneMappingExposure:renderer.toneMappingExposure,capabilities:{isWebGL2:renderer.capabilities.isWebGL2,maxTextures:renderer.capabilities.maxTextures,maxTextureSize:renderer.capabilities.maxTextureSize},shadow:renderer.shadowMap.enabled,programs:renderer.info.programs.map(p=>({name:p.name,linked:gl.getProgramParameter(p.program,gl.LINK_STATUS),log:gl.getProgramInfoLog(p.program),shaders:gl.getAttachedShaders(p.program).map(s=>({compiled:gl.getShaderParameter(s,gl.COMPILE_STATUS),log:gl.getShaderInfoLog(s)}))})),glError:gl.getError()};}`});
  await cdp.send('Runtime.releaseObject',{objectId:objects.objects.objectId});if(result.exceptionDetails)throw Error('READONLY_SHADER_PROBE '+JSON.stringify(result.exceptionDetails));return result.result.value;
}
if(require.main===module)main();
module.exports={PRODUCT,OUT,EDGE,sha,heapRead,surfaceRead,shaderRead,framebuffer,chromium,pathToFileURL};
