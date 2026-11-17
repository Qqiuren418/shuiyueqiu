# -*- coding: utf-8 -*-
"""解码全部MonoBehaviour中的韩文字符串，输出到文件"""
import UnityPy, struct, re
from collections import defaultdict

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"
env = UnityPy.load(SRC)

script_names = {}
for obj in env.objects:
    if obj.type.name == "MonoScript":
        try:
            script_names[obj.path_id] = str(obj.read().m_Name)
        except Exception:
            pass

out = open("kr_all.txt", "w", encoding="utf-8")
for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    raw = obj.get_raw_data()
    if len(raw) < 28:
        continue
    spid = struct.unpack_from('<q', raw, 20)[0]
    sn = script_names.get(spid, "")
    nlen = struct.unpack_from('<i', raw, 28)[0]
    mname = raw[32:32+nlen].decode('utf-8','replace') if 0 < nlen < 200 else ''
    found = []
    p = 0
    while p + 4 <= len(raw):
        ln = struct.unpack_from('<i', raw, p)[0]
        if 1 <= ln < 600 and p + 4 + ln <= len(raw):
            chunk = raw[p+4:p+4+ln]
            try:
                s = chunk.decode('utf-8')
                if s and all(c.isprintable() or c in '\n\r\t' for c in s) and (re.search(r'[가-힣]', s) or (len(s) >= 3 and re.match(r'^[A-Za-z0-9 .:\-/!?,\'&%]+$', s) and sn.startswith(('Forge','GPT','Evolution','Dragon','Seafood','Funerary','World','Rune','Saw','Citadel')))):
                    found.append(s)
                    p += 4 + ((ln + 3) & ~3)
                    continue
            except Exception:
                pass
        p += 4
    if found:
        out.write(f"===== [{sn}] pid={obj.path_id} name={mname!r} =====\n")
        for s in found:
            out.write("  " + repr(s) + "\n")
out.close()
print("done")
