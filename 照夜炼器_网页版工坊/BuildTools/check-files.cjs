'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(root,'交付文件清单.json'),'utf8'));
for(const e of m.files){const b=fs.readFileSync(path.join(root,e.path));if(b.length!==e.bytes||hash(b)!==e.sha256)throw Error('File hash mismatch: '+e.path);}
const html=fs.readFileSync(path.join(root,'index.html'));
let assembled=fs.readFileSync(path.join(root,'Source/shell.html'));
for(const [name,id] of [['three-r128.js','three-vendor'],['core.js','core'],['app3d.js','app3d']]){assembled=Buffer.concat([assembled,Buffer.from('<script id=\"'+id+'\">'),fs.readFileSync(path.join(root,'Source',name)),Buffer.from('</script>'),id==='app3d'?Buffer.alloc(0):fs.readFileSync(path.join(root,'Source/separator.txt'))]);}
assembled=Buffer.concat([assembled,fs.readFileSync(path.join(root,'Source/tail.html'))]);
if(!assembled.equals(html))throw Error('Build source/entry mismatch');
const duplicates=new Map();for(const e of m.files){const group=duplicates.get(e.sha256)||[];group.push(e.path);duplicates.set(e.sha256,group);}
if([...duplicates.values()].some(xs=>xs.length>1))throw Error('Byte-identical duplicate files in current project');
const r=JSON.parse(fs.readFileSync(path.join(root,'Verification/final-report.json'),'utf8'));
const ui=JSON.parse(fs.readFileSync(path.join(root,'Verification/ui-report.json'),'utf8'));
if(!r.accepted||r.htmlSHA256!==hash(html)||r.finalCounts.pass!==217||r.finalCounts.fail!==0||r.finalCounts.notrun!==0)throw Error('Recorded report/source mismatch');
if(ui.htmlSHA256!==hash(html)||ui.counts.pass!==202||ui.counts.fail!==0||!ui.completed)throw Error('UI report/source mismatch');
console.log(JSON.stringify({status:'FILES_VERIFIED',files:m.files.length+1,recordedTests:r.finalCounts,uiChecks:ui.counts,sha256:hash(html),freshRuntimeTest:false},null,2));
