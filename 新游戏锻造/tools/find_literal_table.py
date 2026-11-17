# -*- coding: utf-8 -*-
"""经验式定位global-metadata的stringLiteral表并精确切分字面量"""
import struct

data = open(r'E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\il2cpp_data\Metadata\global-metadata.dat', 'rb').read()
N = len(data)

# 1) 找一个游戏内独有的字符串作为锚点
anchor = b"THE DRAGON TAKES HIS DUE"
apos = data.find(anchor)
print("anchor at:", apos)

# 2) 假设字面量数据区起点在锚点之前不远。扫描文件前 64KB，找指向数据区附近的 (offset,size) 对
# 字面量数据区大致范围估计：锚点前后。尝试寻找表：由连续的 (u32 off, u32 len) 组成，
# off单调不减，且 off+len <= N，且能覆盖锚点。
best = None
hdr_end = min(0x20000, N)
# 先找数据区起点：往前找大片非ASCII(韩文/UTF8)或已知engine字符串起点难；改用 brute force:
# 对每个候选表起点 ts in 前面区域，检查连续 100 个 (u32,u32) 是否单调、合理
import sys
def try_table(ts, count=200):
    offs = []
    ok = True
    p = ts
    for i in range(count):
        o, l = struct.unpack_from('<II', data, p + i * 8)
        if o >= N or l > 4000 or l == 0 and o == 0:
            ok = False
            break
        offs.append((o, l))
    if not ok or len(offs) < count:
        return None
    mono = all(offs[i][0] + offs[i][1] <= offs[i+1][0] + 64 for i in range(len(offs)-1))
    return offs if mono else None

# 在头部之后到锚点之间搜索可能的表位置
# 表通常在文件前部。扫描步长4字节太大→用启发：找第一个指向锚点±0x100000 内的u32对
hits = []
for p in range(0, hdr_end, 4):
    o, l = struct.unpack_from('<II', data, p)
    if apos - 0x200000 < o <= apos and 0 < l < 200 and o + l <= N:
        t = try_table(p - 8 * 500)  # 表可能从更早开始
        if t:
            hits.append((p, len(t)))
            if len(hits) > 3:
                break
print("candidate hits:", hits[:5])
