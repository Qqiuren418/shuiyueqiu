const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation
} = require("docx");

// ---------- 配置 ----------
const args = process.argv.slice(2);
const inputFile = args[0];
const outputFile = args[1];
if (!inputFile || !outputFile) {
  console.error("用法: node md2docx.js <input.md> <output.docx>");
  process.exit(1);
}

const FONT = "微软雅黑";
const md = fs.readFileSync(inputFile, "utf8");
const lines = md.split(/\r?\n/);

// A4 竖版可用宽度（DXA）。A4宽11906，左右各1440边距 => 内容区 9026
const CONTENT_WIDTH = 9026;

// ---------- 内联解析：把 **加粗** 转成 TextRun 数组 ----------
function parseInline(text, baseOpts = {}) {
  const runs = [];
  // 先按 ** 切分
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      runs.push(new TextRun({
        text: part.slice(2, -2),
        bold: true,
        font: FONT,
        size: baseOpts.size || 21,
        color: baseOpts.color,
      }));
    } else {
      runs.push(new TextRun({
        text: part,
        font: FONT,
        size: baseOpts.size || 21,
        color: baseOpts.color,
        bold: baseOpts.bold,
        italics: baseOpts.italics,
      }));
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text: "", font: FONT, size: baseOpts.size || 21 }));
  return runs;
}

// ---------- 表格解析 ----------
function splitRow(row) {
  // 去掉首尾 |，按 | 切分
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

function isDivider(cells) {
  return cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")) || /^-{2,}$/.test(c.replace(/\s/g, "")));
}

function buildTable(headerCells, bodyRows) {
  const colCount = headerCells.length;
  // 均分列宽
  const colW = Math.floor(CONTENT_WIDTH / colCount);
  const columnWidths = new Array(colCount).fill(colW);
  // 修正最后一列让总和等于内容宽
  columnWidths[colCount - 1] = CONTENT_WIDTH - colW * (colCount - 1);

  const borderStyle = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
  const borders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

  function makeCell(text, width, isHeader) {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders,
      shading: isHeader ? { type: ShadingType.CLEAR, color: "auto", fill: "E8EEF7" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({
        children: parseInline(text, { size: 18, bold: isHeader }),
        spacing: { after: 0 },
      })],
    });
  }

  const rows = [];
  rows.push(new TableRow({
    tableHeader: true,
    children: headerCells.map((c, i) => makeCell(c, columnWidths[i], true)),
  }));
  for (const body of bodyRows) {
    // 补齐/裁剪到 colCount
    const cells = [];
    for (let i = 0; i < colCount; i++) {
      cells.push(body[i] !== undefined ? body[i] : "");
    }
    rows.push(new TableRow({
      children: cells.map((c, i) => makeCell(c, columnWidths[i], false)),
    }));
  }

  return new Table({
    columnWidths,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    rows,
  });
}

// ---------- 主解析循环 ----------
const children = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();

  // 空行
  if (trimmed === "") { i++; continue; }

  // 分隔线 ---
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
    children.push(new Paragraph({
      text: "",
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
      spacing: { before: 120, after: 120 },
    }));
    i++; continue;
  }

  // 标题 # ~ ######
  const hMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (hMatch) {
    const level = hMatch[1].length;
    const text = hMatch[2];
    const headingMap = {
      1: HeadingLevel.TITLE,
      2: HeadingLevel.HEADING_1,
      3: HeadingLevel.HEADING_2,
      4: HeadingLevel.HEADING_3,
      5: HeadingLevel.HEADING_4,
      6: HeadingLevel.HEADING_5,
    };
    const sizeMap = { 1: 36, 2: 28, 3: 24, 4: 22, 5: 21, 6: 21 };
    children.push(new Paragraph({
      heading: headingMap[level],
      children: parseInline(text, { size: sizeMap[level], bold: true, color: level <= 2 ? "1F3864" : "2E5496" }),
      spacing: { before: level === 1 ? 240 : 200, after: level === 1 ? 200 : 100 },
    }));
    i++; continue;
  }

  // 表格：当前行是表头，下一行是分隔行
  if (trimmed.startsWith("|") && i + 1 < lines.length) {
    const nextCells = splitRow(lines[i + 1]);
    if (isDivider(nextCells)) {
      const headerCells = splitRow(trimmed);
      const bodyRows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        bodyRows.push(splitRow(lines[j]));
        j++;
      }
      children.push(buildTable(headerCells, bodyRows));
      children.push(new Paragraph({ text: "", spacing: { after: 60 } }));
      i = j; continue;
    }
  }

  // 引用 >
  if (trimmed.startsWith(">")) {
    let quoteText = trimmed.replace(/^>\s?/, "");
    let j = i + 1;
    while (j < lines.length && lines[j].trim().startsWith(">")) {
      quoteText += " " + lines[j].trim().replace(/^>\s?/, "");
      j++;
    }
    children.push(new Paragraph({
      children: parseInline(quoteText, { size: 20, color: "555555", italics: false }),
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: "4A90D9", space: 8 } },
      spacing: { before: 80, after: 80 },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F6FB" },
    }));
    i = j; continue;
  }

  // 无序列表 - / * / +
  const ulMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (ulMatch) {
    children.push(new Paragraph({
      children: parseInline(ulMatch[1], { size: 21 }),
      numbering: { reference: "bullet-list", level: 0 },
      spacing: { after: 40 },
    }));
    i++; continue;
  }

  // 有序列表 1. 2. ...
  const olMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
  if (olMatch) {
    children.push(new Paragraph({
      children: parseInline(olMatch[2], { size: 21 }),
      numbering: { reference: "number-list", level: 0 },
      spacing: { after: 40 },
    }));
    i++; continue;
  }

  // 普通段落（斜体整段 *...*）
  const isItalicPara = /^\*[^*].*[^*]\*$/.test(trimmed) && !trimmed.includes("**");
  children.push(new Paragraph({
    children: parseInline(isItalicPara ? trimmed.slice(1, -1) : trimmed, {
      size: 21,
      italics: isItalicPara,
      color: isItalicPara ? "777777" : undefined,
    }),
    spacing: { after: 100, line: 300 },
  }));
  i++;
}

// ---------- 文档组装 ----------
const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } },
        }],
      },
      {
        reference: "number-list",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480, hanging: 240 } } },
        }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: 21 } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4 竖版
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputFile, buffer);
  console.log("生成成功: " + outputFile + " (" + buffer.length + " bytes)");
}).catch(err => {
  console.error("生成失败:", err);
  process.exit(1);
});
