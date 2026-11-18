using System;

namespace LianQi.Core
{
    public enum WorkStage { Commission, Planning, Heating, Engraving, Trial, Delivered }
    public enum ForgeRoute { Economy, Silver }
    public enum MaterialKind { Iron, Ink, Silver }

    public static class Balance
    {
        public const int SchemaVersion = 1;
        public const double HeatDuration = 12.0;
        public const int Reward = 24;
        public const int UpgradeCost = 40;
        public const int MinHeatScore = 60;
        public const int MinIntegrity = 70;
        public const int EnergyBudget = 9;
        private static readonly int[] EconomyNodes = { 0, 1, 3, 5 };
        private static readonly int[] SilverNodes = { 0, 2, 3, 4, 5 };
        public static int NodeCount(ForgeRoute route) { return route == ForgeRoute.Economy ? 4 : 5; }
        public static int NodeAt(ForgeRoute route, int index)
        {
            if (index < 0 || index >= NodeCount(route)) throw new ArgumentOutOfRangeException("index");
            return route == ForgeRoute.Economy ? EconomyNodes[index] : SilverNodes[index];
        }
        public static int MaterialPrice(MaterialKind material)
        {
            switch (material) { case MaterialKind.Iron: return 6; case MaterialKind.Ink: return 2; case MaterialKind.Silver: return 4; default: throw new ArgumentOutOfRangeException("material"); }
        }
        public static int MaterialNeed(ForgeRoute route, MaterialKind material)
        {
            switch (material) { case MaterialKind.Iron: return 2; case MaterialKind.Ink: return 1; case MaterialKind.Silver: return route == ForgeRoute.Silver ? 1 : 0; default: throw new ArgumentOutOfRangeException("material"); }
        }
        public static int BaseEnergy(ForgeRoute route) { return route == ForgeRoute.Economy ? 8 : 5; }
        public static int Integrity(int mistakes) { return Math.Max(0, 100 - mistakes * 20); }
        public static int HeatScore(double inBand) { return (int)Math.Floor(100.0 * inBand / HeatDuration + 0.5); }
        public static int Energy(int heatScore, int integrity, ForgeRoute route)
        {
            return BaseEnergy(route) + (100 - heatScore) / 20 + (100 - integrity) / 25;
        }
        public static void HeatBand(ForgeRoute route, int furnaceLevel, out double low, out double high)
        {
            low = route == ForgeRoute.Economy ? 60 : 64;
            high = route == ForgeRoute.Economy ? 72 : 70;
            if (furnaceLevel == 1) { low -= 4; high += 4; }
        }
        public static bool Finite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    }

    [Serializable]
    public sealed class RunState
    {
        public int Schema = Balance.SchemaVersion;
        public WorkStage Stage = WorkStage.Commission;
        public ForgeRoute Route = ForgeRoute.Economy;
        public int Stones = 30;
        public int Iron = 4;
        public int Ink = 6;
        public int Silver = 3;
        public int FurnaceLevel;
        public int CurrentOrderId = 1;
        public int LastPaidOrderId;
        public bool MaterialsCommitted;
        public double Temperature = 40;
        public double HeatElapsed;
        public double TimeInBand;
        public int HeatScore;
        public int RuneProgress;
        public int RuneMistakes;
        public int InkIntegrity = 100;
        public bool TrialTested;
        public bool TrialPassed;
        public int TrialEnergy;
        public bool Paused;

        public RunState Copy() { return (RunState)MemberwiseClone(); }
        public int Quantity(MaterialKind kind)
        {
            switch (kind) { case MaterialKind.Iron: return Iron; case MaterialKind.Ink: return Ink; case MaterialKind.Silver: return Silver; default: throw new ArgumentOutOfRangeException("kind"); }
        }
        internal void Add(MaterialKind kind, int amount)
        {
            switch (kind) { case MaterialKind.Iron: Iron += amount; break; case MaterialKind.Ink: Ink += amount; break; case MaterialKind.Silver: Silver += amount; break; default: throw new ArgumentOutOfRangeException("kind"); }
        }
    }

    public sealed class CommandResult
    {
        public bool Ok { get; private set; }
        public bool StateChanged { get; private set; }
        public string Message { get; private set; }
        private CommandResult(bool ok, bool changed, string message) { Ok = ok; StateChanged = changed; Message = message; }
        public static CommandResult Success(string message) { return new CommandResult(true, true, message); }
        public static CommandResult Fail(string message) { return new CommandResult(false, false, message); }
        public static CommandResult ChangedFailure(string message) { return new CommandResult(false, true, message); }
    }

    public sealed class ForgeGame
    {
        public RunState State { get; private set; }
        public ForgeGame() { State = new RunState(); }
        public ForgeGame(RunState snapshot)
        {
            string error;
            if (!Validate(snapshot, out error)) throw new ArgumentException(error, "snapshot");
            State = snapshot.Copy();
        }
        private bool Available(WorkStage stage) { return !State.Paused && State.Stage == stage; }
        private CommandResult WrongStage() { return CommandResult.Fail("当前步骤或暂停状态不允许此操作。"); }
        public void SetPaused(bool paused) { State.Paused = paused; }
        public CommandResult AcceptOrder()
        {
            if (!Available(WorkStage.Commission)) return WrongStage();
            State.Stage = WorkStage.Planning;
            return CommandResult.Success("已接单：为灵农制作省力灵田锄。试器总耗灵不超过9，器胚与阵纹均需合格。");
        }
        public CommandResult SelectRoute(ForgeRoute route)
        {
            if (!Available(WorkStage.Planning) || !Enum.IsDefined(typeof(ForgeRoute), route)) return WrongStage();
            State.Route = route;
            return CommandResult.Success(route == ForgeRoute.Economy ? "省料直路：少用引灵银，耗灵余量较小。" : "低耗灵回路：多用引灵银，火候窗口更窄、刻纹更长，验收耗灵余量更大。");
        }
        public CommandResult CancelOrder()
        {
            if (!Available(WorkStage.Planning)) return WrongStage();
            State.Stage = WorkStage.Commission;
            return CommandResult.Success("已取消尚未投料的委托，库存未改变。");
        }
        public CommandResult Buy(MaterialKind material)
        {
            if (State.Paused || (State.Stage != WorkStage.Commission && State.Stage != WorkStage.Planning && State.Stage != WorkStage.Delivered)) return WrongStage();
            if (!Enum.IsDefined(typeof(MaterialKind), material)) return CommandResult.Fail("无效材料。");
            int price = Balance.MaterialPrice(material);
            if (State.Stones < price || State.Quantity(material) >= 1000000) return CommandResult.Fail("灵石不足或库存已达上限，未发生交易。");
            State.Stones -= price;
            State.Add(material, 1);
            return CommandResult.Success("采购完成，只购买1份材料。");
        }
        public CommandResult BeginHeat()
        {
            if (!Available(WorkStage.Planning)) return WrongStage();
            foreach (MaterialKind kind in Enum.GetValues(typeof(MaterialKind)))
                if (State.Quantity(kind) < Balance.MaterialNeed(State.Route, kind)) return CommandResult.Fail("材料不足，所有材料均未扣除。");
            foreach (MaterialKind kind in Enum.GetValues(typeof(MaterialKind))) State.Add(kind, -Balance.MaterialNeed(State.Route, kind));
            State.MaterialsCommitted = true;
            ResetWork();
            State.Stage = WorkStage.Heating;
            return CommandResult.Success("投料完成。12秒控火已开始；首版免费返工，不会重复扣料。");
        }
        private void ResetWork()
        {
            State.Temperature = 40; State.HeatElapsed = 0; State.TimeInBand = 0; State.HeatScore = 0;
            State.RuneProgress = 0; State.RuneMistakes = 0; State.InkIntegrity = 100;
            State.TrialTested = false; State.TrialPassed = false; State.TrialEnergy = 0;
        }
        public CommandResult AdvanceHeat(double seconds, double fuel)
        {
            if (!Available(WorkStage.Heating)) return WrongStage();
            if (!Balance.Finite(seconds) || !Balance.Finite(fuel) || seconds <= 0 || seconds > 0.25 || fuel < 0 || fuel > 1)
                return CommandResult.Fail("控火参数无效，单步时间须在(0,0.25]，风门须在[0,1]。");
            double dt = Math.Min(seconds, Balance.HeatDuration - State.HeatElapsed);
            double next = Math.Max(0, Math.Min(100, State.Temperature + (28 * fuel - 0.16 * (State.Temperature - 20)) * dt));
            double low, high; Balance.HeatBand(State.Route, State.FurnaceLevel, out low, out high);
            // Exact overlap for this linear integration step, not endpoint-only sampling.
            double fraction = 0;
            if (Math.Abs(next - State.Temperature) < 1e-12)
                fraction = State.Temperature >= low && State.Temperature <= high ? 1 : 0;
            else
            {
                double a = (low - State.Temperature) / (next - State.Temperature);
                double b = (high - State.Temperature) / (next - State.Temperature);
                fraction = Math.Max(0, Math.Min(1, Math.Max(a, b)) - Math.Max(0, Math.Min(a, b)));
            }
            State.TimeInBand += dt * fraction;
            State.Temperature = next;
            State.HeatElapsed = Math.Min(Balance.HeatDuration, State.HeatElapsed + dt);
            if (State.HeatElapsed >= Balance.HeatDuration - 1e-9)
            {
                State.HeatElapsed = Balance.HeatDuration;
                State.HeatScore = Balance.HeatScore(State.TimeInBand);
                State.Stage = WorkStage.Engraving;
                return CommandResult.Success("控火结束，器胚分数：" + State.HeatScore + "。请依次连接阵纹节点。");
            }
            return CommandResult.Success("控火进行中。");
        }
        public CommandResult TraceNode(int node)
        {
            if (!Available(WorkStage.Engraving)) return WrongStage();
            if (node < 0 || node > 5) return CommandResult.Fail("不存在的阵纹节点，未扣分。");
            if (node != Balance.NodeAt(State.Route, State.RuneProgress))
            {
                State.RuneMistakes = Math.Min(20, State.RuneMistakes + 1);
                State.InkIntegrity = Balance.Integrity(State.RuneMistakes);
                return CommandResult.ChangedFailure("连错节点，路径未推进，阵纹完整度降低20；可在试器后免费返工。");
            }
            State.RuneProgress++;
            if (State.RuneProgress == Balance.NodeCount(State.Route)) State.Stage = WorkStage.Trial;
            return CommandResult.Success(State.Stage == WorkStage.Trial ? "刻纹完成，进入试器。" : "节点连接正确。");
        }
        public CommandResult TestArtifact()
        {
            if (!Available(WorkStage.Trial)) return WrongStage();
            State.TrialEnergy = Balance.Energy(State.HeatScore, State.InkIntegrity, State.Route);
            State.TrialTested = true;
            State.TrialPassed = State.HeatScore >= Balance.MinHeatScore && State.InkIntegrity >= Balance.MinIntegrity && State.TrialEnergy <= Balance.EnergyBudget;
            return CommandResult.Success(State.TrialPassed ? "三块灵田试器合格，可交货。" : "未通过验收。请检查器胚分数、阵纹完整度与总耗灵；可免费返工。");
        }
        public CommandResult Rework()
        {
            if (!Available(WorkStage.Trial)) return WrongStage();
            ResetWork(); State.Stage = WorkStage.Heating;
            return CommandResult.Success("保留器胚与材料，重新控火和刻纹。此次成绩完全重算。");
        }
        public CommandResult Deliver()
        {
            if (!Available(WorkStage.Trial) || !State.TrialTested || !State.TrialPassed) return CommandResult.Fail("尚未通过试器，不可交付。");
            if (State.LastPaidOrderId >= State.CurrentOrderId || State.Stones > 1000000000 - Balance.Reward) return CommandResult.Fail("此订单已结算或余额达到上限，未发放报酬。");
            State.Stones += Balance.Reward; State.LastPaidOrderId = State.CurrentOrderId; State.Stage = WorkStage.Delivered;
            return CommandResult.Success("交货完成，获得24灵石；订单不会重复结算。");
        }
        public CommandResult UpgradeFurnace()
        {
            if (!Available(WorkStage.Delivered)) return WrongStage();
            if (State.FurnaceLevel != 0 || State.Stones < Balance.UpgradeCost) return CommandResult.Fail("炉胆已升级或灵石不足，未扣费。");
            State.Stones -= Balance.UpgradeCost; State.FurnaceLevel = 1;
            return CommandResult.Success("修复聚火炉胆：两条路线的目标温区上下各扩大4，下一次炼制立即生效。");
        }
        public CommandResult AcceptRepeatOrder()
        {
            if (!Available(WorkStage.Delivered) || State.CurrentOrderId >= 999999) return WrongStage();
            State.CurrentOrderId++; State.MaterialsCommitted = false; ResetWork(); State.Stage = WorkStage.Planning;
            return CommandResult.Success("开始复单练习，沿用灵田锄的配方与验收。护身器和旧器修复尚未实装。");
        }
        public static bool Validate(RunState s, out string error)
        {
            error = "";
            if (s == null || s.Schema != Balance.SchemaVersion) { error = "存档为空或版本不支持。"; return false; }
            if (!Enum.IsDefined(typeof(WorkStage), s.Stage) || !Enum.IsDefined(typeof(ForgeRoute), s.Route)) { error = "非法流程状态。"; return false; }
            if (s.Stones < 0 || s.Stones > 1000000000 || s.Iron < 0 || s.Iron > 1000000 || s.Ink < 0 || s.Ink > 1000000 || s.Silver < 0 || s.Silver > 1000000 || s.FurnaceLevel < 0 || s.FurnaceLevel > 1) { error = "余额、库存或炉胆等级越界。"; return false; }
            if (s.CurrentOrderId < 1 || s.CurrentOrderId > 999999 || s.LastPaidOrderId < 0 || s.LastPaidOrderId > s.CurrentOrderId || (s.Stage == WorkStage.Delivered ? s.LastPaidOrderId != s.CurrentOrderId : s.LastPaidOrderId != s.CurrentOrderId - 1)) { error = "订单结算编号不一致。"; return false; }
            if (!Balance.Finite(s.Temperature) || s.Temperature < 0 || s.Temperature > 100 || !Balance.Finite(s.HeatElapsed) || s.HeatElapsed < 0 || s.HeatElapsed > Balance.HeatDuration || !Balance.Finite(s.TimeInBand) || s.TimeInBand < 0 || s.TimeInBand > s.HeatElapsed + 1e-8) { error = "控火记录非法。"; return false; }
            bool invested = s.Stage >= WorkStage.Heating;
            if (s.MaterialsCommitted != invested || s.RuneMistakes < 0 || s.RuneMistakes > 20 || s.InkIntegrity != Balance.Integrity(s.RuneMistakes) || s.RuneProgress < 0 || s.RuneProgress > Balance.NodeCount(s.Route)) { error = "投料或阵纹记录不一致。"; return false; }
            if (s.Stage <= WorkStage.Planning && (s.HeatElapsed != 0 || s.TimeInBand != 0 || s.RuneProgress != 0 || s.RuneMistakes != 0 || s.TrialTested || s.TrialPassed || s.TrialEnergy != 0)) { error = "投料前不应有工艺结果。"; return false; }
            if (s.Stage == WorkStage.Heating && (s.HeatElapsed >= Balance.HeatDuration || s.RuneProgress != 0 || s.RuneMistakes != 0 || s.HeatScore != 0)) { error = "控火阶段记录不一致。"; return false; }
            if (s.Stage < WorkStage.Engraving && s.HeatScore != 0) { error = "未完成控火却存在分数。"; return false; }
            if (s.Stage >= WorkStage.Engraving && (s.HeatElapsed != Balance.HeatDuration || s.HeatScore != Balance.HeatScore(s.TimeInBand) || s.HeatScore < 0 || s.HeatScore > 100)) { error = "器胚分数与控火记录不一致。"; return false; }
            if (s.Stage == WorkStage.Engraving && s.RuneProgress >= Balance.NodeCount(s.Route)) { error = "刻纹完成后未进入试器。"; return false; }
            if (s.Stage >= WorkStage.Trial && s.RuneProgress != Balance.NodeCount(s.Route)) { error = "未完成阵纹却进入验收。"; return false; }
            if (s.Stage < WorkStage.Trial && (s.TrialTested || s.TrialPassed || s.TrialEnergy != 0)) { error = "试器发生在错误阶段。"; return false; }
            if (!s.TrialTested && (s.TrialPassed || s.TrialEnergy != 0)) { error = "未试器却存在结果。"; return false; }
            if (s.TrialTested)
            {
                int energy = Balance.Energy(s.HeatScore, s.InkIntegrity, s.Route);
                bool pass = s.HeatScore >= Balance.MinHeatScore && s.InkIntegrity >= Balance.MinIntegrity && energy <= Balance.EnergyBudget;
                if (s.TrialEnergy != energy || s.TrialPassed != pass) { error = "试器结果与工艺记录不一致。"; return false; }
            }
            if (s.Stage == WorkStage.Delivered && (!s.TrialTested || !s.TrialPassed)) { error = "未通过验收却已交货。"; return false; }
            return true;
        }
    }
}
