# -*- coding: utf-8 -*-
"""手动解析MonoBehaviour原始字节：m_Script PPtr在offset 16 (i64)"""
import UnityPy
import struct, os, re
from collections import defaultdict

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"
env = UnityPy.load(SRC)

script_names = {}
for obj in env.objects:
    if obj.type.name == "MonoScript":
        try:
            d = obj.read()
            script_names[obj.path_id] = str(d.m_Name)
        except Exception:
            pass

mbs = []
for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    raw = obj.get_raw_data()
    if len(raw) < 28:
        continue
    try:
        # 布局: m_GameObject(12) + m_Enabled(4) + m_Script(fileId@16, pathId@20, i64)
        spid = struct.unpack_from('<q', raw, 20)[0]
        # m_Name
        nlen = struct.unpack_from('<i', raw, 28)[0]
        mname = raw[32:32+max(0, min(nlen, 200))].decode('utf-8', 'replace') if 0 < nlen < 200 else ''
    except Exception:
        continue
    mbs.append((script_names.get(spid, f"unk_script_{spid}"), mname, raw, obj.path_id))

by_script = defaultdict(list)
for sn, mn, raw, pid in mbs:
    by_script[sn].append((mn, raw, pid))

def extract_strings(raw, skip=0):
    out = []
    p = skip
    end = len(raw)
    while p + 4 <= end:
        ln = struct.unpack_from('<i', raw, p)[0]
        if 0 < ln < 8192 and p + 4 + ln <= end:
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
        for i, (mn, raw, pid) in enumerate(lst):
            strs = extract_strings(raw)
            floats = []
            # 常见数值：跳过头部32字节后扫 f32
            for off in range(0, len(raw) - 4, 4):
                v = struct.unpack_from('<f', raw, off)[0]
                if v == v and abs(v) > 0.001 and abs(v) < 1e6 and (abs(v * 2) != int(abs(v * 2)) or 1):
                    floats.append(v)
            f.write(f"--- inst {i} pid={pid} name={mn!r} len={len(raw)} strings={strs[:40]}\n")
    summary.append((sn, len(lst), sum(len(x[1]) for x in lst)))

with open("mb_dump/_summary.txt", "w", encoding="utf-8") as f:
    for sn, cnt, sz in sorted(summary, key=lambda x: -x[2]):
        f.write(f"{cnt:4d} inst  {sz:8d} bytes  {sn}\n")
print("total MB parsed:", len(mbs), "scripts:", len(by_script))
for sn, cnt, sz in sorted(summary, key=lambda x: -x[2])[:25]:
    print(f"{cnt:4d}  {sz:8d}  {sn}")
