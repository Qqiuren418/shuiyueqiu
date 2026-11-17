# -*- coding: utf-8 -*-
"""从global-metadata.dat提取字符串（游戏文本/类名/字段名）"""
import re

data = open(r'E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\il2cpp_data\Metadata\global-metadata.dat', 'rb').read()

# 提取可读字符串：连续 >=4 的可打印 ASCII 或韩文/中文 UTF-8
ascii_re = re.compile(rb'[\x20-\x7e]{4,}')
korean_re = re.compile(rb'(?:[\xec-\xed][\x80-\xbf][\x80-\xbf])+(?:[\x20-\x7e]{0,30}(?:[\xec-\xed][\x80-\xbf][\x80-\xbf])+)*')

strings = set()
for m in ascii_re.finditer(data):
    strings.add(m.group().decode('ascii'))
korean = []
for m in korean_re.finditer(data):
    try:
        t = m.group().decode('utf-8')
        korean.append(t)
    except Exception:
        pass

with open('metadata_strings.txt', 'w', encoding='utf-8') as f:
    f.write("==== Korean strings (%d) ====\n" % len(korean))
    for t in sorted(set(korean)):
        f.write(t + "\n")
    f.write("\n==== ASCII strings (%d) ====\n" % len(strings))
    for t in sorted(strings):
        f.write(t + "\n")

print("korean:", len(set(korean)), "ascii:", len(strings))
