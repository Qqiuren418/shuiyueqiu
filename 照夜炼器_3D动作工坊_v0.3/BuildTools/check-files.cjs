'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(root,'交付文件清单.json'),'utf8'));
for(const e of m.files){const b=fs.readFileSync(path.join(root,e.path));if(b.length!==e.bytes||hash(b)!==e.sha256)throw Error('File hash mismatch: '+e.path);}
const html=fs.readFileSync(path.join(root,'index.html'));
if(!html.equals(fs.readFileSync(path.join(root,'照夜炼器_3D动作工坊_v0.3.html'))))throw Error('Playable copy mismatch');
const r=JSON.parse(fs.readFileSync(path.join(root,'Verification/final-report.json'),'utf8'));
if(r.htmlSHA256!==hash(html)||r.finalCounts.pass!==217||r.finalCounts.fail!==0||r.finalCounts.notrun!==0)throw Error('Recorded report/source mismatch');
console.log(JSON.stringify({status:'FILES_VERIFIED',files:m.files.length+1,recordedTests:r.finalCounts,sha256:hash(html),freshRuntimeTest:false},null,2));
