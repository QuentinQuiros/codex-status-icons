using CodexStatusTray.Core;
using CodexStatusTray.Windows;
using System.Text.RegularExpressions;

namespace CodexStatusTray;
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--cleanup-icon-history"))
        {
            var additional = args.Select((value, index) => value == "--legacy-executable" && index + 1 < args.Length ? args[index + 1] : null).OfType<string>();
            var result = LegacyIconCleanup.CleanInstalledHistory(additional, preview: !args.Contains("--apply-cleanup"));
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result, Protocol.JsonOptions));
            return result.Error is null ? 0 : 1;
        }
        var pipeName = ReadOption(args, "--pipe");
        if (pipeName is null || !Regex.IsMatch(pipeName, "^codex_status_[a-zA-Z0-9_]{1,80}$")) return 2;
        var isolatedTest = args.Contains("--test-instance") && pipeName.StartsWith("codex_status_test_", StringComparison.Ordinal);
        using var singleton = new SingletonGuard(isolatedTest ? "tray/" + pipeName : "tray");
        if (!singleton.Acquired) return 0;
        var cleanup = isolatedTest ? null : LegacyIconCleanup.CleanInstalledHistory();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var appearance = isolatedTest ? new IconAppearance(ReadOption(args, "--appearance-file") ?? Path.Combine(Path.GetTempPath(), pipeName + ".json")) : null;
        using var context = new TrayContext(pipeName, args.Contains("--keep-alive"), appearance, cleanup);
        Application.Run(context); return 0;
    }
    private static string? ReadOption(string[] args, string option) { var index = Array.IndexOf(args, option); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
}
