using CodexStatusTray.Core;
using CodexStatusTray.Windows;
using Microsoft.Win32;
using System.Text.Json;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class IconIdentityTests
{
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        WorkspaceInfo Workspace(string id, params string[] roots) => new(id, "Workspace", roots.FirstOrDefault() ?? "", roots, "W");
        test("native notification data matches the Windows Unicode ABI", () => {
            var data = typeof(StableNotifyIcon).GetNestedType("NotifyData", BindingFlags.NonPublic)!;
            check(Marshal.SizeOf(data) == (IntPtr.Size == 8 ? 976 : 956), "NOTIFYICONDATAW layout mismatch");
        });
        test("migration retains packaged appearance preferences without overwriting the new location", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-migrate-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            var previous = Path.Combine(directory, "old.json"); var current = Path.Combine(directory, "current.json");
            try {
                File.WriteAllText(previous, "{\"version\":1,\"style\":\"rounded\",\"size\":\"large\"}");
                var migrated = new IconAppearance(current, previous);
                check(migrated.Style == IconStyle.Rounded && migrated.Size == IconSize.Large && File.Exists(current), "appearance reset during migration");
                File.WriteAllText(current, "{\"version\":1,\"style\":\"minimal\",\"size\":\"medium\"}");
                var saved = new IconAppearance(current, previous);
                check(saved.Style == IconStyle.Minimal && saved.Size == IconSize.Medium, "existing preference overwritten");
            } finally { Directory.Delete(directory, recursive: true); }
        });
        test("version-four shell callbacks preserve signed coordinates and fire one action per click", () => {
            using var icon = new StableNotifyIcon(Guid.NewGuid());
            var clicks = new List<MouseEventArgs>(); icon.MouseClick += (_, args) => clicks.Add(args);
            var callback = typeof(StableNotifyIcon).GetMethod("OnCallback", BindingFlags.Instance | BindingFlags.NonPublic)!;
            var position = new IntPtr(unchecked((long)(((uint)(ushort)-300 << 16) | (ushort)120)));
            callback.Invoke(icon, [position, new IntPtr(0x10000 | 0x400)]);
            callback.Invoke(icon, [position, new IntPtr(0x10000 | 0x202)]);
            callback.Invoke(icon, [position, new IntPtr(0x10000 | 0x7b)]);
            check(clicks.Count == 2 && clicks[0].Button == MouseButtons.Left && clicks[1].Button == MouseButtons.Right && clicks.All(click => click.X == 120 && click.Y == -300), "mouse callback mapping");
        });
        test("icon GUID survives transport reload, local path case, root order and presentation changes", () => {
            var first = new IconIdentityRegistry().Assign(Workspace("random-a", "C:\\Work\\One", "D:/Two/"));
            var second = new IconIdentityRegistry().Assign(Workspace("random-b", "d:/two", "c:/work/one/") with { Label = "P", WorkspaceName = "Nom français" });
            check(first == second && first != Guid.Empty, "workspace GUID changed");
        });
        test("SSH icon identities retain server scope and Linux path case", () => {
            var first = new IconIdentityRegistry().Assign(Workspace("a", "vscode-remote://ssh-remote+host-one/srv/A"));
            var second = new IconIdentityRegistry().Assign(Workspace("b", "vscode-remote://ssh-remote+host-two/srv/A"));
            var lower = new IconIdentityRegistry().Assign(Workspace("c", "vscode-remote://ssh-remote+host-one/srv/a"));
            check(first != second && first != lower, "SSH scopes collided");
        });
        test("duplicate windows have distinct reusable icon slots and workspace changes release the old slot", () => {
            var registry = new IconIdentityRegistry();
            var first = registry.Assign(Workspace("a", "C:/One"));
            var second = registry.Assign(Workspace("b", "C:/One"));
            check(first != second && registry.Assign(Workspace("b", "C:/One")) == second, "duplicate identity");
            registry.Remove("a");
            check(registry.Assign(Workspace("reopened", "C:/One")) == first, "reopened slot lost");
            registry.Assign(Workspace("reopened", "C:/Other"));
            check(registry.Assign(Workspace("next", "C:/One")) == first, "workspace change leaked slot");
        });
        test("cleanup matches only exact owned cache and extension layouts", () => {
            var root = "C:/Users/Fixture/AppData/Local/codex-status/bin";
            var extensions = "C:/Users/Fixture/.vscode/extensions";
            var old = root + "/" + new string('a', 64) + "/codex_status_tray.exe";
            check(LegacyIconCleanup.IsLegacyPath(old, [root], extensions), "owned history missed");
            check(LegacyIconCleanup.IsLegacyPath(extensions + "/local-codex-tools.codex-status-0.6.2/bin/win-x64/codex_status_tray.exe", [root], extensions), "extension history missed");
            foreach (var path in new[] { root + "/stable/Codex Status Icons.exe", root + "/other/codex_status_tray.exe", "C:/Other/" + new string('a', 64) + "/codex_status_tray.exe", extensions + "/someone.codex-status-0.6.2/bin/win-x64/codex_status_tray.exe" })
                check(!LegacyIconCleanup.IsLegacyPath(path, [root], extensions), "unrelated or stable entry selected");
        });
        test("cleanup backs up value types before deletion and preserves running and unrelated entries", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-history-" + Guid.NewGuid().ToString("N"));
            var root = "C:/Users/Fixture/AppData/Local/codex-status/bin";
            var old = root + "/" + new string('a', 64) + "/codex_status_tray.exe";
            var active = root + "/" + new string('b', 64) + "/codex_status_tray.exe";
            var store = new FakeStore([Entry("old", old), Entry("active", active), Entry("other", "C:/Other/app.exe")]);
            store.BeforeDelete = _ => check(Directory.GetFiles(directory).Length == 1, "deletion preceded backup");
            try {
                var result = LegacyIconCleanup.Run(store, [root], "C:/Extensions", [active], directory);
                check(result.Deleted == 1 && store.Entries.Select(entry => entry.Key).SequenceEqual(["active", "other"]), "cleanup scope");
                using var backup = JsonDocument.Parse(File.ReadAllText(result.Backup!));
                var saved = backup.RootElement.GetProperty("entries")[0].GetProperty("Values");
                check(saved.GetProperty("IsPromoted").GetProperty("Value").GetInt32() == 1 && saved.GetProperty("IconSnapshot").GetProperty("Value").GetString() == "AQID", "backup values lost");
            } finally { Directory.Delete(directory, recursive: true); }
        });
        test("cleanup failure to create a backup prevents every deletion", () => {
            var filename = Path.Combine(Path.GetTempPath(), "codex-history-" + Guid.NewGuid().ToString("N"));
            var root = "C:/Owned"; var store = new FakeStore([Entry("old", root + "/" + new string('a', 64) + "/codex_status_tray.exe")]);
            File.WriteAllText(filename, "occupied backup directory");
            try { var result = LegacyIconCleanup.Run(store, [root], "C:/Extensions", [], filename); check(result.Error is not null && store.Entries.Count == 1, "deleted without recovery file"); }
            finally { File.Delete(filename); }
        });
        test("cleanup protects redirected MSIX cache entries for a running logical executable path", () => {
            var logical = "C:/Local/codex-status/bin";
            var redirected = "C:/Package/LocalCache/Local/codex-status/bin";
            var suffix = "/" + new string('a', 64) + "/codex_status_tray.exe";
            var store = new FakeStore([Entry("active", redirected + suffix), Entry("old", redirected + "/" + new string('b', 64) + "/codex_status_tray.exe")]);
            var report = LegacyIconCleanup.Run(store, [logical, redirected], "C:/Extensions", [logical + suffix], "C:/Unused", preview: true);
            check(report.PlannedKeys!.SequenceEqual(["old"]) && store.Entries.Count == 2, "redirected active icon selected for deletion");
        });
        test("a partial cleanup failure reports the deleted count and keeps its completed backup", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-history-" + Guid.NewGuid().ToString("N"));
            var root = "C:/Owned";
            var old = root + "/" + new string('a', 64) + "/codex_status_tray.exe";
            var store = new FakeStore([Entry("first", old), Entry("second", old)]);
            store.BeforeDelete = entry => { if (entry.Key == "second") throw new IOException("fixture failure"); };
            try {
                var report = LegacyIconCleanup.Run(store, [root], "C:/Extensions", [], directory);
                check(report.Candidates == 2 && report.Deleted == 1 && report.Error is not null && File.Exists(report.Backup) && store.Entries.Count == 1, "partial result or recovery file lost");
            } finally { Directory.Delete(directory, recursive: true); }
        });
        test("cleanup preview does not write files or delete explicitly selected development history", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-history-" + Guid.NewGuid().ToString("N"));
            var development = "C:/Development/extension/bin/win-x64/codex_status_tray.exe";
            var store = new FakeStore([Entry("selected", development), Entry("other", "C:/Other/codex_status_tray.exe")]);
            var result = LegacyIconCleanup.Run(store, ["C:/Cache"], "C:/Extensions", [], directory, [development], preview: true);
            check(result.Candidates == 1 && result.Deleted == 0 && result.PlannedKeys!.SequenceEqual(["selected"]) && !Directory.Exists(directory) && store.Entries.Count == 2, "preview mutated history or selected another path");
        });
    }
    private static IconHistoryEntry Entry(string id, string path) => new(id, path, new() {
        ["ExecutablePath"] = new(RegistryValueKind.String, path), ["IsPromoted"] = new(RegistryValueKind.DWord, 1), ["IconSnapshot"] = new(RegistryValueKind.Binary, new byte[] { 1, 2, 3 })
    });
    private sealed class FakeStore(List<IconHistoryEntry> entries) : IIconHistoryStore
    {
        public List<IconHistoryEntry> Entries { get; } = entries;
        public Action<IconHistoryEntry>? BeforeDelete { get; set; }
        public IEnumerable<IconHistoryEntry> Read() => Entries.ToArray();
        public bool DeleteIfUnchanged(IconHistoryEntry entry) { BeforeDelete?.Invoke(entry); return Entries.Remove(entry); }
    }
}
