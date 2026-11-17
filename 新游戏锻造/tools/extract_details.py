# -*- coding: utf-8 -*-
"""提取TextMesh文本、GameObject名称、AudioClip/Texture名称、MonoBehaviour详情"""
import UnityPy
import re
from collections import defaultdict

SRC = r"E:\SteamLibrary\steamapps\common\ForgeTax\ForgeTax_Data\data.unity3d"
env = UnityPy.load(SRC)

textmesh_texts = []
gameobjects = []
audio_names = []
tex_names = []
animclip_names = []
mono_by_script = defaultdict(int)   # script name -> count of MonoBehaviour instances
go_components = {}  # go name -> set of script names (only game scripts)

script_pid2name = {}
mono_instances = []  # (path_id, script_name)

def s(x):
    return x.decode('utf-8', 'replace') if isinstance(x, bytes) else str(x)

for obj in env.objects:
    t = obj.type.name
    try:
        if t == "TextMesh":
            d = obj.read()
            textmesh_texts.append((obj.path_id, s(getattr(d, "m_Text", ""))))
        elif t == "GameObject":
            d = obj.read()
            gameobjects.append((obj.path_id, s(d.m_Name)))
        elif t == "AudioClip":
            d = obj.read()
            audio_names.append(s(d.m_Name))
        elif t == "Texture2D":
            d = obj.read()
            tex_names.append(s(d.m_Name))
        elif t == "AnimationClip":
            d = obj.read()
            animclip_names.append(s(d.m_Name))
        elif t == "MonoScript":
            d = obj.read()
            script_pid2name[obj.path_id] = s(d.m_Name)
        elif t == "MonoBehaviour":
            d = obj.read()
            spid = getattr(d, "m_Script", None)
            spid = getattr(spid, "path_id", spid)
            mono_instances.append((obj.path_id, spid))
    except Exception:
        pass

for pid, spid in mono_instances:
    nm = script_pid2name.get(spid, f"?script_{spid}")
    mono_by_script[nm] += 1

with open("details.txt", "w", encoding="utf-8") as f:
    f.write("==== TextMesh texts (%d) ====\n" % len(textmesh_texts))
    for pid, txt in textmesh_texts:
        f.write(f"[{pid}] {txt!r}\n")
    f.write("\n==== GameObjects (%d, unique %d) ====\n" % (len(gameobjects), len(set(n for _, n in gameobjects))))
    uniq = sorted(set(n for _, n in gameobjects))
    for n in uniq:
        f.write(n + "\n")
    f.write("\n==== AudioClips (%d) ====\n" % len(audio_names))
    for n in sorted(set(audio_names)):
        f.write(n + "\n")
    f.write("\n==== Textures (%d) ====\n" % len(tex_names))
    for n in sorted(set(tex_names)):
        f.write(n + "\n")
    f.write("\n==== AnimationClips (%d) ====\n" % len(animclip_names))
    for n in sorted(set(animclip_names)):
        f.write(n + "\n")
    f.write("\n==== MonoBehaviour instance counts by script ====\n")
    for nm, c in sorted(mono_by_script.items(), key=lambda kv: -kv[1]):
        f.write(f"{c:5d}  {nm}\n")

print("TextMesh:", len(textmesh_texts), "| GO:", len(gameobjects),
      "| Audio:", len(set(audio_names)), "| Tex:", len(set(tex_names)),
      "| MB scripts:", len(mono_by_script))
