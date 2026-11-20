"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'Source');
const read=f=>fs.readFileSync(path.join(source,f),'utf8');
const ids=['three-vendor','core','app3d'];
const files=['three-r128.js','core.js','app3d.js'];
let html=read('shell.html');
for(let i=0;i<ids.length;i++){
  html+='<script id="'+ids[i]+'">'+read(files[i])+'</script>';
  if(i<2)html+=read('separator.txt');
}
html+=read('tail.html');
const flag=process.argv.indexOf('--output');
const target=flag>=0?path.resolve(process.argv[flag+1]):path.join(root,'build','index.html');
if(fs.existsSync(target))throw Error('Refusing to overwrite an existing build: choose a new --output file.');
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,html,{flag:'wx'});
const data=Buffer.from(html);
console.log(JSON.stringify({file:target,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),matchesCheckedInEntry:data.equals(fs.readFileSync(path.join(root,'index.html')))},null,2));
