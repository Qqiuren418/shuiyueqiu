using System;
using System.IO;
using LianQi.Core;
using UnityEngine;

namespace LianQi.Runtime
{
    public sealed class PrototypeController : MonoBehaviour
    {
        private ForgeGame game;
        private SaveStore saves;
        private float fuel = 0.5f;
        private double saveTimer;
        private string notice = "";
        private bool loadDecision;
        private bool saveBlocked;
        private bool confirmNew;
        private GUIStyle title, text, heading, small, button;
        private Font font;
        private readonly Vector2[] nodes = { new Vector2(28, 90), new Vector2(145, 32), new Vector2(145, 150), new Vector2(274, 90), new Vector2(397, 150), new Vector2(512, 90) };

        private void Awake()
        {
            Application.targetFrameRate = 60;
            game = new ForgeGame();
            string path = Path.Combine(Application.persistentDataPath, "PrototypeSnapshots");
            saves = new SaveStore(path, s => JsonUtility.ToJson(s), json => JsonUtility.FromJson<RunState>(json));
            try
            {
                SaveLoadResult loaded = saves.LoadLatest();
                notice = loaded.Message;
                if (loaded.State != null) game = new ForgeGame(loaded.State);
                else if (loaded.SkippedFiles > 0) loadDecision = true;
            }
            catch (Exception e) { loadDecision = true; notice = "存档读取失败，原文件保留：" + e.Message; }
        }
        private void Update()
        {
            if (game == null || loadDecision || saveBlocked || game.State.Paused || game.State.Stage != WorkStage.Heating) return;
            WorkStage previous = game.State.Stage;
            // Unscaled wall-clock time; pause is enforced by the core, not Time.timeScale.
            double remaining = Math.Min(Time.unscaledDeltaTime, Balance.HeatDuration - game.State.HeatElapsed);
            double frameTime = remaining;
            while (remaining > 0 && game.State.Stage == WorkStage.Heating)
            {
                double dt = Math.Min(remaining, 0.02);
                CommandResult result = game.AdvanceHeat(dt, fuel);
                if (!result.Ok) { notice = result.Message; break; }
                if (game.State.Stage != previous) notice = result.Message;
                remaining -= dt;
            }
            saveTimer += frameTime;
            if (game.State.Stage != previous || saveTimer >= 1) { Save(); saveTimer = 0; }
        }
        private void Save()
        {
            if (loadDecision) return;
            try { saves.Save(game.State); saveBlocked = false; }
            catch (Exception e)
            {
                saveBlocked = true; game.SetPaused(true);
                notice = "快照保存失败，已暂停以避免继续丢失进度。修复权限或磁盘空间后点击重试保存：" + e.Message;
            }
        }
        private void Do(Func<CommandResult> command)
        {
            if (loadDecision || saveBlocked) return;
            CommandResult result = command(); notice = result.Message;
            if (result.StateChanged) Save();
        }
        private void OnApplicationFocus(bool focus)
        {
            if (!focus && game != null && !loadDecision) { game.SetPaused(true); Save(); }
        }
        private void OnApplicationQuit() { if (game != null && !loadDecision) Save(); }
        private void EnsureStyles()
        {
            if (text != null) return;
            font = Font.CreateDynamicFontFromOSFont(new[] { "Microsoft YaHei", "SimHei", "Arial" }, 20);
            title = new GUIStyle(GUI.skin.label) { font = font, fontSize = 28, fontStyle = FontStyle.Bold, wordWrap = true };
            text = new GUIStyle(GUI.skin.label) { font = font, fontSize = 19, wordWrap = true };
            heading = new GUIStyle(text) { fontSize = 22, fontStyle = FontStyle.Bold };
            small = new GUIStyle(text) { fontSize = 16 };
            button = new GUIStyle(GUI.skin.button) { font = font, fontSize = 18, wordWrap = true };
        }
        private void OnGUI()
        {
            if (game == null) return;
            EnsureStyles();
            Matrix4x4 old = GUI.matrix;
            float scale = Mathf.Min(Screen.width / 1280f, Screen.height / 800f);
            Vector3 origin = new Vector3((Screen.width - 1280 * scale) / 2, (Screen.height - 800 * scale) / 2, 0);
            GUI.matrix = Matrix4x4.TRS(origin, Quaternion.identity, new Vector3(scale, scale, 1));
            GUI.Box(new Rect(20, 20, 304, 760), "");
            GUI.Box(new Rect(344, 20, 916, 116), "");
            GUI.Label(new Rect(366, 32, 870, 44), "炼器宗门 · 首单灰盒", title);
            GUI.Label(new Rect(366, 82, 870, 40), "" + StageName(game.State.Stage) + "  /  不含商业美术与Steam接入", small);
            DrawLedger();
            GUI.Box(new Rect(344, 348, 916, 432), "");
            if (loadDecision) DrawLoadDecision();
            else if (saveBlocked)
            {
                GUI.Label(new Rect(370, 372, 858, 190), notice, text);
                if (GUI.Button(new Rect(370, 584, 260, 44), "重试保存（不丢弃本局）", button)) Save();
            }
            else
            {
                GUI.enabled = !game.State.Paused;
                DrawStage();
                GUI.enabled = true;
                GUI.Label(new Rect(366, 700, 870, 68), notice, small);
            }
            GUI.matrix = old;
        }
        private void DrawLedger()
        {
            RunState s = game.State;
            GUI.Label(new Rect(40, 42, 264, 38), "没落宗门账簿", heading);
            GUI.Label(new Rect(40, 94, 264, 40), "灵石：" + s.Stones, text);
            GUI.Label(new Rect(40, 140, 264, 110), "青纹铁：" + s.Iron + "\n回元墨：" + s.Ink + "\n引灵银：" + s.Silver, text);
            GUI.Label(new Rect(40, 270, 264, 110), "聚火炉胆：" + s.FurnaceLevel + "级\n当前委托：灵田锄 #" + s.CurrentOrderId + "\n上一结算：#" + s.LastPaidOrderId, small);
            GUI.Label(new Rect(40, 400, 264, 110), "验收要求\n器胚≥60，阵纹≥70\n三块灵田总耗灵≤9", text);
            GUI.enabled = !loadDecision;
            if (GUI.Button(new Rect(40, 540, 264, 42), s.Paused ? "继续（失焦后需手动继续）" : "暂停", button))
            { game.SetPaused(!s.Paused); Save(); }
            if (GUI.Button(new Rect(40, 594, 264, 40), "手动保存快照", button)) Save();
            GUI.enabled = !loadDecision && !saveBlocked && (s.Stage == WorkStage.Commission || s.Stage == WorkStage.Delivered);
            if (GUI.Button(new Rect(40, 648, 264, 40), confirmNew ? "确认另开新局，旧档保留" : "另开新局（需再次确认）", button))
            {
                if (confirmNew) { game = new ForgeGame(); notice = "已另开新局，旧快照全部保留。"; confirmNew = false; Save(); }
                else confirmNew = true;
            }
            GUI.enabled = true;
            GUI.Label(new Rect(40, 714, 264, 50), s.Paused ? "已暂停：时间与交易冻结" : "鼠标操作 · 快照保存至本机", small);
        }
        private void DrawLoadDecision()
        {
            GUI.Label(new Rect(370, 370, 854, 180), notice + "\n未自动覆盖。可以保留旧档并开始新局，或退出后检查本机存档目录。", text);
            if (GUI.Button(new Rect(370, 575, 380, 46), "保留旧档，另开新局", button)) { loadDecision = false; game = new ForgeGame(); notice = "已另开新局，旧文件未修改。"; Save(); }
        }
        private void DrawStage()
        {
            RunState s = game.State;
            switch (s.Stage)
            {
                case WorkStage.Commission:
                    GUI.Label(new Rect(370, 372, 858, 116), "首份委托：省力灵田锄\n灵农的要求：连续翻三块灵田，不能浪费灵力，也不能用断纹或未成形的器胚交差。报酬24灵石。", text);
                    if (GUI.Button(new Rect(370, 514, 240, 46), "接下首单", button)) Do(game.AcceptOrder);
                    DrawMarket(596); break;
                case WorkStage.Planning:
                    GUI.Label(new Rect(370, 370, 850, 40), "选配方 → 确认投料。此步骤取消不扣材料。", text);
                    if (GUI.Button(new Rect(370, 425, 398, 46), (s.Route == ForgeRoute.Economy ? "已选 · " : "") + "省料直路：2铁＋1墨", button)) Do(() => game.SelectRoute(ForgeRoute.Economy));
                    if (GUI.Button(new Rect(788, 425, 444, 46), (s.Route == ForgeRoute.Silver ? "已选 · " : "") + "低耗回路：2铁＋1墨＋1银", button)) Do(() => game.SelectRoute(ForgeRoute.Silver));
                    GUI.Label(new Rect(370, 478, 854, 74), s.Route == ForgeRoute.Economy ? "补货成本14灵石，基础耗灵8。温区60—72，4个节点；少用材料，但失误耗灵余量较小。" : "补货成本18灵石，基础耗灵5。温区64—70，5个节点；多用引灵银，控火与刻纹更难，但耗灵余量较大。", small);
                    if (GUI.Button(new Rect(370, 560, 230, 42), "投料并开始控火", button)) Do(game.BeginHeat);
                    if (GUI.Button(new Rect(620, 560, 176, 42), "取消未投料订单", button)) Do(game.CancelOrder);
                    DrawMarket(628); break;
                case WorkStage.Heating:
                    double low, high; Balance.HeatBand(s.Route, s.FurnaceLevel, out low, out high);
                    GUI.Label(new Rect(370, 370, 840, 46), "控火：" + s.Temperature.ToString("F1") + " / 目标 " + low + "—" + high + " / 剩余 " + (12 - s.HeatElapsed).ToString("F1") + "秒", heading);
                    GUI.Label(new Rect(370, 426, 844, 74), "拉动风门升温；进目标区后降低风门保持。低于温区：材性未展开；高于温区：灵性流散。两种情况都损失合格时间。", small);
                    fuel = GUI.HorizontalSlider(new Rect(396, 524, 786, 30), fuel, 0, 1);
                    GUI.Label(new Rect(370, 570, 820, 40), "风门 " + Mathf.RoundToInt(fuel * 100) + "% · 合格时间 " + s.TimeInBand.ToString("F1") + "秒 / 12秒", text);
                    GUI.Label(new Rect(370, 622, 824, 50), "首次练习允许免费返工。暂停、失焦时不计时。", small); break;
                case WorkStage.Engraving:
                    GUI.Label(new Rect(370, 365, 838, 42), "刻纹：器胚" + s.HeatScore + "分 / 阵纹完整度" + s.InkIntegrity + "%", heading);
                    GUI.Label(new Rect(370, 412, 850, 48), "依亮起的下一节点连接。错误只扣完整度，不推进；此版验证路径顺序，尚非手绘刻纹。", small);
                    Vector2 offset = new Vector2(414, 465);
                    for (int i = 0; i < Balance.NodeCount(s.Route) - 1; i++)
                        Line(offset + nodes[Balance.NodeAt(s.Route, i)], offset + nodes[Balance.NodeAt(s.Route, i + 1)], i < s.RuneProgress - 1 ? new Color(0.25f, 0.8f, 0.65f) : new Color(0.55f, 0.55f, 0.55f));
                    for (int i = 0; i < nodes.Length; i++)
                    {
                        Color previous = GUI.backgroundColor;
                        if (i == Balance.NodeAt(s.Route, s.RuneProgress)) GUI.backgroundColor = new Color(1, 0.58f, 0.22f);
                        if (GUI.Button(new Rect(offset.x + nodes[i].x - 25, offset.y + nodes[i].y - 20, 52, 42), (i + 1).ToString(), button)) Do(() => game.TraceNode(i));
                        GUI.backgroundColor = previous;
                        if (game.State.Stage != WorkStage.Engraving) break;
                    }
                    break;
                case WorkStage.Trial:
                    GUI.Label(new Rect(370, 372, 854, 92), "试器台 · 三块灵田\n器胚分数：" + s.HeatScore + " / 阵纹完整度：" + s.InkIntegrity + " / " + (s.TrialTested ? "总耗灵：" + s.TrialEnergy + "，" + (s.TrialPassed ? "验收合格" : "验收不合格") : "尚未试器"), text);
                    if (GUI.Button(new Rect(370, 494, 224, 44), "连续翻三块田：试器", button)) Do(game.TestArtifact);
                    if (GUI.Button(new Rect(612, 494, 222, 44), "免费返工（重算工艺）", button)) Do(game.Rework);
                    GUI.enabled = GUI.enabled && s.TrialTested && s.TrialPassed;
                    if (GUI.Button(new Rect(852, 494, 238, 44), "交货＋24灵石", button)) Do(game.Deliver);
                    GUI.enabled = !game.State.Paused;
                    GUI.Label(new Rect(370, 560, 834, 84), "耗灵＝路线基础耗灵＋(100−器胚分)÷20取整＋(100−阵纹完整度)÷25取整。三项条件均满足才可交货。", small); break;
                case WorkStage.Delivered:
                    GUI.Label(new Rect(370, 372, 850, 94), "首单已结算。报酬只发放一次。\n接下来修复聚火炉胆，或用相同委托复单练习；不会把未实装的后续委托当作已完成。", text);
                    if (GUI.Button(new Rect(370, 495, 418, 46), "40灵石修炉胆：温区两边各＋4", button)) Do(game.UpgradeFurnace);
                    if (GUI.Button(new Rect(806, 495, 426, 46), "接复单练习（同一器图的新订单）", button)) Do(game.AcceptRepeatOrder);
                    DrawMarket(595); break;
            }
        }
        private void DrawMarket(float y)
        {
            GUI.Label(new Rect(370, y - 28, 830, 28), "采购每次1份：失败不扣款；只在接单前、投料前和交货后开放。", small);
            if (GUI.Button(new Rect(370, y, 254, 40), "青纹铁 · 6灵石", button)) Do(() => game.Buy(MaterialKind.Iron));
            if (GUI.Button(new Rect(638, y, 254, 40), "回元墨 · 2灵石", button)) Do(() => game.Buy(MaterialKind.Ink));
            if (GUI.Button(new Rect(906, y, 306, 40), "引灵银 · 4灵石", button)) Do(() => game.Buy(MaterialKind.Silver));
        }
        private static void Line(Vector2 from, Vector2 to, Color color)
        {
            Matrix4x4 before = GUI.matrix; Color previous = GUI.color;
            GUI.color = color; GUIUtility.RotateAroundPivot(Vector2.SignedAngle(Vector2.right, to - from), from);
            GUI.DrawTexture(new Rect(from.x, from.y, (to - from).magnitude, 3), Texture2D.whiteTexture);
            GUI.matrix = before; GUI.color = previous;
        }
        private static string StageName(WorkStage stage)
        {
            switch (stage) { case WorkStage.Commission: return "查看委托"; case WorkStage.Planning: return "选材料方案"; case WorkStage.Heating: return "控火"; case WorkStage.Engraving: return "连接阵纹"; case WorkStage.Trial: return "试器 / 返工 / 交付"; default: return "结算 / 升级"; }
        }
    }
}
