# -*- coding: utf-8 -*-
"""在global-metadata中按关键词开窗提取游戏文案上下文"""
import re, sys

data = open(r'E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\il2cpp_data\Metadata\global-metadata.dat', 'rb').read()

keywords = sys.argv[1:]
for kw in keywords:
    kb = kw.encode()
    out = []
    start = 0
    while True:
        i = data.find(kb, start)
        if i < 0:
            break
        lo = max(0, i - 400)
        hi = min(len(data), i + 700)
        chunk = data[lo:hi]
        # 只保留可打印+换行，其他替换为分隔
        txt = re.sub(rb'[^\x20-\x7e\x0a\xec-\xed\x80-\xbf]', b'\x01', chunk)
        txt = txt.replace(b'\x01', b'~')
        try:
            s = txt.decode('utf-8', 'replace')
        except Exception:
            s = str(txt)
        out.append(f"--- @ {i:#x} ({kw}) ---\n{s}\n")
        start = i + len(kb)
    with open(f"ctx_{re.sub(r'[^A-Za-z0-9]','_',kw)}.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(kw, "occurrences:", len(out))
