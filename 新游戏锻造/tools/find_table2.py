# -*- coding: utf-8 -*-
"""用锚点定位stringLiteral表，精确枚举全部字面量"""
import struct

data = open(r'E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\il2cpp_data\Metadata\global-metadata.dat', 'rb').read()
N = len(data)
apos = 157487  # 'You little runt'

# 扫描文件中 (u32 off, u32 len) 对，off 指向锚点附近区域
cands = []
p = 0
while True:
    # 找 u32 == apos±x 的位置太慢，改为：在头部长度范围内找值接近apos的u32
    break

# 直接法：扫描全文件中的 u32 值 v，满足 v < apos < v+0x100000，收集其位置
# 只扫前 0x40000（表应在头部声明区域附近）之外也可能。全扫 6MB 也快。
positions = []
import array
u32 = array.array('I')
u32.frombytes(data[:N - (N % 4)])
for i, v in enumerate(u32):
    if apos - 0x100 < v <= apos and v % 1 == 0:
        positions.append((i * 4, v))
print("positions pointing near anchor:", len(positions))
# 打印前20个候选
for pos, v in positions[:20]:
    print(hex(pos), v, "delta:", apos - v)
