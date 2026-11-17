# -*- coding: utf-8 -*-
"""docx交付审计：zip完整性 + <w:t>纯文本关键词比对"""
import zipfile, re, sys

path = r"D:\Program Files\新游戏锻造\ForgeTax逆向设计文档.docx"

# 1) zip完整性
zf = zipfile.ZipFile(path)
bad = zf.testzip()
print("zip integrity:", "OK" if bad is None else f"BAD: {bad}")

# 2) 提取document.xml纯文本
xml = zf.read("word/document.xml").decode("utf-8")
texts = re.findall(r'<w:t[^>]*>([^<]*)</w:t>', xml)
full = "".join(texts)

# 3) 关键词审计
keywords = [
    "ForgeTax", "逆向设计文档", "巨龙", "Excalibur", "法夫纳", "Akasha",
    "以气驭剑", "锻造", "上贡", "遗物", "奖券", "幽灵商人", "Fever",
    "无尽门", "5月8日", "I wiped them all out", "run_release24_v1",
    "EvolutionCatalogue", "ForgeEnhancementBalance", "GPT6ForgeRoom",
    "成功", "大成功", "损伤", "破坏", "维持", "31", "30张", "三种遗物",
    "龙遭遇", "PhaseTwo", "处决", "复战", "利维坦", "稻草人", "排行榜",
    "存档", "成就", "9种语言", "Obfuz", "IL2CPP", "Unity", "URP",
    "单场景", "Burst", "遥测", "stockGrades", "cadence", "Excalibur",
    "蜡笔", "血条", "账簿", "票券", "无尽模式", "练习", "附录",
    "诚实声明", "Il2CppDumper", "46,150", "2,418", "616", "数据驱动",
]
missing = [k for k in keywords if k not in full]
print("text length:", len(full))
print("keywords checked:", len(keywords), "missing:", len(missing))
if missing:
    print("MISSING:", missing)
    sys.exit(1)
print("AUDIT PASS")
