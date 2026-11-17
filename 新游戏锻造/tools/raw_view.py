# -*- coding: utf-8 -*-
"""按脚本名导出MonoBehaviour原始数据的hex+数值视图"""
import UnityPy, struct, sys

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
out_lines = []
for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    raw = obj.get_raw_data()
    if len(raw) < 28:
        continue
    spid = struct.unpack_from('<q', raw, 20)[0]
    sn = script_names.get(spid, "")
    if sn != target:
        continue
    nlen = struct.unpack_from('<i', raw, 28)[0]
    mname = raw[32:32+nlen].decode('utf-8','replace') if 0 < nlen < 200 else ''
    out_lines.append(f"===== pid={obj.path_id} name={mname!r} len={len(raw)} =====")
    # 数据区从 m_Name 对齐后开始
    body_off = 32 + max(0, nlen)
    body_off = (body_off + 3) & ~3
    for off in range(body_off, len(raw) - 3, 4):
        i32v = struct.unpack_from('<i', raw, off)[0]
        f32v = struct.unpack_from('<f', raw, off)[0]
        f32s = f"{f32v:.4g}" if (f32v == f32v and abs(f32v) < 1e9) else "   -   "
        out_lines.append(f"  +{off-body_off:04x}  {i32v:>10d}  0x{i32v & 0xffffffff:08x}  f:{f32s}")

with open(f"mb_dump/{target}_raw.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out_lines))
print(f"wrote {len(out_lines)} lines for {target}")
