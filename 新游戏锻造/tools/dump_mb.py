# -*- coding: utf-8 -*-
"""转储全部MonoBehaviour原始数据，按脚本名归类，启发式解析其中的序列化字符串与浮点数"""
import UnityPy
import struct, os, re
from collections import defaultdict

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"
env = UnityPy.load(SRC)

script_names = {}
mbs = []
errors = 0
for obj in env.objects:
    if obj.type.name == "MonoScript":
        try:
            d = obj.read()
            script_names[obj.path_id] = str(d.m_Name)
        except Exception:
            pass

for obj in env.objects:
    if obj.type.name == "MonoScript":
        continue
    if obj.type.name != "MonoBehaviour":
        continue
    try:
        d = obj.read()
        sp = d.m_Script
        spid = getattr(sp, "path_id", None)
        raw = obj.get_raw_data()
        mname = str(getattr(d, "m_Name", "") or "")
        mbs.append((script_names.get(spid, f"unk_{spid}"), mname, raw))
    except Exception as e:
        errors += 1

print("MonoBehaviours:", len(mbs), "errors:", errors, "scripts:", len(script_names))
by_script = defaultdict(list)
for sn, mn, raw in mbs:
    by_script[sn].append((mn, raw))

# 启发式解析：Unity序列化中字符串为 <i32 len><utf8 bytes>，对齐到4
def extract_strings(raw, skip=0x18):
    out = []
    p = skip
    end = len(raw)
    while p + 4 <= end:
        ln = struct.unpack_from('<i', raw, p)[0]
        if 0 < ln < 4096 and p + 4 + ln <= end:
            try:
                s = raw[p+4:p+4+ln].decode('utf-8')
                if s and all(c.isprintable() or c in '\n\r\t' for c in s):
                    out.append(s)
                    p += 4 + ln
                    p = (p + 3) & ~3
                    continue
            except Exception:
                pass
        p += 4
    return out

os.makedirs("mb_dump", exist_ok=True)
summary = []
for sn, lst in sorted(by_script.items()):
    fn = "mb_dump/" + re.sub(r'[^\w.-]', '_', sn) + ".txt"
    with open(fn, "w", encoding="utf-8") as f:
        f.write(f"script: {sn}  instances: {len(lst)}\n\n")
        for i, (mn, raw) in enumerate(lst):
            f.write(f"--- instance {i} (name={mn!r}, {len(raw)} bytes) ---\n")
            strs = extract_strings(raw)
            if strs:
                f.write("strings: " + " | ".join(repr(s) for s in strs[:60]) + "\n")
    summary.append((sn, len(lst), sum(len(x[1]) for x in lst)))

with open("mb_dump/_summary.txt", "w", encoding="utf-8") as f:
    for sn, cnt, sz in sorted(summary, key=lambda x: -x[2]):
        f.write(f"{cnt:4d} inst  {sz:8d} bytes  {sn}\n")
print("dumped", len(summary), "scripts -> mb_dump/")
