using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace LianQi.Core
{
    public sealed class SaveLoadResult
    {
        public RunState State;
        public string Message;
        public int SkippedFiles;
        public string FileName;
    }

    // Append-only snapshots. Never truncates, replaces, or deletes an existing save.
    // Codec is supplied by the host: Unity JsonUtility in game, .NET JSON in headless tests.
    public sealed class SaveStore
    {
        private readonly string directory;
        private readonly Func<RunState, string> encode;
        private readonly Func<string, RunState> decode;
        private const string Header = "LQSECT_V1";
        private const long MaxBytes = 1024 * 1024;
        public SaveStore(string directory, Func<RunState, string> encode, Func<string, RunState> decode)
        {
            if (string.IsNullOrEmpty(directory) || encode == null || decode == null) throw new ArgumentException("存档路径或JSON编解码器为空。");
            this.directory = directory; this.encode = encode; this.decode = decode;
        }
        private static string Hash(string payload)
        {
            using (SHA256 sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(payload))).Replace("-", "").ToLowerInvariant();
        }
        public string Save(RunState state)
        {
            string error;
            if (!ForgeGame.Validate(state, out error)) throw new InvalidDataException(error);
            string payload = encode(state.Copy());
            string content = Header + "\n" + Hash(payload) + "\n" + payload;
            byte[] bytes = new UTF8Encoding(false).GetBytes(content);
            if (bytes.Length > MaxBytes) throw new InvalidDataException("存档超过1MiB上限。");
            Directory.CreateDirectory(directory);
            string name = "run_" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfffffff") + "_" + Guid.NewGuid().ToString("N") + ".lqs";
            string path = Path.Combine(directory, name);
            using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
            return path;
        }
        private static DateTime SafeTimestamp(string path)
        {
            try { return File.GetLastWriteTimeUtc(path); }
            catch (UnauthorizedAccessException) { return DateTime.MaxValue; }
            catch (System.Security.SecurityException) { return DateTime.MaxValue; }
            catch (IOException) { return DateTime.MaxValue; }
        }
        public SaveLoadResult LoadLatest()
        {
            SaveLoadResult result = new SaveLoadResult();
            try
            {
                if ((File.GetAttributes(directory) & FileAttributes.Directory) == 0)
                    throw new IOException("存档位置不是目录，原位置已保留。");
            }
            catch (DirectoryNotFoundException) { result.Message = "未发现存档，可开始新局。"; return result; }
            catch (FileNotFoundException) { result.Message = "未发现存档，可开始新局。"; return result; }
            // Access errors must propagate to the UI's explicit recovery decision.
            string[] paths = Directory.GetFiles(directory, "run_*.lqs", SearchOption.TopDirectoryOnly);
            Array.Sort(paths, delegate(string a, string b)
            {
                int time = SafeTimestamp(b).CompareTo(SafeTimestamp(a));
                return time != 0 ? time : string.CompareOrdinal(b, a);
            });
            foreach (string path in paths)
            {
                try
                {
                    if (new FileInfo(path).Length > MaxBytes) throw new InvalidDataException("存档过大。");
                    string content = File.ReadAllText(path, Encoding.UTF8);
                    int first = content.IndexOf('\n');
                    int second = first < 0 ? -1 : content.IndexOf('\n', first + 1);
                    if (first < 0 || second < 0 || content.Substring(0, first) != Header) throw new InvalidDataException("存档头损坏。");
                    string checksum = content.Substring(first + 1, second - first - 1);
                    string payload = content.Substring(second + 1);
                    if (!string.Equals(checksum, Hash(payload), StringComparison.Ordinal)) throw new InvalidDataException("存档校验失败。");
                    RunState snapshot = decode(payload);
                    string error;
                    if (!ForgeGame.Validate(snapshot, out error)) throw new InvalidDataException(error);
                    result.State = snapshot.Copy(); result.FileName = Path.GetFileName(path);
                    result.Message = result.SkippedFiles == 0 ? "已读取最新有效快照。" : "已跳过" + result.SkippedFiles + "份损坏或不兼容快照，读取最近有效快照。";
                    return result;
                }
                catch (UnauthorizedAccessException) { result.SkippedFiles++; }
                catch (System.Security.SecurityException) { result.SkippedFiles++; }
                catch (IOException) { result.SkippedFiles++; }
                catch (ArgumentException) { result.SkippedFiles++; }
                catch (InvalidOperationException) { result.SkippedFiles++; }
                catch (FormatException) { result.SkippedFiles++; }
                catch (OverflowException) { result.SkippedFiles++; }
            }
            result.Message = paths.Length == 0 ? "未发现存档，可开始新局。" : "没有有效快照。原文件已保留，未自动开新局或覆盖。";
            return result;
        }
    }
}
