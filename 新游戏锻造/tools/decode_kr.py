# -*- coding: utf-8 -*-
"""解码MonoBehaviour中的韩文字符串（带上下文整数）"""
import UnityPy, struct, sys, re

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"
env = UnityPy.load(SRC)

script_names = {}
for obj in env.objects:
    if obj.type.name == "MonoScript":
        try:
            script_names[obj.path_id] = str(obj.read().m_Name)
        except Exception:
            pass

target = sys.argv[1]
korean_run = re.compile(rb'(?:[\xe0-\xef][\x80-\xbf][\x80-\xbf]){2,}[ -~\xe0-\xef\x80-\xbf]{0,80}')

for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    raw = obj.get_raw_data()
    if len(raw) < 28:
        continue
    spid = struct.unpack_from('<q', raw, 20)[0]
    if script_names.get(spid, "") != target:
        continue
    nlen = struct.unpack_from('<i', raw, 28)[0]
    mname = raw[32:32+nlen].decode('utf-8','replace') if 0 < nlen < 200 else ''
    print(f"===== pid={obj.path_id} name={mname!r} len={len(raw)} =====")
    # 扫描长度前缀字符串: <i32 len><bytes>
    p = 0
    while p + 4 <= len(raw):
        ln = struct.unpack_from('<i', raw, p)[0]
        if 1 <= ln < 300 and p + 4 + ln <= len(raw):
            chunk = raw[p+4:p+4+ln]
            try:
                s = chunk.decode('utf-8')
                if s and all(c.isprintable() or c in '\n\r\t' for c in s) and (re.search(r'[가-힣]', s) or len(s) > 2):
                    ctx = struct.unpack_from('<8i', raw, max(0, p-32)) if p >= 32 else ()
                    print(f"  @{p:#06x} len={ln:3d} {s!r}")
                    p += 4 + ((ln + 3) & ~3)
                    continue
            except Exception:
                pass
        p += 4
