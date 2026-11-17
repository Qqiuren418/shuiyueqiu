// Markdown to a CJK-friendly Word handbook with real lists, headings and source hyperlinks.
const fs = require('fs');
const d = require('D:/Program Files/工作内容/node_modules/docx');
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,HeadingLevel,
  WidthType,ShadingType,BorderStyle,LevelFormat,AlignmentType,Header,Footer,
  PageNumber,ExternalHyperlink} = d;
const root = 'D:/Program Files/新游戏锻造';
const source = root + '/炼器修炼手册_小说调研与玩法参考.md';
const target = root + '/炼器修炼手册_小说调研与玩法参考.docx';
if (fs.existsSync(target)) throw new Error('Target already exists; preserve it before regenerating.');
const md = fs.readFileSync(source,'utf8');
const lines = md.split(/\r?\n/);
const FONT = 'Microsoft YaHei';
const WIDTH = 9626;
function inline(text, size=22, color='263238') {
  const runs = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) runs.push(new TextRun({text:text.slice(at,m.index),font:FONT,size,color}));
    if (m[2]) runs.push(new ExternalHyperlink({link:m[3],children:[new TextRun({text:m[2],font:FONT,size,color:'286376',underline:{color:'286376'}})]}));
    else runs.push(new TextRun({text:m[4] || m[5],font:FONT,size,color,bold:!!m[4]}));
    at = re.lastIndex;
  }
  if (at < text.length) runs.push(new TextRun({text:text.slice(at),font:FONT,size,color}));
  return runs.length ? runs : [new TextRun({text:'',font:FONT,size})];
}
const tableBorder = {style:BorderStyle.SINGLE,size:4,color:'CDD7DB'};
function parseRow(line){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim());}
function makeTable(block) {
  const rows=block.filter(x=>!/^\|?[ :\-|]+\|?$/.test(x.trim())).map(parseRow);
  const n=rows[0].length;
  const weights=Array(n).fill(1);
  if(n>=3) weights[0]=0.85;
  if(n>=4) weights[n-1]=1.15;
  const total=weights.reduce((a,b)=>a+b,0);
  const widths=weights.map(w=>Math.floor(WIDTH*w/total));
  widths[n-1]+=WIDTH-widths.reduce((a,b)=>a+b,0);
  return new Table({width:{size:WIDTH,type:WidthType.DXA},columnWidths:widths,
    borders:{top:tableBorder,bottom:tableBorder,left:tableBorder,right:tableBorder,insideHorizontal:tableBorder,insideVertical:tableBorder},
    rows:rows.map((r,ri)=>new TableRow({tableHeader:ri===0,cantSplit:true,children:r.map((s,ci)=>new TableCell({
      width:{size:widths[ci],type:WidthType.DXA},
      shading:ri===0?{type:ShadingType.CLEAR,fill:'E9EFF2'}:undefined,
      margins:{top:90,bottom:90,left:95,right:95},
      children:[new Paragraph({spacing:{before:0,after:20,line:270},children:inline(s,19,ri===0?'244653':'263238').map(run=>run)})]
    }))}))});
}
const children=[];
let isSubtitle=true;
let orderedInstance=0;
let previousOrdered=false;
const stats={headings:0,tables:0,bullets:0,numbered:0};
for(let i=0;i<lines.length;i++){
  const raw=lines[i],s=raw.trim();
  if(!s){previousOrdered=false; continue;}
  if(s.startsWith('|')){
    const block=[];
    while(i<lines.length && lines[i].trim().startsWith('|')) block.push(lines[i++]);
    i--;
    children.push(makeTable(block));
    children.push(new Paragraph({spacing:{after:80},children:[]}));
    stats.tables++; previousOrdered=false; continue;
  }
  const h=s.match(/^(#{1,4})\s+(.+)$/);
  if(h){
    const lvl=h[1].length;
    if(lvl===1){
      children.push(new Paragraph({spacing:{before:220,after:200},children:[new TextRun({text:h[2],font:FONT,size:50,bold:true,color:'234A59'})]}));
    }else if(isSubtitle){
      children.push(new Paragraph({spacing:{after:240},children:[new TextRun({text:h[2],font:FONT,size:26,color:'526871'})]}));
      isSubtitle=false;
    }else{
      const heading=lvl===2?HeadingLevel.HEADING_1:lvl===3?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3;
      children.push(new Paragraph({heading,keepNext:true,spacing:{before:lvl===2?280:200,after:130},children:inline(h[2],lvl===2?31:lvl===3?26:23,'234A59')}));
      stats.headings++;
    }
    previousOrdered=false; continue;
  }
  const ordered=s.match(/^\d+\.\s+(.+)$/);
  const bullet=s.match(/^-\s+(.+)$/);
  let content=s,numbering;
  if(ordered){if(!previousOrdered) orderedInstance++;content=ordered[1];numbering={reference:'ordered',level:0,instance:orderedInstance};previousOrdered=true;stats.numbered++;}
  else{previousOrdered=false;if(bullet){content=bullet[1];numbering={reference:'bullet',level:0};stats.bullets++;}}
  children.push(new Paragraph({numbering,spacing:{before:20,after:100,line:335},widowControl:true,children:inline(content)}));
}
const doc=new Document({creator:'千问办公',title:'炼器修炼手册：小说调研与玩法参考',description:'六部小说、十七项出处、炼器工艺与宗门委托设计参考。',
  styles:{default:{document:{run:{font:FONT,size:22,color:'263238'},paragraph:{spacing:{after:100,line:335}}}},
    paragraphStyles:[
      {id:'Heading1',name:'heading 1',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:FONT,bold:true,size:31,color:'234A59'},paragraph:{outlineLevel:0,keepNext:true}},
      {id:'Heading2',name:'heading 2',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:FONT,bold:true,size:26,color:'234A59'},paragraph:{outlineLevel:1,keepNext:true}},
      {id:'Heading3',name:'heading 3',basedOn:'Normal',next:'Normal',quickFormat:true,run:{font:FONT,bold:true,size:23,color:'234A59'},paragraph:{outlineLevel:2,keepNext:true}}
    ]},
  numbering:{config:[
    {reference:'bullet',levels:[{level:0,format:LevelFormat.BULLET,text:'\u2022',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:350,hanging:240}}}}]},
    {reference:'ordered',levels:[{level:0,format:LevelFormat.DECIMAL,text:'%1.',start:1,alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:400,hanging:290}}}}]}
  ]},
  sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1140,right:1140,header:540,footer:540}}},
    headers:{default:new Header({children:[new Paragraph({border:{bottom:{color:'CDD7DB',style:BorderStyle.SINGLE,size:4}},children:[new TextRun({text:'炼器修炼手册  /  小说调研与玩法参考',font:FONT,size:17,color:'647A83'})]})]})},
    footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:'炼器宗门经营 · 研究参考   |   ',font:FONT,size:17,color:'647A83'}),new TextRun({children:[PageNumber.CURRENT],font:FONT,size:17,color:'647A83'})]})]})},
    children}]});
Packer.toBuffer(doc).then(buffer=>{fs.writeFileSync(target,buffer);console.log(JSON.stringify({status:'DOCX_GENERATED',bytes:buffer.length,stats,markdownChars:md.length},null,2));}).catch(e=>{console.error(e);process.exit(1);});
