# -*- coding: utf-8 -*-
"""枚举 ForgeTax data.unity3d 中全部资源对象"""
import UnityPy
import json
from collections import Counter, defaultdict

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"

env = UnityPy.load(SRC)

type_counter = Counter()
names_by_type = defaultdict(list)
total = 0

for obj in env.objects:
    total += 1
    t = obj.type.name
    type_counter[t] += 1
    try:
        data = obj.read()
        name = getattr(data, "m_Name", "") or getattr(data, "name", "")
    except Exception as e:
        name = f"<read error: {type(e).__name__}>"
    names_by_type[t].append((obj.path_id, str(name)))

with open("asset_list.txt", "w", encoding="utf-8") as f:
    f.write(f"TOTAL OBJECTS: {total}\n\nTYPE SUMMARY:\n")
    for t, c in type_counter.most_common():
        f.write(f"  {t}: {c}\n")
    f.write("\n" + "=" * 60 + "\n\n")
    for t in sorted(names_by_type):
        f.write(f"### {t} ({type_counter[t]}) ###\n")
        for pid, name in names_by_type[t]:
            f.write(f"  [{pid}] {name}\n")
        f.write("\n")

print("done, total =", total)
print("types:", dict(type_counter.most_common(20)))
