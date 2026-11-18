using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using LianQi.Core;

namespace LianQi.Verification
{
    internal sealed class TestResult
    {
        public string Name;
        public bool Passed;
        public int Assertions;
        public string Error;
        public string Reproduction;
        public string SuggestedFix;
    }

    internal static class ConsoleTests
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly List<TestResult> Results = new List<TestResult>();
        private static readonly List<string> Output = new List<string>();
        private static readonly FieldInfo[] StateFields = typeof(RunState).GetFields(BindingFlags.Public | BindingFlags.Instance);
        private static string RunDirectory;
        private static int AssertionCount;
        private static int RandomSteps;
        private static int RandomDeliveries;
        private static readonly Dictionary<string, int> HeatScores = new Dictionary<string, int>();

        public static int Main(string[] args)
        {
            try
            {
                if (args.Length != 2) throw new ArgumentException("Usage: ConsoleTests.exe <unique-run-directory> <compiler-path>");
                RunDirectory = Path.GetFullPath(args[0]);
                if (!Directory.Exists(RunDirectory)) throw new DirectoryNotFoundException(RunDirectory);
                if (File.Exists(Path.Combine(RunDirectory, "core_test_results.json")) || File.Exists(Path.Combine(RunDirectory, "core_test_output.txt")))
                    throw new IOException("Refusing to overwrite reports. Use a new unique run directory.");
                Log("Direct product-source tests; no Unity, NUnit, downloads, or alternate model.");
                Log("Compiler: " + args[1]);
                Log("Artifacts: " + RunDirectory);
                TestHeating();
                TestInventory();
                TestEngravingAndTrial();
                TestPauseAndOrders();
                TestValidation();
                TestPersistence();
                TestRandomFlow();
                int passed = Results.FindAll(delegate(TestResult r) { return r.Passed; }).Count;
                Log(string.Format(CultureInfo.InvariantCulture, "TOTAL {0}; PASS {1}; FAIL {2}; ASSERTIONS {3}; RANDOM_STEPS {4}; RANDOM_DELIVERIES {5}",
                    Results.Count, passed, Results.Count - passed, AssertionCount, RandomSteps, RandomDeliveries));
                var report = new
                {
                    suite = "LianQi V0.1 direct C# core verification",
                    utc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                    compiler = args[1],
                    runtime = Environment.Version.ToString(),
                    processBits = IntPtr.Size * 8,
                    status = "executed",
                    plannedCases = 187,
                    total = Results.Count,
                    passed = passed,
                    failed = Results.Count - passed,
                    assertions = AssertionCount,
                    randomSeed = 20261118,
                    randomSteps = RandomSteps,
                    randomDeliveries = RandomDeliveries,
                    idealHeatScores = HeatScores,
                    artifactDirectory = RunDirectory,
                    results = Results,
                    productDefects = Results.FindAll(delegate(TestResult r) { return !r.Passed; })
                };
                WriteNew(Path.Combine(RunDirectory, "core_test_results.json"), Json.Serialize(report));
                WriteNew(Path.Combine(RunDirectory, "core_test_output.txt"), string.Join(Environment.NewLine, Output.ToArray()) + Environment.NewLine);
                return passed == Results.Count ? 0 : 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("HARNESS ERROR: " + ex);
                return 2;
            }
        }

        private static void Log(string text) { Output.Add(text); Console.WriteLine(text); }
        private static void Test(string name, Action body, string reproduction, string suggestedFix)
        {
            int start = AssertionCount;
            TestResult result = new TestResult { Name = name, Reproduction = reproduction, SuggestedFix = suggestedFix };
            try { body(); result.Passed = true; }
            catch (Exception ex) { result.Error = ex.GetType().Name + ": " + ex.Message; }
            result.Assertions = AssertionCount - start;
            Results.Add(result);
            Log((result.Passed ? "PASS " : "FAIL ") + name + " [assertions=" + result.Assertions + "]" + (result.Passed ? "" : " " + result.Error));
            if (!result.Passed) { Log("  Reproduction: " + reproduction); Log("  Suggested fix (not applied): " + suggestedFix); }
        }
        private static void Test(string name, Action body)
        {
            Test(name, body, "Run case '" + name + "' in Tests/ConsoleTests.cs against the original ForgeGame.cs and SaveStore.cs.",
                "Inspect the failed assertion and the corresponding product guard/calculation; change only the product method named by the assertion after review. No core fix was applied.");
        }
        private static void Assert(bool condition, string message)
        {
            AssertionCount++;
            if (!condition) throw new InvalidOperationException(message);
        }
        private static void Equal<T>(T expected, T actual, string label)
        {
            Assert(EqualityComparer<T>.Default.Equals(expected, actual), label + ": expected=" + expected + ", actual=" + actual);
        }
        private static void Near(double expected, double actual, double tolerance, string label)
        {
            Assert(Balance.Finite(actual) && Math.Abs(expected - actual) <= tolerance, label + ": expected=" + expected.ToString("R", CultureInfo.InvariantCulture) + ", actual=" + actual.ToString("R", CultureInfo.InvariantCulture));
        }
        private static void Same(RunState expected, RunState actual, string label)
        {
            foreach (FieldInfo f in StateFields) Assert(object.Equals(f.GetValue(expected), f.GetValue(actual)), label + " changed " + f.Name);
        }
        private static void Valid(RunState state)
        {
            string error;
            Assert(ForgeGame.Validate(state, out error), "Validate rejected reachable state: " + error);
        }
        private static void Ok(CommandResult result, string label) { Assert(result.Ok, label + ": " + result.Message); }
        private static void RejectUnchanged(ForgeGame game, Func<CommandResult> command, string label)
        {
            RunState before = game.State.Copy();
            Assert(!command().Ok, label + " must reject");
            Same(before, game.State, label);
            Valid(game.State);
        }
        private static void Throws<T>(Action body, string label) where T : Exception
        {
            AssertionCount++;
            try { body(); }
            catch (T) { return; }
            throw new InvalidOperationException(label + " did not throw " + typeof(T).Name);
        }
        private static ForgeGame Planning(ForgeRoute route)
        {
            ForgeGame game = new ForgeGame();
            Ok(game.AcceptOrder(), "AcceptOrder"); Ok(game.SelectRoute(route), "SelectRoute"); Valid(game.State); return game;
        }
        private static ForgeGame Heating(ForgeRoute route)
        {
            ForgeGame game = Planning(route); Ok(game.BeginHeat(), "BeginHeat"); Valid(game.State); return game;
        }
        private static void FinishHeat(ForgeGame game, double dt, int strategy)
        {
            int steps = 0;
            while (game.State.Stage == WorkStage.Heating && steps++ < 2000)
            {
                double low, high; Balance.HeatBand(game.State.Route, game.State.FurnaceLevel, out low, out high);
                double fuel = strategy == 1 ? 1 : strategy == 2 ? 0 :
                    (game.State.Temperature < low ? 1 : 0.16 * (game.State.Temperature - 20) / 28);
                Ok(game.AdvanceHeat(dt, fuel), "AdvanceHeat"); Valid(game.State);
            }
            Equal(WorkStage.Engraving, game.State.Stage, "heat must terminate automatically");
            Near(12, game.State.HeatElapsed, 0, "heat duration clipped to 12");
        }
        private static void FinishRunes(ForgeGame game)
        {
            while (game.State.Stage == WorkStage.Engraving)
            {
                int progress = game.State.RuneProgress;
                Ok(game.TraceNode(Balance.NodeAt(game.State.Route, progress)), "correct rune");
                Equal(progress + 1, game.State.RuneProgress, "one node per command"); Valid(game.State);
            }
            Equal(WorkStage.Trial, game.State.Stage, "runes lead to Trial");
        }
        private static ForgeGame Trial(ForgeRoute route, int strategy, int mistakes)
        {
            ForgeGame game = Heating(route); FinishHeat(game, 0.1, strategy);
            for (int i = 0; i < mistakes; i++) Assert(!game.TraceNode(1).Ok, "wrong first rune must reject");
            FinishRunes(game); return game;
        }
        private static ForgeGame Delivered(ForgeRoute route)
        {
            ForgeGame game = Trial(route, 0, 0); Ok(game.TestArtifact(), "TestArtifact"); Assert(game.State.TrialPassed, "ideal artifact must pass"); Ok(game.Deliver(), "Deliver"); Valid(game.State); return game;
        }
        private static RunState TrialSnapshot(ForgeRoute route, int heatScore, int mistakes)
        {
            RunState s = new RunState();
            s.Stage = WorkStage.Trial; s.Route = route; s.MaterialsCommitted = true;
            s.Iron -= 2; s.Ink--; if (route == ForgeRoute.Silver) s.Silver--;
            s.Temperature = 66; s.HeatElapsed = 12; s.TimeInBand = heatScore * 12.0 / 100;
            s.HeatScore = heatScore; s.RuneMistakes = mistakes; s.InkIntegrity = Balance.Integrity(mistakes); s.RuneProgress = Balance.NodeCount(route);
            Valid(s); return s;
        }

        private static void TestHeating()
        {
            foreach (ForgeRoute r in Enum.GetValues(typeof(ForgeRoute)))
            {
                ForgeRoute route = r;
                foreach (double step in new double[] { 0.02, 0.1, 0.25 })
                {
                    double dt = step;
                    Test("heat.ideal." + route + ".dt=" + dt.ToString(CultureInfo.InvariantCulture), delegate
                    {
                        ForgeGame game = Heating(route); FinishHeat(game, dt, 0); FinishRunes(game); Ok(game.TestArtifact(), "ideal TestArtifact");
                        Assert(game.State.HeatScore >= 60, "ideal HeatScore >= 60"); Equal(100, game.State.InkIntegrity, "ideal integrity");
                        Assert(game.State.TrialEnergy <= 9, "ideal energy <=9"); Assert(game.State.TrialPassed, "ideal control must pass both routes");
                        HeatScores[route + ":" + dt.ToString(CultureInfo.InvariantCulture)] = game.State.HeatScore;
                        Ok(game.Deliver(), "ideal Deliver"); Equal(54, game.State.Stones, "ideal reward"); Valid(game.State);
                    }, "New game -> accept/select " + route + " -> BeginHeat -> AdvanceHeat(" + dt.ToString(CultureInfo.InvariantCulture) + ", T<low?1:0.16*(T-20)/28) until Engraving -> all correct nodes -> TestArtifact; assert TrialPassed.",
                    "Check AdvanceHeat time-in-window integration and route heat thresholds; preserve the specified equilibrium fuel policy and dt-independent scoring.");
                }
                foreach (int mode in new int[] { 1, 2 })
                {
                    int strategy = mode;
                    Test("heat.uncontrolled." + route + ".fuel=" + (mode == 1 ? "1" : "0"), delegate
                    {
                        ForgeGame game = Trial(route, strategy, 0); Ok(game.TestArtifact(), "test failed artifact returns executed result");
                        Assert(game.State.HeatScore < 60, "uncontrolled heat must fail heat threshold"); Assert(!game.State.TrialPassed, "uncontrolled artifact must fail");
                        RejectUnchanged(game, game.Deliver, "unqualified Deliver");
                    });
                }
                Test("heat.dt-score-consistency." + route, delegate
                {
                    int min = 101, max = -1;
                    foreach (double dt in new double[] { 0.02, 0.1, 0.25 })
                    {
                        int score = HeatScores[route + ":" + dt.ToString(CultureInfo.InvariantCulture)]; min = Math.Min(min, score); max = Math.Max(max, score);
                    }
                    Assert(max - min <= 2, "scores at dt=.02/.1/.25 must differ by at most 2 points; actual span=" + (max - min));
                });
            }
            double[] badDt = { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, 0, 0.2500001, 1, double.MinValue, double.MaxValue };
            foreach (double value in badDt)
            {
                double dt = value;
                Test("heat.invalid-dt." + dt.ToString("R", CultureInfo.InvariantCulture), delegate
                { ForgeGame game = Heating(ForgeRoute.Economy); Ok(game.AdvanceHeat(0.1, 1), "warm state"); RejectUnchanged(game, delegate { return game.AdvanceHeat(dt, 0.5); }, "invalid dt"); });
            }
            foreach (double value in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, -0.000001, 1.000001, 2, double.MinValue, double.MaxValue })
            {
                double fuel = value;
                Test("heat.invalid-fuel." + fuel.ToString("R", CultureInfo.InvariantCulture), delegate
                { ForgeGame game = Heating(ForgeRoute.Silver); Ok(game.AdvanceHeat(0.1, 1), "warm state"); RejectUnchanged(game, delegate { return game.AdvanceHeat(0.1, fuel); }, "invalid fuel"); });
            }
            Test("heat.integration-and-final-clipping", delegate
            {
                ForgeGame game = Heating(ForgeRoute.Economy);
                Ok(game.AdvanceHeat(0.25, 1), "first heat step"); Near(46.2, game.State.Temperature, 1e-10, "Euler heat formula");
                Near(0, game.State.TimeInBand, 0, "below window"); FinishHeat(game, 0.25, 0);
                RejectUnchanged(game, delegate { return game.AdvanceHeat(0.1, 1); }, "heat after completion");
            });
            Test("heat.exact-window-overlap", delegate
            {
                RunState s = Heating(ForgeRoute.Economy).State.Copy(); s.Temperature = 59;
                ForgeGame game = new ForgeGame(s); double next = 59 + (28 - 0.16 * 39) * 0.25;
                Ok(game.AdvanceHeat(0.25, 1), "cross lower band"); Near(0.25 * (next - 60) / (next - 59), game.State.TimeInBand, 1e-10, "partial linear overlap");
                s = Heating(ForgeRoute.Economy).State.Copy(); s.Temperature = 71; game = new ForgeGame(s); next = 71 + (28 - 0.16 * 51) * 0.25;
                Ok(game.AdvanceHeat(0.25, 1), "cross upper band"); Near(0.25 * (72 - 71) / (next - 71), game.State.TimeInBand, 1e-10, "partial exit overlap");
                foreach (double t in new double[] { 60, 66, 72 })
                {
                    s = Heating(ForgeRoute.Economy).State.Copy(); s.Temperature = t; game = new ForgeGame(s);
                    Ok(game.AdvanceHeat(0.25, 0.16 * (t - 20) / 28), "equilibrium at band boundary"); Near(0.25, game.State.TimeInBand, 1e-10, "inclusive equilibrium window");
                }
            });
            Test("heat.score-rounding", delegate
            { Equal(0, Balance.HeatScore(0), "zero score"); Equal(100, Balance.HeatScore(12), "full score"); Equal(60, Balance.HeatScore(7.14), "59.5 rounds to60"); Equal(59, Balance.HeatScore(7.139), "below rounding threshold"); });
        }

        private static void TestInventory()
        {
            Test("inventory.initial", delegate
            { ForgeGame game = new ForgeGame(); Equal(30, game.State.Stones, "initial stones"); Equal(4, game.State.Iron, "initial iron"); Equal(6, game.State.Ink, "initial ink"); Equal(3, game.State.Silver, "initial silver"); Equal(WorkStage.Commission, game.State.Stage, "initial stage"); Equal(1, game.State.CurrentOrderId, "initial order"); Valid(game.State); });
            foreach (MaterialKind k in Enum.GetValues(typeof(MaterialKind)))
            {
                MaterialKind kind = k; int price = kind == MaterialKind.Iron ? 6 : kind == MaterialKind.Ink ? 2 : 4;
                Test("inventory.buy." + kind, delegate
                {
                    ForgeGame game = new ForgeGame(); RunState before = game.State.Copy(); Ok(game.Buy(kind), "Buy");
                    Equal(30 - price, game.State.Stones, "exact purchase cost"); Equal(before.Quantity(kind) + 1, game.State.Quantity(kind), "purchase one item");
                    foreach (MaterialKind other in Enum.GetValues(typeof(MaterialKind))) if (other != kind) Equal(before.Quantity(other), game.State.Quantity(other), "other inventory unchanged"); Valid(game.State);
                    RunState s = new RunState(); s.Stones = price - 1; game = new ForgeGame(s); RejectUnchanged(game, delegate { return game.Buy(kind); }, "insufficient stones");
                    s.Stones = price; game = new ForgeGame(s); Ok(game.Buy(kind), "exact funds"); Equal(0, game.State.Stones, "exact funds depleted");
                    s = new RunState(); if (kind == MaterialKind.Iron) s.Iron = 1000000; else if (kind == MaterialKind.Ink) s.Ink = 1000000; else s.Silver = 1000000;
                    game = new ForgeGame(s); RejectUnchanged(game, delegate { return game.Buy(kind); }, "inventory cap");
                });
            }
            foreach (ForgeRoute r in Enum.GetValues(typeof(ForgeRoute)))
            {
                ForgeRoute route = r;
                Test("inventory.commit-once." + route, delegate
                {
                    ForgeGame game = Planning(route); RunState before = game.State.Copy(); Ok(game.BeginHeat(), "commit materials");
                    Equal(before.Iron - 2, game.State.Iron, "two iron"); Equal(before.Ink - 1, game.State.Ink, "one ink");
                    Equal(before.Silver - (route == ForgeRoute.Silver ? 1 : 0), game.State.Silver, "silver route cost"); Equal(before.Stones, game.State.Stones, "no extra stone charge");
                    Assert(game.State.MaterialsCommitted, "committed flag"); RejectUnchanged(game, game.BeginHeat, "repeat BeginHeat"); RejectUnchanged(game, game.CancelOrder, "cancel after commitment");
                });
                foreach (MaterialKind k in Enum.GetValues(typeof(MaterialKind)))
                {
                    MaterialKind kind = k;
                    if (route == ForgeRoute.Economy && kind == MaterialKind.Silver) continue;
                    Test("inventory.missing-atomic." + route + "." + kind, delegate
                    {
                        RunState s = Planning(route).State.Copy(); if (kind == MaterialKind.Iron) s.Iron = 1; else if (kind == MaterialKind.Ink) s.Ink = 0; else s.Silver = 0;
                        ForgeGame game = new ForgeGame(s); RejectUnchanged(game, game.BeginHeat, "missing material must not deduct any inventory");
                    });
                }
            }
            Test("inventory.economy-needs-no-silver", delegate
            { RunState s = Planning(ForgeRoute.Economy).State.Copy(); s.Silver = 0; ForgeGame game = new ForgeGame(s); Ok(game.BeginHeat(), "economy without silver"); Equal(0, game.State.Silver, "no silver charge"); Valid(game.State); });
            Test("inventory.cancel-before-commit", delegate
            {
                ForgeGame game = Planning(ForgeRoute.Silver); RunState before = game.State.Copy(); Ok(game.CancelOrder(), "cancel planning"); before.Stage = WorkStage.Commission; Same(before, game.State, "only stage changes on cancel");
                RejectUnchanged(game, game.CancelOrder, "cancel unaccepted order"); Ok(game.AcceptOrder(), "accept again"); Equal(1, game.State.CurrentOrderId, "cancel does not generate ID");
            });
            Test("commands.unknown-enums-and-wrong-stages", delegate
            {
                ForgeGame game = Planning(ForgeRoute.Economy); RejectUnchanged(game, delegate { return game.SelectRoute((ForgeRoute)99); }, "unknown route");
                RejectUnchanged(game, delegate { return game.Buy((MaterialKind)99); }, "unknown material"); RejectUnchanged(game, game.AcceptOrder, "double accept");
                game = Heating(ForgeRoute.Economy); RejectUnchanged(game, delegate { return game.Buy(MaterialKind.Iron); }, "buy during heating");
                RejectUnchanged(game, delegate { return game.SelectRoute(ForgeRoute.Silver); }, "route change after commitment"); RejectUnchanged(game, delegate { return game.TraceNode(0); }, "trace before engraving");
                RejectUnchanged(game, game.TestArtifact, "test before Trial"); RejectUnchanged(game, game.Rework, "rework outside Trial");
                RejectUnchanged(game, game.UpgradeFurnace, "upgrade before delivery"); RejectUnchanged(game, game.AcceptRepeatOrder, "repeat before delivery");
            });
            Test("inventory.buy-in-all-allowed-stages", delegate
            {
                foreach (ForgeGame game in new ForgeGame[] { new ForgeGame(), Planning(ForgeRoute.Economy), Delivered(ForgeRoute.Economy) })
                { int stones = game.State.Stones; Ok(game.Buy(MaterialKind.Ink), "allowed Buy"); Equal(stones - 2, game.State.Stones, "allowed buy cost"); Valid(game.State); }
                ForgeGame engraving = Heating(ForgeRoute.Economy); FinishHeat(engraving, 0.25, 0); RejectUnchanged(engraving, delegate { return engraving.Buy(MaterialKind.Ink); }, "buy in engraving");
                ForgeGame trial = Trial(ForgeRoute.Silver, 0, 0); RejectUnchanged(trial, delegate { return trial.Buy(MaterialKind.Ink); }, "buy in Trial");
            });
        }

        private static void TestEngravingAndTrial()
        {
            foreach (ForgeRoute r in Enum.GetValues(typeof(ForgeRoute)))
            {
                ForgeRoute route = r;
                Test("runes.correct-progress." + route, delegate
                {
                    int[] expected = route == ForgeRoute.Economy ? new int[] { 0, 1, 3, 5 } : new int[] { 0, 2, 3, 4, 5 };
                    ForgeGame game = Heating(route); FinishHeat(game, 0.1, 0);
                    for (int i = 0; i < expected.Length; i++)
                    { Equal(expected[i], Balance.NodeAt(route, i), "specified path"); Ok(game.TraceNode(expected[i]), "correct node"); Equal(i + 1, game.State.RuneProgress, "sequential progress"); Equal(100, game.State.InkIntegrity, "correct path integrity"); Valid(game.State); }
                    Equal(WorkStage.Trial, game.State.Stage, "finished path"); RejectUnchanged(game, delegate { return game.TraceNode(5); }, "trace after complete");
                    Throws<ArgumentOutOfRangeException>(delegate { Balance.NodeAt(route, -1); }, "negative path index"); Throws<ArgumentOutOfRangeException>(delegate { Balance.NodeAt(route, expected.Length); }, "path index past end");
                });
                Test("runes.mistakes-and-out-of-range." + route, delegate
                {
                    ForgeGame game = Heating(route); FinishHeat(game, 0.25, 0);
                    RejectUnchanged(game, delegate { return game.TraceNode(-1); }, "negative node"); RejectUnchanged(game, delegate { return game.TraceNode(6); }, "node above5");
                    RejectUnchanged(game, delegate { return game.TraceNode(int.MinValue); }, "min node"); RejectUnchanged(game, delegate { return game.TraceNode(int.MaxValue); }, "max node");
                    for (int i = 1; i <= 22; i++)
                    {
                        Assert(!game.TraceNode(1).Ok, "wrong node returns failure"); Equal(0, game.State.RuneProgress, "wrong node does not advance");
                        Equal(Math.Min(20, i), game.State.RuneMistakes, "mistake cap"); Equal(Math.Max(0, 100 - 20 * i), game.State.InkIntegrity, "wrong node -20 to floor0"); Valid(game.State);
                    }
                    FinishRunes(game); Ok(game.TestArtifact(), "test zero integrity"); Assert(!game.State.TrialPassed, "zero integrity fails");
                });
                Test("rework.free-reset-and-recompute." + route, delegate
                {
                    ForgeGame game = Trial(route, 2, 2); Ok(game.TestArtifact(), "initial bad test"); Assert(!game.State.TrialPassed, "initial bad result");
                    RunState before = game.State.Copy(); Ok(game.Rework(), "free Rework");
                    Equal(before.Iron, game.State.Iron, "rework iron unchanged"); Equal(before.Ink, game.State.Ink, "rework ink unchanged"); Equal(before.Silver, game.State.Silver, "rework silver unchanged"); Equal(before.Stones, game.State.Stones, "rework stones unchanged");
                    Equal(before.CurrentOrderId, game.State.CurrentOrderId, "rework same order"); Assert(game.State.MaterialsCommitted, "rework retains commitment");
                    Equal(WorkStage.Heating, game.State.Stage, "rework starts heat"); Near(40, game.State.Temperature, 0, "rework temperature reset"); Near(0, game.State.HeatElapsed, 0, "rework elapsed reset"); Near(0, game.State.TimeInBand, 0, "rework band reset");
                    Equal(0, game.State.HeatScore, "rework score reset"); Equal(0, game.State.RuneProgress, "rework progress reset"); Equal(0, game.State.RuneMistakes, "rework errors reset"); Equal(100, game.State.InkIntegrity, "rework integrity reset");
                    Assert(!game.State.TrialTested && !game.State.TrialPassed && game.State.TrialEnergy == 0, "rework clears old trial"); Valid(game.State);
                    RejectUnchanged(game, game.BeginHeat, "rework cannot deduct twice"); FinishHeat(game, 0.02, 0); FinishRunes(game); Ok(game.TestArtifact(), "recomputed trial"); Assert(game.State.TrialPassed, "free rework can recover to pass");
                    RunState tested = game.State.Copy(); Ok(game.TestArtifact(), "retest"); Same(tested, game.State, "retest idempotent");
                    Ok(game.Rework(), "rework even after pass"); FinishHeat(game, 0.25, 2); FinishRunes(game); Ok(game.TestArtifact(), "bad rework recompute"); Assert(!game.State.TrialPassed, "previous pass must not survive bad rework");
                    Equal(before.Iron, game.State.Iron, "multiple reworks no material deduction"); Equal(before.Stones, game.State.Stones, "multiple reworks no stone deduction");
                });
            }
            Test("trial.energy-integer-truncation-thresholds", delegate
            {
                Equal(8, Balance.Energy(100, 100, ForgeRoute.Economy), "economy base"); Equal(5, Balance.Energy(100, 100, ForgeRoute.Silver), "silver base");
                foreach (ForgeRoute route in Enum.GetValues(typeof(ForgeRoute)))
                {
                    int b = route == ForgeRoute.Economy ? 8 : 5;
                    int[] scores = { 100, 81, 80, 61, 60, 41, 40, 21, 20, 1, 0 };
                    int[] penalties = { 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5 };
                    for (int i = 0; i < scores.Length; i++) Equal(b + penalties[i], Balance.Energy(scores[i], 100, route), "heat /20 truncation at " + scores[i]);
                    int[] integrities = { 100, 76, 75, 51, 50, 26, 25, 1, 0 };
                    int[] inkPenalties = { 0, 0, 1, 1, 2, 2, 3, 3, 4 };
                    for (int i = 0; i < integrities.Length; i++) Equal(b + inkPenalties[i], Balance.Energy(100, integrities[i], route), "integrity /25 truncation at " + integrities[i]);
                }
            });
            foreach (ForgeRoute r in Enum.GetValues(typeof(ForgeRoute)))
            {
                ForgeRoute route = r;
                foreach (int h in new int[] { 59, 60, 79, 80, 81, 100 })
                {
                    int heat = h;
                    foreach (int m in new int[] { 0, 1, 2 })
                    {
                        int mistakes = m;
                        Test("trial.acceptance." + route + ".heat=" + heat + ".mistakes=" + mistakes, delegate
                        {
                            ForgeGame game = new ForgeGame(TrialSnapshot(route, heat, mistakes)); RejectUnchanged(game, game.Deliver, "not tested yet");
                            Ok(game.TestArtifact(), "TestArtifact executes regardless of pass");
                            int energy = (route == ForgeRoute.Economy ? 8 : 5) + (100 - heat) / 20 + (20 * mistakes) / 25;
                            bool pass = heat >= 60 && mistakes <= 1 && energy <= 9;
                            Equal(energy, game.State.TrialEnergy, "integer trial energy"); Equal(pass, game.State.TrialPassed, "three independent acceptance conditions"); Assert(game.State.TrialTested, "tested flag"); Valid(game.State);
                            if (!pass) RejectUnchanged(game, game.Deliver, "failed acceptance cannot deliver");
                        });
                    }
                }
            }
        }

        private static List<RunState> SixStages()
        {
            ForgeGame game = new ForgeGame(); List<RunState> states = new List<RunState>(); states.Add(game.State.Copy());
            Ok(game.AcceptOrder(), "stage planning"); Ok(game.SelectRoute(ForgeRoute.Silver), "stage silver"); states.Add(game.State.Copy());
            Ok(game.BeginHeat(), "stage heating"); Ok(game.AdvanceHeat(0.1, 1), "nonempty heat state"); states.Add(game.State.Copy());
            FinishHeat(game, 0.1, 0); Assert(!game.TraceNode(1).Ok, "one rune error"); Ok(game.TraceNode(0), "one correct rune"); states.Add(game.State.Copy());
            FinishRunes(game); Ok(game.TestArtifact(), "tested Trial"); states.Add(game.State.Copy()); Ok(game.Deliver(), "stage delivered"); states.Add(game.State.Copy());
            Equal(6, states.Count, "six stages"); return states;
        }
        private static void TestPauseAndOrders()
        {
            foreach (RunState snapshot in SixStages())
            {
                RunState s = snapshot;
                Test("pause.all-commands." + s.Stage, delegate
                {
                    ForgeGame game = new ForgeGame(s); game.SetPaused(true); Assert(game.State.Paused, "pause set");
                    Func<CommandResult>[] commands = {
                        game.AcceptOrder, delegate { return game.SelectRoute(ForgeRoute.Economy); }, game.CancelOrder,
                        delegate { return game.Buy(MaterialKind.Iron); }, game.BeginHeat, delegate { return game.AdvanceHeat(0.25, 1); },
                        delegate { return game.TraceNode(0); }, game.TestArtifact, game.Rework, game.Deliver, game.UpgradeFurnace, game.AcceptRepeatOrder
                    };
                    for (int i = 0; i < commands.Length; i++) RejectUnchanged(game, commands[i], "paused command " + i);
                    RunState paused = game.State.Copy(); game.SetPaused(true); Same(paused, game.State, "pause idempotent");
                    game.SetPaused(false); Same(s, game.State, "resume restores all original fields"); Valid(game.State);
                });
            }
            Test("pause.heat-time-frozen-and-resume", delegate
            {
                ForgeGame game = Heating(ForgeRoute.Economy); Ok(game.AdvanceHeat(0.1, 1), "initial heat"); game.SetPaused(true); RunState before = game.State.Copy();
                for (int i = 0; i < 100; i++) Assert(!game.AdvanceHeat(0.25, 1).Ok, "paused heat step"); Same(before, game.State, "100 paused steps freeze heat time and temperature");
                game.SetPaused(false); Ok(game.AdvanceHeat(0.1, 1), "resume heat"); Near(0.2, game.State.HeatElapsed, 1e-12, "only unpaused elapsed"); Valid(game.State);
            });
            Test("orders.unique-payout-repeat-ids", delegate
            {
                ForgeGame game = Delivered(ForgeRoute.Economy); Equal(54, game.State.Stones, "first 24 payout"); Equal(1, game.State.LastPaidOrderId, "first paid ID");
                for (int i = 0; i < 5; i++) RejectUnchanged(game, game.Deliver, "duplicate delivery");
                Ok(game.AcceptRepeatOrder(), "first repeat"); Equal(2, game.State.CurrentOrderId, "repeat increments ID"); Equal(1, game.State.LastPaidOrderId, "repeat retains last paid");
                Assert(!game.State.MaterialsCommitted && !game.State.TrialTested, "repeat clears work"); RejectUnchanged(game, game.AcceptRepeatOrder, "cannot repeat while in Planning");
                Ok(game.BeginHeat(), "second materials"); FinishHeat(game, 0.25, 0); FinishRunes(game); Ok(game.TestArtifact(), "second trial"); Ok(game.Deliver(), "second delivery");
                Equal(78, game.State.Stones, "two orders pay twice total"); Equal(2, game.State.LastPaidOrderId, "second paid ID"); RejectUnchanged(game, game.Deliver, "second duplicate");
                Ok(game.AcceptRepeatOrder(), "third order"); Equal(3, game.State.CurrentOrderId, "IDs monotonic"); Equal(2, game.State.LastPaidOrderId, "third previous paid");
                RejectUnchanged(game, game.BeginHeat, "third no iron no deduction"); Valid(game.State);
            });
            Test("orders.limits-and-unpaid-snapshot", delegate
            {
                RunState s = TrialSnapshot(ForgeRoute.Silver, 100, 0); s.Stones = 1000000000 - 23; ForgeGame game = new ForgeGame(s); Ok(game.TestArtifact(), "cap trial"); RejectUnchanged(game, game.Deliver, "reward overflow guard");
                s.Stones = 1000000000 - 24; game = new ForgeGame(s); Ok(game.TestArtifact(), "exact cap trial"); Ok(game.Deliver(), "reward reaches cap"); Equal(1000000000, game.State.Stones, "stone upper bound"); Valid(game.State);
                s = Delivered(ForgeRoute.Silver).State.Copy(); s.CurrentOrderId = 999999; s.LastPaidOrderId = 999999; game = new ForgeGame(s); RejectUnchanged(game, game.AcceptRepeatOrder, "order ID upper bound");
            });
            Test("upgrade.once-cost40-and-both-bands", delegate
            {
                ForgeGame game = Delivered(ForgeRoute.Economy); int before = game.State.Stones; Ok(game.UpgradeFurnace(), "UpgradeFurnace"); Equal(before - 40, game.State.Stones, "upgrade cost40"); Equal(1, game.State.FurnaceLevel, "one furnace level");
                RejectUnchanged(game, game.UpgradeFurnace, "repeat upgrade no charge");
                foreach (ForgeRoute route in Enum.GetValues(typeof(ForgeRoute)))
                {
                    double low0, high0, low1, high1; Balance.HeatBand(route, 0, out low0, out high0); Balance.HeatBand(route, 1, out low1, out high1);
                    Near(low0 - 4, low1, 0, "lower band expands4"); Near(high0 + 4, high1, 0, "upper band expands4");
                    Near(route == ForgeRoute.Economy ? 60 : 64, low0, 0, "base lower band"); Near(route == ForgeRoute.Economy ? 72 : 70, high0, 0, "base upper band");
                }
                Ok(game.AcceptRepeatOrder(), "upgraded repeat"); Ok(game.SelectRoute(ForgeRoute.Silver), "upgraded silver"); Ok(game.BeginHeat(), "upgraded heat");
                RunState s = game.State.Copy(); s.Temperature = 61; game = new ForgeGame(s); Ok(game.AdvanceHeat(0.25, 0.16 * (61 - 20) / 28), "upgraded band immediately active"); Near(0.25, game.State.TimeInBand, 1e-12, "61 inside expanded silver band"); Valid(game.State);
            });
            Test("upgrade.insufficient-stones-no-charge", delegate
            {
                RunState s = Delivered(ForgeRoute.Silver).State.Copy(); s.Stones = 39; ForgeGame game = new ForgeGame(s); RejectUnchanged(game, game.UpgradeFurnace, "39 stones");
                s.Stones = 40; game = new ForgeGame(s); Ok(game.UpgradeFurnace(), "exact40"); Equal(0, game.State.Stones, "upgrade exact40 depleted"); Valid(game.State);
            });
        }

        private static void InvalidCase(string name, RunState source, Action<RunState> mutate)
        {
            Test("validate.reject." + name, delegate
            {
                RunState bad = source.Copy(); mutate(bad); string error;
                Assert(!ForgeGame.Validate(bad, out error), "Validate must reject " + name); Assert(!string.IsNullOrEmpty(error), "rejection has explanation");
                Throws<ArgumentException>(delegate { new ForgeGame(bad); }, "constructor rejects " + name);
            }, "Copy a valid " + source.Stage + " snapshot, apply mutation '" + name + "', assert Validate returns false and constructor throws ArgumentException.",
                "Add or tighten the corresponding invariant in ForgeGame.Validate before copying a snapshot; ensure SaveStore uses the same validation.");
        }
        private static void TestValidation()
        {
            Test("validate.null-and-copy-isolation", delegate
            {
                string error; Assert(!ForgeGame.Validate(null, out error), "null rejected"); Throws<ArgumentException>(delegate { new ForgeGame(null); }, "null constructor");
                RunState input = new RunState(); ForgeGame game = new ForgeGame(input); input.Iron = 999; Equal(4, game.State.Iron, "constructor copies snapshot");
                RunState copy = game.State.Copy(); copy.Ink = 999; Equal(6, game.State.Ink, "Copy independent"); Valid(game.State);
            });
            RunState initial = new RunState(); RunState heat = Heating(ForgeRoute.Economy).State.Copy(); RunState trial = TrialSnapshot(ForgeRoute.Economy, 100, 0);
            RunState engraving = trial.Copy(); engraving.Stage = WorkStage.Engraving; engraving.RuneProgress = 1;
            InvalidCase("schema", initial, delegate(RunState s) { s.Schema = 2; });
            InvalidCase("unknown-stage-negative", initial, delegate(RunState s) { s.Stage = (WorkStage)(-1); });
            InvalidCase("unknown-stage-positive", initial, delegate(RunState s) { s.Stage = (WorkStage)99; });
            InvalidCase("unknown-route", initial, delegate(RunState s) { s.Route = (ForgeRoute)99; });
            InvalidCase("negative-stones", initial, delegate(RunState s) { s.Stones = -1; });
            InvalidCase("excess-stones", initial, delegate(RunState s) { s.Stones = 1000000001; });
            InvalidCase("negative-iron", initial, delegate(RunState s) { s.Iron = -1; });
            InvalidCase("negative-ink", initial, delegate(RunState s) { s.Ink = -1; });
            InvalidCase("negative-silver", initial, delegate(RunState s) { s.Silver = -1; });
            InvalidCase("excess-iron", initial, delegate(RunState s) { s.Iron = 1000001; });
            InvalidCase("excess-ink", initial, delegate(RunState s) { s.Ink = 1000001; });
            InvalidCase("excess-silver", initial, delegate(RunState s) { s.Silver = 1000001; });
            InvalidCase("negative-furnace", initial, delegate(RunState s) { s.FurnaceLevel = -1; });
            InvalidCase("excess-furnace", initial, delegate(RunState s) { s.FurnaceLevel = 2; });
            InvalidCase("zero-order", initial, delegate(RunState s) { s.CurrentOrderId = 0; });
            InvalidCase("excess-order", initial, delegate(RunState s) { s.CurrentOrderId = 1000000; });
            InvalidCase("negative-paid-order", initial, delegate(RunState s) { s.LastPaidOrderId = -1; });
            InvalidCase("paid-future-order", initial, delegate(RunState s) { s.LastPaidOrderId = 2; });
            InvalidCase("paid-active-order", trial, delegate(RunState s) { s.LastPaidOrderId = s.CurrentOrderId; });
            InvalidCase("missing-previous-payout", initial, delegate(RunState s) { s.CurrentOrderId = 3; });
            foreach (double x in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, 101 })
            { double v = x; InvalidCase("temperature=" + v.ToString("R", CultureInfo.InvariantCulture), heat, delegate(RunState s) { s.Temperature = v; }); }
            foreach (double x in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, 12.01 })
            { double v = x; InvalidCase("elapsed=" + v.ToString("R", CultureInfo.InvariantCulture), heat, delegate(RunState s) { s.HeatElapsed = v; }); }
            foreach (double x in new double[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, 0.01 })
            { double v = x; InvalidCase("in-band=" + v.ToString("R", CultureInfo.InvariantCulture), heat, delegate(RunState s) { s.TimeInBand = v; }); }
            InvalidCase("preheat-committed", initial, delegate(RunState s) { s.MaterialsCommitted = true; });
            InvalidCase("heat-not-committed", heat, delegate(RunState s) { s.MaterialsCommitted = false; });
            InvalidCase("preheat-elapsed", initial, delegate(RunState s) { s.HeatElapsed = 0.1; });
            InvalidCase("preheat-score", initial, delegate(RunState s) { s.HeatScore = 1; });
            InvalidCase("heat-complete-but-not-engraving", heat, delegate(RunState s) { s.HeatElapsed = 12; });
            InvalidCase("heat-rune-progress", heat, delegate(RunState s) { s.RuneProgress = 1; });
            InvalidCase("heat-rune-mistakes", heat, delegate(RunState s) { s.RuneMistakes = 1; s.InkIntegrity = 80; });
            InvalidCase("heat-score-premature", heat, delegate(RunState s) { s.HeatScore = 1; });
            InvalidCase("negative-mistakes", engraving, delegate(RunState s) { s.RuneMistakes = -1; });
            InvalidCase("excess-mistakes", engraving, delegate(RunState s) { s.RuneMistakes = 21; s.InkIntegrity = 0; });
            InvalidCase("integrity-forged", engraving, delegate(RunState s) { s.InkIntegrity = 80; });
            InvalidCase("negative-progress", engraving, delegate(RunState s) { s.RuneProgress = -1; });
            InvalidCase("excess-progress", engraving, delegate(RunState s) { s.RuneProgress = 99; });
            InvalidCase("engraving-not-heated", engraving, delegate(RunState s) { s.HeatElapsed = 11; s.TimeInBand = 11; });
            InvalidCase("engraving-score-forged", engraving, delegate(RunState s) { s.HeatScore = 99; });
            InvalidCase("engraving-complete-wrong-stage", engraving, delegate(RunState s) { s.RuneProgress = Balance.NodeCount(s.Route); });
            InvalidCase("trial-incomplete-runes", trial, delegate(RunState s) { s.RuneProgress = 1; });
            InvalidCase("premature-trial", engraving, delegate(RunState s) { s.TrialTested = true; });
            InvalidCase("untested-pass-forged", trial, delegate(RunState s) { s.TrialPassed = true; });
            InvalidCase("untested-energy-forged", trial, delegate(RunState s) { s.TrialEnergy = 8; });
            InvalidCase("trial-energy-forged", trial, delegate(RunState s) { s.TrialTested = true; s.TrialPassed = true; s.TrialEnergy = 0; });
            InvalidCase("trial-pass-forged", TrialSnapshot(ForgeRoute.Silver, 59, 0), delegate(RunState s) { s.TrialTested = true; s.TrialEnergy = Balance.Energy(s.HeatScore, s.InkIntegrity, s.Route); s.TrialPassed = true; });
            InvalidCase("trial-failure-forged", trial, delegate(RunState s) { s.TrialTested = true; s.TrialEnergy = 8; s.TrialPassed = false; });
            InvalidCase("delivered-unpaid", Delivered(ForgeRoute.Silver).State.Copy(), delegate(RunState s) { s.LastPaidOrderId = 0; });
            InvalidCase("delivered-untested", Delivered(ForgeRoute.Silver).State.Copy(), delegate(RunState s) { s.TrialTested = false; s.TrialPassed = false; s.TrialEnergy = 0; });
            InvalidCase("delivered-failed", TrialSnapshot(ForgeRoute.Silver, 59, 0), delegate(RunState s) { s.Stage = WorkStage.Delivered; s.LastPaidOrderId = 1; s.TrialTested = true; s.TrialEnergy = Balance.Energy(s.HeatScore, s.InkIntegrity, s.Route); });
        }

        private static SaveStore Store(string directory)
        { return new SaveStore(directory, delegate(RunState s) { return Json.Serialize(s); }, delegate(string text) { return Json.Deserialize<RunState>(text); }); }
        private static string CaseDirectory(string label)
        {
            string path = Path.Combine(RunDirectory, label + "_" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(path); return path;
        }
        private static string Digest(string payload)
        { using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(payload))).Replace("-", "").ToLowerInvariant(); }
        private static void WriteNew(string path, string content)
        {
            byte[] bytes = new UTF8Encoding(false, true).GetBytes(content);
            using (FileStream file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { file.Write(bytes, 0, bytes.Length); file.Flush(true); }
        }
        private static string RawSave(string directory, string payload, string header, string checksum)
        {
            string path = Path.Combine(directory, "run_injected_" + Guid.NewGuid().ToString("N") + ".lqs");
            WriteNew(path, header + "\n" + (checksum ?? Digest(payload)) + "\n" + payload); return path;
        }
        private static void Retained(Dictionary<string, string> originals)
        { foreach (KeyValuePair<string, string> entry in originals) { Assert(File.Exists(entry.Key), "snapshot retained: " + entry.Key); Equal(entry.Value, File.ReadAllText(entry.Key, Encoding.UTF8), "snapshot content unchanged"); } }
        private static void TestPersistence()
        {
            foreach (RunState snapshot in SixStages())
            {
                RunState s = snapshot;
                Test("save.json-disk-roundtrip." + s.Stage, delegate
                {
                    string dir = CaseDirectory("stage_" + s.Stage); SaveStore store = Store(dir);
                    string json = Json.Serialize(s); Assert(json.IndexOf("\"Schema\"", StringComparison.Ordinal) >= 0, "serializer includes fields"); Same(s, Json.Deserialize<RunState>(json), "JSON roundtrip");
                    string first = store.Save(s); Assert(Path.GetDirectoryName(first) == dir, "save inside test directory");
                    string content = File.ReadAllText(first, new UTF8Encoding(false, true)); Equal("LQSECT_V1", content.Split('\n')[0], "save header"); Equal(Digest(json), content.Split('\n')[1], "SHA256 of JSON payload");
                    SaveLoadResult loaded = store.LoadLatest(); Assert(loaded.State != null, "loaded state"); Equal(0, loaded.SkippedFiles, "no skipped valid files"); Equal(Path.GetFileName(first), loaded.FileName, "file name"); Same(s, loaded.State, "disk roundtrip"); Valid(loaded.State); new ForgeGame(loaded.State);
                    loaded.State.Iron += 10; Same(s, store.LoadLatest().State, "load result independent");
                    RunState paused = s.Copy(); paused.Paused = true; string second = store.Save(paused); Assert(first != second, "append-only unique path");
                    File.SetLastWriteTimeUtc(first, new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc)); File.SetLastWriteTimeUtc(second, new DateTime(2020, 1, 2, 0, 0, 0, DateTimeKind.Utc));
                    Same(paused, store.LoadLatest().State, "paused disk roundtrip"); Equal(content, File.ReadAllText(first, Encoding.UTF8), "old snapshot never changed"); Equal(2, Directory.GetFiles(dir, "run_*.lqs").Length, "both snapshots retained");
                });
            }
            Test("save.append-only-25-snapshots", delegate
            {
                string dir = CaseDirectory("append_only"); SaveStore store = Store(dir); Dictionary<string, string> old = new Dictionary<string, string>();
                for (int i = 0; i < 25; i++)
                {
                    RunState s = new RunState(); s.Stones += i; string path = store.Save(s); Assert(!old.ContainsKey(path), "unique append path"); old.Add(path, File.ReadAllText(path, Encoding.UTF8));
                    File.SetLastWriteTimeUtc(path, new DateTime(2020, 2, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(i)); Retained(old);
                }
                Equal(25, Directory.GetFiles(dir, "run_*.lqs").Length, "all25 files exist"); Equal(54, store.LoadLatest().State.Stones, "newest valid snapshot"); Retained(old);
            });
            foreach (string failure in new string[] { "bad-checksum", "bad-header", "malformed-json", "null-json", "schema", "negative-iron", "negative-ink", "negative-silver", "forged-trial", "unknown-stage", "oversized" })
            {
                string kind = failure;
                Test("save.fallback." + kind, delegate
                {
                    string dir = CaseDirectory("fallback_" + kind); SaveStore store = Store(dir); RunState good = new RunState(); string first = store.Save(good);
                    RunState secondState = Planning(ForgeRoute.Silver).State.Copy(); string second = store.Save(secondState);
                    RunState bad = good.Copy(); string payload;
                    if (kind == "schema") bad.Schema = 2;
                    if (kind == "negative-iron") bad.Iron = -1;
                    if (kind == "negative-ink") bad.Ink = -1;
                    if (kind == "negative-silver") bad.Silver = -1;
                    if (kind == "unknown-stage") bad.Stage = (WorkStage)99;
                    if (kind == "forged-trial") { bad = TrialSnapshot(ForgeRoute.Silver, 59, 0); bad.TrialTested = true; bad.TrialPassed = true; bad.TrialEnergy = Balance.Energy(bad.HeatScore, bad.InkIntegrity, bad.Route); }
                    payload = kind == "malformed-json" ? "{this is not JSON" : kind == "null-json" ? "null" : kind == "oversized" ? new string('x', 1024 * 1024 + 1) : Json.Serialize(bad);
                    string newest = RawSave(dir, payload, kind == "bad-header" ? "LQSECT_V999" : "LQSECT_V1", kind == "bad-checksum" ? new string('0', 64) : null);
                    DateTime epoch = new DateTime(2020, 3, 1, 0, 0, 0, DateTimeKind.Utc);
                    File.SetLastWriteTimeUtc(first, epoch); File.SetLastWriteTimeUtc(second, epoch.AddSeconds(1)); File.SetLastWriteTimeUtc(newest, epoch.AddSeconds(2));
                    Dictionary<string, string> originals = new Dictionary<string, string>(); foreach (string path in Directory.GetFiles(dir, "run_*.lqs")) originals.Add(path, File.ReadAllText(path, Encoding.UTF8));
                    SaveLoadResult result = store.LoadLatest(); Assert(result.State != null, "fallback must find older valid state"); Equal(1, result.SkippedFiles, "one bad newest skipped"); Equal(Path.GetFileName(second), result.FileName, "returns most recent valid not oldest"); Same(secondState, result.State, "fallback snapshot"); Valid(result.State); Retained(originals);
                    Equal(3, Directory.GetFiles(dir, "run_*.lqs").Length, "bad and valid files all retained");
                }, "Save Commission and Planning snapshots to real disk; append a newer '" + kind + "' snapshot with a valid envelope hash except checksum/header cases; assert LoadLatest skips it and returns Planning, preserving every file.",
                    "In SaveStore.LoadLatest keep scanning older files on JSON/envelope/schema/invariant errors, and call ForgeGame.Validate before accepting a snapshot; never overwrite or remove rejected snapshots.");
            }
            Test("save.reject-invalid-before-write", delegate
            {
                string dir = CaseDirectory("invalid_write"); SaveStore store = Store(dir); string goodPath = store.Save(new RunState()); string original = File.ReadAllText(goodPath, Encoding.UTF8);
                List<RunState> bad = new List<RunState>(); bad.Add(null);
                RunState s = new RunState(); s.Schema = 9; bad.Add(s); s = new RunState(); s.Iron = -1; bad.Add(s); s = new RunState(); s.Ink = -1; bad.Add(s); s = new RunState(); s.Silver = -1; bad.Add(s);
                s = new RunState(); s.Stage = (WorkStage)99; bad.Add(s); s = TrialSnapshot(ForgeRoute.Silver, 59, 0); s.TrialTested = true; s.TrialPassed = true; s.TrialEnergy = Balance.Energy(s.HeatScore, s.InkIntegrity, s.Route); bad.Add(s);
                foreach (RunState value in bad) { RunState invalid = value; Throws<InvalidDataException>(delegate { store.Save(invalid); }, "invalid Save"); }
                Equal(1, Directory.GetFiles(dir, "run_*.lqs").Length, "invalid saves produce no file"); Equal(original, File.ReadAllText(goodPath, Encoding.UTF8), "valid snapshot preserved");
            });
            Test("save.empty-and-all-invalid-retained", delegate
            {
                string dir = CaseDirectory("all_bad"); SaveStore store = Store(dir); SaveLoadResult empty = store.LoadLatest(); Assert(empty.State == null, "empty returns no state"); Equal(0, empty.SkippedFiles, "empty skip count");
                string missing = Path.Combine(dir, "not_created"); Assert(Store(missing).LoadLatest().State == null, "absent directory no state"); Assert(!Directory.Exists(missing), "load must not create missing directory");
                string a = RawSave(dir, "{}", "BROKEN", null); string b = RawSave(dir, "null", "LQSECT_V1", null); Dictionary<string, string> originals = new Dictionary<string, string>(); originals.Add(a, File.ReadAllText(a)); originals.Add(b, File.ReadAllText(b));
                SaveLoadResult allBad = store.LoadLatest(); Assert(allBad.State == null, "all corrupt no invented new state"); Equal(2, allBad.SkippedFiles, "all corrupt skipped"); Assert(!string.IsNullOrEmpty(allBad.Message), "all corrupt explained"); Retained(originals);
            });
            Test("save.same-timestamp-deterministic-order", delegate
            {
                string dir = CaseDirectory("tie_order"); SaveStore store = Store(dir); RunState s = new RunState(); string a = store.Save(s); s.Stones = 31; string b = store.Save(s);
                DateTime time = new DateTime(2020, 4, 1, 0, 0, 0, DateTimeKind.Utc); File.SetLastWriteTimeUtc(a, time); File.SetLastWriteTimeUtc(b, time);
                string expected = string.CompareOrdinal(a, b) > 0 ? a : b; Equal(Path.GetFileName(expected), store.LoadLatest().FileName, "descending ordinal tie breaker");
            });
            Test("save.codec-copy-and-size-limit", delegate
            {
                string dir = CaseDirectory("codec_limits"); RunState original = new RunState();
                SaveStore copyCodec = new SaveStore(dir, delegate(RunState s) { s.Stones = 31; return Json.Serialize(s); }, delegate(string payload) { return Json.Deserialize<RunState>(payload); });
                copyCodec.Save(original); Equal(30, original.Stones, "encode gets copy"); Equal(31, copyCodec.LoadLatest().State.Stones, "codec roundtrip");
                SaveStore large = new SaveStore(dir, delegate(RunState s) { return new string('x', 1024 * 1024 + 1); }, delegate(string text) { return new RunState(); });
                Throws<InvalidDataException>(delegate { large.Save(original); }, "oversized write rejection"); Equal(1, Directory.GetFiles(dir, "run_*.lqs").Length, "oversized write no new file");
                Throws<ArgumentException>(delegate { new SaveStore("", delegate(RunState s) { return ""; }, delegate(string text) { return new RunState(); }); }, "empty path");
                Throws<ArgumentException>(delegate { new SaveStore(dir, null, delegate(string text) { return new RunState(); }); }, "missing encoder");
                Throws<ArgumentException>(delegate { new SaveStore(dir, delegate(RunState s) { return ""; }, null); }, "missing decoder");
            });
        }

        private static void TestRandomFlow()
        {
            Test("random.1000-legal-transitions-and-invariants", delegate
            {
                Random random = new Random(20261118); ForgeGame game = new ForgeGame(); string dir = CaseDirectory("random_flow"); SaveStore store = Store(dir);
                Dictionary<string, string> snapshots = new Dictionary<string, string>(); int firstId = game.State.CurrentOrderId;
                for (int step = 0; step < 1000; step++)
                {
                    RunState before = game.State.Copy(); CommandResult result = null;
                    if (game.State.Paused) game.SetPaused(false);
                    else if (random.Next(100) < 3) game.SetPaused(true);
                    else switch (game.State.Stage)
                    {
                        case WorkStage.Commission: result = game.AcceptOrder(); break;
                        case WorkStage.Planning:
                            if (random.Next(100) < 5) result = game.CancelOrder();
                            else if (game.State.Iron < 2) result = game.Buy(MaterialKind.Iron);
                            else if (game.State.Ink < 1) result = game.Buy(MaterialKind.Ink);
                            else if (game.State.Route == ForgeRoute.Silver && game.State.Silver < 1) result = game.Buy(MaterialKind.Silver);
                            else if (random.Next(100) < 20) result = game.SelectRoute(random.Next(2) == 0 ? ForgeRoute.Economy : ForgeRoute.Silver);
                            else result = game.BeginHeat();
                            break;
                        case WorkStage.Heating:
                            double low, high; Balance.HeatBand(game.State.Route, game.State.FurnaceLevel, out low, out high);
                            double fuel = game.State.Temperature < low ? 1 : 0.16 * (game.State.Temperature - 20) / 28;
                            double dt = random.Next(10) == 0 ? 0.02 : random.Next(5) == 0 ? 0.1 : 0.25;
                            result = game.AdvanceHeat(dt, fuel); break;
                        case WorkStage.Engraving:
                            int node = Balance.NodeAt(game.State.Route, game.State.RuneProgress);
                            // One deliberate legal wrong node per some orders; preserve recovery and solvency.
                            if (game.State.RuneMistakes == 0 && random.Next(100) < 10)
                            { result = game.TraceNode((node + 1) % 6); Assert(!result.Ok, "legal wrong node returns failure"); result = null; }
                            else result = game.TraceNode(node);
                            break;
                        case WorkStage.Trial:
                            if (!game.State.TrialTested) result = game.TestArtifact();
                            else if (!game.State.TrialPassed) result = game.Rework();
                            else { result = game.Deliver(); RandomDeliveries++; }
                            break;
                        case WorkStage.Delivered:
                            if (game.State.FurnaceLevel == 0 && game.State.Stones >= 58 && game.State.CurrentOrderId >= 3) result = game.UpgradeFurnace();
                            else result = game.AcceptRepeatOrder();
                            break;
                        default: throw new InvalidOperationException("unexpected stage");
                    }
                    if (result != null) Ok(result, "random legal command step " + step);
                    Valid(game.State); Assert(game.State.CurrentOrderId >= before.CurrentOrderId, "order ID never decreases");
                    Assert(game.State.CurrentOrderId <= before.CurrentOrderId + 1, "one ID increment maximum");
                    Assert(game.State.LastPaidOrderId >= before.LastPaidOrderId, "paid ID monotonic");
                    if (game.State.LastPaidOrderId != before.LastPaidOrderId)
                    { Equal(before.Stones + 24, game.State.Stones, "random exact payout"); Equal(WorkStage.Delivered, game.State.Stage, "random payout only delivered"); }
                    Assert(game.State.Iron >= 0 && game.State.Ink >= 0 && game.State.Silver >= 0 && game.State.Stones >= 0, "random inventory nonnegative");
                    if (before.Stage == WorkStage.Heating && before.Paused) Near(before.HeatElapsed, game.State.HeatElapsed, 0, "random pause freezes elapsed");
                    if (step % 50 == 0)
                    {
                        RunState saved = game.State.Copy(); string path = store.Save(saved); snapshots.Add(path, File.ReadAllText(path, Encoding.UTF8));
                        Same(saved, store.LoadLatest().State, "random disk roundtrip"); game = new ForgeGame(store.LoadLatest().State); Valid(game.State);
                    }
                    RandomSteps++;
                }
                Equal(1000, RandomSteps, "1000 steps completed"); Assert(RandomDeliveries >= 5, "random flow must exercise repeated deliveries, actual=" + RandomDeliveries);
                Assert(game.State.CurrentOrderId > firstId, "random flow crosses multiple orders"); Equal(20, snapshots.Count, "20 random disk snapshots"); Retained(snapshots);
            }, "Seed 20261118; 1000 legal commands including both routes, procurement, heat dt variations, rune errors, free rework, pause, upgrades and repeated delivery; Validate after every step and disk roundtrip every50 steps.",
                "Use the logged seed/step to reproduce the failing command; update its precondition/reset/accounting so every reachable state satisfies ForgeGame.Validate. No product changes were made.");
        }
    }
}
