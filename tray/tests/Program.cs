using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class Program
{
    private static int passed;
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try { RunSyncTests(); SynchronizationContext.SetSynchronizationContext(null); RunPipeTestsAsync().GetAwaiter().GetResult(); if (args.Contains("--preview")) WriteIconPreview(); if (args.Contains("--style-preview")) StylePreview.Write(); if (args.Contains("--size-preview")) SizePreview.Write(); if (args.Contains("--settings-preview")) SettingsPreview.Write(); Console.WriteLine($"PASS: {passed} C# tests"); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
    private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
    private static void Test(string name, Action run) { run(); passed++; Console.WriteLine("PASS " + name); }
    private static ClientMessage Message(string name, string state = "idle", string type = "hello") => new(1, type, new(name, name, "C:\\" + name, ["c:\\" + name.ToLowerInvariant()], name[..1]), new(state, "fixture", "session", name, "fixture", DateTimeOffset.UtcNow.AddSeconds(-103).ToString("O")));
    private static void RunSyncTests()
    {
        UiText.Select("fr");
        LocalizationTests.Run(Test, Check);
        FeatureTests.Run(Test, Check);
        NotificationTests.Run(Test, Check);
        QuotaSoundTests.Run(Test, Check);
        DialogLayoutTests.Run(Test, Check);
        IconIdentityTests.Run(Test, Check);
        Test("menu interaction defers all native changes and preserves the latest update", () => {
            var visual = new TrayVisualState();
            Check(visual.SetIcon("idle") && visual.SetTooltip("ready") && visual.SetMenu("menu-a"), "initial render");
            visual.MenuOpen = true;
            for (var tick = 0; tick < 10; tick++)
                Check(!visual.SetIcon("working") && !visual.SetTooltip("time-" + tick) && !visual.SetMenu("menu-b"), "menu hover was refreshed");
            visual.MenuOpen = false;
            Check(visual.SetIcon("working") && visual.SetTooltip("time-9") && visual.SetMenu("menu-b"), "latest state lost on close");
            Check(!visual.SetIcon("working") && !visual.SetTooltip("time-9") && !visual.SetMenu("menu-b"), "unchanged native properties refreshed");
        });
        Test("heartbeat timestamps cannot rebuild an unchanged menu while settings can", () => {
            var registry = new WorkspaceRegistry(); var id = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
            var message = Message("A") with { Settings = new(15, 60) };
            registry.Update(message, id, 1, now);
            var key = TrayVisualState.MenuKey(registry.Get("A")!, IconStyle.Rounded, IconSize.Large, 15);
            registry.Update(message with { Type = "heartbeat", Timestamp = now.AddSeconds(10).ToString("O") }, id, 1, now.AddSeconds(10));
            Check(key == TrayVisualState.MenuKey(registry.Get("A")!, IconStyle.Rounded, IconSize.Large, 15), "heartbeat rebuilt menu");
            registry.Update(message with { Settings = new(15, 90) }, id, 1, now);
            Check(key != TrayVisualState.MenuKey(registry.Get("A")!, IconStyle.Rounded, IconSize.Large, 15), "freshness menu failed to update");
        });
        Test("protocol roundtrip and version", () => { var message = Message("Pascale"); Check(Protocol.Parse(Protocol.Serialize(message))?.Workspace?.WorkspaceName == "Pascale", "roundtrip"); Check(Protocol.Parse("{\"version\":2,\"type\":\"hello\"}") is null, "version"); });
        Test("protocol rejects invalid states and malicious roots", () => { Check(Protocol.Parse(Protocol.Serialize(Message("A", "broken"))) is null, "state"); Check(Protocol.Parse("{}") is null, "missing"); Check(Protocol.Parse(new string('x', 16385)) is null, "size"); Check(Protocol.Parse(Protocol.Serialize(Message("A") with { Workspace = new("a", "A", "C:/A", null!, "A") })) is null, "null roots"); });
        Test("four workspaces remain independent", () => {
            var registry = new WorkspaceRegistry(); var now = DateTimeOffset.UtcNow;
            foreach (var (name, state) in new[] { ("Pascale", "idle"), ("Admin", "working"), ("ENT", "unknown"), ("WordPress", "rate_limited") }) registry.Update(Message(name, state), Guid.NewGuid(), 1, now);
            var admin = registry.Get("Admin")!; registry.Update(Message("Admin", "idle", "update"), admin.ConnectionId, 1, now);
            Check(registry.Entries.Count == 4 && registry.Get("ENT")!.Snapshot.State == "unknown" && registry.Get("WordPress")!.Snapshot.State == "rate_limited", "state leakage");
        });
        Test("old transport disconnect cannot remove replacement", () => { var registry = new WorkspaceRegistry(); var old = Guid.NewGuid(); var next = Guid.NewGuid(); registry.Update(Message("A"), old, 1, DateTimeOffset.UtcNow); registry.Update(Message("A"), next, 1, DateTimeOffset.UtcNow); Check(!registry.Remove("A", old), "old disconnect"); Check(!registry.Update(Message("A", "working", "update"), old, 1, DateTimeOffset.UtcNow), "old update"); Check(registry.Get("A")!.Snapshot.State == "idle", "replacement state"); });
        Test("heartbeat expires only dead peer", () => { var registry = new WorkspaceRegistry(TimeSpan.FromSeconds(35)); var now = DateTimeOffset.UtcNow; registry.Update(Message("A"), Guid.NewGuid(), 1, now.AddSeconds(-36)); registry.Update(Message("B"), Guid.NewGuid(), 1, now.AddSeconds(-10)); Check(registry.Expire(now).SequenceEqual(["A"]) && registry.Entries.Count == 1, "timeout isolation"); });
        Test("disconnect removes every icon entry owned by client", () => { var registry = new WorkspaceRegistry(); var id = Guid.NewGuid(); registry.Update(Message("A"), id, 1, DateTimeOffset.UtcNow); registry.Update(Message("B"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(registry.RemoveConnection(id).SequenceEqual(["A"]) && registry.Entries.Count == 1, "disconnect"); });
        Test("same root ambiguity and session pin", () => { var registry = new WorkspaceRegistry(); var first = Message("A"); registry.Update(first, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); registry.Update(first with { Workspace = first.Workspace! with { WorkspaceId = "other" } }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(registry.IsAmbiguous(registry.Get("A")!), "same path"); registry.Update(first with { PinnedSession = true }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(!registry.IsAmbiguous(registry.Get("A")!), "explicit session"); });
        Test("singleton admits only one owner and releases", () => { var key = Guid.NewGuid().ToString(); using (var first = new SingletonGuard(key)) { using var second = new SingletonGuard(key); Check(first.Acquired && !second.Acquired, "two owners"); } using var next = new SingletonGuard(key); Check(next.Acquired, "release"); });
        Test("SSH roots preserve server scope and Linux case", () => { var registry = new WorkspaceRegistry(); var first = Message("A") with { Workspace = new("A", "A", "vscode-remote://ssh-remote+first/srv/A", ["vscode-remote://ssh-remote+first/srv/A"], "A"), PinnedSession = true }; var second = first with { Workspace = new("B", "A", "vscode-remote://ssh-remote+second/srv/A", ["vscode-remote://ssh-remote+second/srv/A"], "A") }; registry.Update(first, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); registry.Update(second, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(!registry.IsAmbiguous(registry.Get("A")!), "pin leaked across servers"); registry.Update(second with { PinnedSession = false, Workspace = second.Workspace! with { WorkspacePath = "vscode-remote://ssh-remote+first/srv/a", WorkspaceRoots = ["vscode-remote://ssh-remote+first/srv/a"] } }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); registry.Update(first with { PinnedSession = false }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(!registry.IsAmbiguous(registry.Get("A")!), "Linux case lost"); });
        Test("duration tooltip and state wording", () => { var registry = new WorkspaceRegistry(); registry.Update(Message("Pascale", "working"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow); var tooltip = TrayPresentation.Tooltip(registry.Get("Pascale")!, DateTimeOffset.UtcNow); Check(tooltip.StartsWith("Pascale" + Environment.NewLine) && tooltip.Contains("01:43") && tooltip.Contains("Codex travaille"), "tooltip"); Check(TrayPresentation.StateText("rate_limited") == "Quota épuisé", "quota text"); });
        Test("tooltip length is bounded with long workspace names", () => { var registry = new WorkspaceRegistry(); var message = Message("A", "working"); registry.Update(message with { Workspace = message.Workspace! with { WorkspaceName = new string('a', 256) } }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow); Check(TrayPresentation.Tooltip(registry.Get("A")!, DateTimeOffset.UtcNow).Length <= 127, "tooltip overflow"); });
        Test("menu labels and focus handler without a quit action", () => { var registry = new WorkspaceRegistry(); registry.Update(Message("Pascale", "working"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow); var focuses = 0; using var menu = TrayPresentation.CreateMenu(registry.Get("Pascale")!, () => focuses++); Check(menu.Items.Count == 10 && menu.Items[0].Text == "Pascale" && menu.Items[3].Text!.Contains("Codex travaille") && menu.Items[^1].Text == UiText.Get("menu.help"), "menu contents"); menu.Items[2].PerformClick(); Check(focuses == 1, "focus handler"); });
        Test("timing protocol validates bounds and correlated save results", () => {
            var message = Message("A") with { Settings = new(45, 90) };
            Check(Protocol.Parse(Protocol.Serialize(message))?.Settings == message.Settings, "timing roundtrip");
            Check(Protocol.Parse(Protocol.Serialize(message with { Settings = new(4, 60) })) is null, "exit minimum");
            Check(Protocol.Parse(Protocol.Serialize(message with { Settings = new(15, 1441) })) is null, "freshness maximum");
            Check(Protocol.Parse(Protocol.Serialize(Message("A", "waiting_for_user"))) is null, "removed state accepted");
            var result = new ClientMessage(1, "configuration_result", WorkspaceId: "A", RequestId: "request", Success: true);
            Check(Protocol.Parse(Protocol.Serialize(result))?.Success == true, "save acknowledgement");
            Check(Protocol.Parse(Protocol.Serialize(result with { Success = null })) is null, "missing result");
        });
        Test("one settings action replaces timing submenus without affecting other actions", () => {
            var registry = new WorkspaceRegistry(); registry.Update(Message("A") with { Settings = new(45, 600, ConfigurationVersion: 3) }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            var calls = 0;
            using var menu = TrayPresentation.CreateMenu(registry.Get("A")!, () => throw new Exception("focus"), openSettings: () => calls++);
            Check(menu.Items[8].Enabled && menu.Items[8].Text == "Paramètres" && menu.Items.Count == 10, "settings menu");
            Check(!menu.ShowItemToolTips && menu.Items.OfType<ToolStripMenuItem>().All(item => string.IsNullOrEmpty(item.ToolTipText)), "hover help reintroduced");
            menu.Items[8].PerformClick();
            Check(calls == 1, "settings action");
        });
        Test("older clients have disabled timing controls", () => {
            var registry = new WorkspaceRegistry(); registry.Update(Message("A"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            using var menu = TrayPresentation.CreateMenu(registry.Get("A")!, () => {}, openSettings: () => throw new Exception("unsupported write"));
            Check(!menu.Items[8].Enabled, "legacy client could write settings");
            Check(menu.Items[8].Text?.Contains("recharger VS Code") == true, "missing update explanation");
            registry.Update(Message("A") with { Settings = new(15, 60) }, Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            using var older = TrayPresentation.CreateMenu(registry.Get("A")!, () => {}, openSettings: () => {});
            Check(!older.Items[8].Enabled, "batch request sent to old single-setting client");
        });
        Test("settings dialog selects custom freshness and removes the exit delay control", () => {
            using var dialog = new TimingSettingsDialog("workspace [SSH: fixture.example]", true, new(300, 600), _ => Task.FromResult(true));
            var input = (ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single();
            Check(dialog.Controls.Find("exit_grace_seconds", true).Length == 0, "removed exit delay control present");
            Check(input.Items.Contains("600") && input.SelectedItem?.ToString() == "600", "saved custom value missing");
            Check(TimingSettingSpec.Find("stale_working_minutes")!.Choices(600).Count(value => value == 600) == 1, "duplicate custom value");
            input.Text = "1441";
            Check(!dialog.TryGetSettings(out _), "bounds ignored");
            input.Text = "600,5";
            Check(dialog.TryGetSettings(out var selected) && selected.StaleWorkingMinutes == 600.5, "decimal comma");
            Check(dialog.AcceptButton is not null && dialog.CancelButton is not null, "save or cancel missing");
        });
        Test("failed settings save keeps the dialog open and invalid input never writes", () => {
            var writes = 0;
            using var dialog = new TimingSettingsDialog("A", true, new(15, 600), _ => { writes++; return Task.FromResult(false); });
            var input = (ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single();
            input.Text = "bad";
            Check(!dialog.SaveAsync().GetAwaiter().GetResult() && writes == 0, "invalid save");
            input.Text = "60";
            Check(!dialog.SaveAsync().GetAwaiter().GetResult() && writes == 1 && dialog.DialogResult != DialogResult.OK, "failed save closed dialog");
            Check(((Label)dialog.Controls.Find("feedback", true).Single()).Text.Contains("impossible"), "missing save error");
        });
        Test("saving language and freshness preserves the custom choice and cancel never writes", () => {
            TimingSettings? saved = null; var writes = 0;
            using (var dialog = new TimingSettingsDialog("A", true, new(15, 60), selected => { saved = selected; writes++; return Task.FromResult(true); })) {
                ((ComboBox)dialog.Controls.Find("language", true).Single()).SelectedIndex = Array.IndexOf(UiText.Preferences, "en");
                ((ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single()).Text = "617";
                Check(dialog.SaveAsync().GetAwaiter().GetResult() && writes == 1 && saved == new TimingSettings(15, 617, Language: "en"), "both values were not saved together");
            }
            using var reopened = new TimingSettingsDialog("A", true, saved!, _ => { writes++; return Task.FromResult(true); });
            var custom = (ComboBox)reopened.Controls.Find("stale_working_minutes", true).Single();
            Check(custom.Items.Contains("617") && custom.SelectedItem?.ToString() == "617", "saved custom choice lost on reopen");
            custom.Text = "90";
            ((Button)reopened.CancelButton!).PerformClick();
            Check(writes == 1 && saved!.StaleWorkingMinutes == 617, "cancel changed settings");
        });
        Test("each style contains valid images at all DPI sizes and native small icons decode", () => {
            foreach (var style in IconStyles.All) foreach (var size in IconSizes.All) {
                var data = IconRenderer.RenderIco("P", "working", style, iconSize: size); Check(BitConverter.ToUInt16(data, 4) == 8, "ico resolutions");
                var sizes = new[] { 16, 20, 24, 32, 40, 48, 64, 256 };
                for (var index = 0; index < sizes.Length; index++) {
                    var length = BitConverter.ToInt32(data, 6 + index * 16 + 8); var offset = BitConverter.ToInt32(data, 6 + index * 16 + 12);
                    using var png = new MemoryStream(data, offset, length); using var bitmap = new System.Drawing.Bitmap(png);
                    Check(bitmap.Width == sizes[index] && bitmap.Height == sizes[index], "image " + style + " size " + sizes[index]);
                    if (sizes[index] <= 64) { using var stream = new MemoryStream(data); using var icon = new System.Drawing.Icon(stream, sizes[index], sizes[index]); Check(icon.Width == sizes[index], "native " + style + " size " + sizes[index]); }
                }
            }
        });
        Test("style menu checks the current choice and invokes selection independently", () => {
            var registry = new WorkspaceRegistry(); registry.Update(Message("Pascale"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            var selected = IconStyle.Rounded; var calls = 0;
            using var menu = TrayPresentation.CreateMenu(registry.Get("Pascale")!, () => throw new Exception("focus fired"), selected, style => { selected = style; calls++; });
            var choices = ((ToolStripMenuItem)menu.Items[5]).DropDownItems.Cast<ToolStripMenuItem>().ToArray();
            Check(choices.Length == 3 && choices.Count(item => item.Checked) == 1 && choices[1].Checked, "checked style");
            choices[2].PerformClick(); Check(selected == IconStyle.Minimal && calls == 1, "select minimal");
            using var updated = TrayPresentation.CreateMenu(registry.Get("Pascale")!, () => {}, selected, _ => {});
            Check(((ToolStripMenuItem)((ToolStripMenuItem)updated.Items[5]).DropDownItems[2]).Checked, "updated menu choice");
        });
        Test("appearance survives a new companion instance and rejects unknown enum values", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-style-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
            var filename = Path.Combine(directory, "appearance.json");
            try { var appearance = new IconAppearance(filename); Check(appearance.Style == IconStyle.Flat, "modern default"); foreach (var style in IconStyles.All) { Check(appearance.Select(style), "save " + style); Check(new IconAppearance(filename).Style == style, "reload " + style); } Check(!appearance.Select((IconStyle)99) && appearance.Style == IconStyle.Minimal, "invalid choice"); Check(Directory.GetFiles(directory).Length == 1, "temporary write leaked"); }
            finally { File.Delete(filename); Directory.Delete(directory); }
        });
        Test("size menu checks the current choice without changing style or focus", () => {
            var registry = new WorkspaceRegistry(); registry.Update(Message("Pascale"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            var selected = IconSize.Medium; var calls = 0;
            using var menu = TrayPresentation.CreateMenu(registry.Get("Pascale")!, () => throw new Exception("focus fired"), IconStyle.Rounded, _ => throw new Exception("style fired"), selected, size => { selected = size; calls++; });
            var choices = ((ToolStripMenuItem)menu.Items[6]).DropDownItems.Cast<ToolStripMenuItem>().ToArray();
            Check(choices.Length == 3 && choices.Count(item => item.Checked) == 1 && choices[1].Checked, "checked size");
            choices[2].PerformClick(); Check(selected == IconSize.Large && calls == 1, "select large");
            using var updated = TrayPresentation.CreateMenu(registry.Get("Pascale")!, () => {}, IconStyle.Rounded, _ => {}, selected, _ => {});
            Check(((ToolStripMenuItem)((ToolStripMenuItem)updated.Items[6]).DropDownItems[2]).Checked, "updated size");
        });
        Test("style and size persist independently through every combination", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-size-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
            var filename = Path.Combine(directory, "appearance.json");
            try {
                var appearance = new IconAppearance(filename); Check(appearance.Size == IconSize.Small, "current size default");
                foreach (var size in IconSizes.All) {
                    Check(appearance.SelectSize(size), "save size");
                    foreach (var style in IconStyles.All) {
                        Check(appearance.Select(style) && appearance.Size == size, "style changed size");
                        var restored = new IconAppearance(filename); Check(restored.Style == style && restored.Size == size, "restore pair");
                    }
                    Check(appearance.Style == IconStyle.Minimal, "size changed style");
                }
                Check(!appearance.SelectSize((IconSize)99) && appearance.Size == IconSize.Large, "invalid size");
                Check(Directory.GetFiles(directory).Length == 1, "temporary write leaked");
            } finally { File.Delete(filename); Directory.Delete(directory); }
        });
        Test("legacy preferences retain style and invalid sizes default to small", () => {
            var filename = Path.Combine(Path.GetTempPath(), "codex-size-" + Guid.NewGuid().ToString("N") + ".json");
            try {
                foreach (var suffix in new[] { "", ",\"size\":\"huge\"", ",\"size\":3", ",\"size\":null" }) {
                    File.WriteAllText(filename, "{\"version\":1,\"style\":\"rounded\"" + suffix + "}");
                    var appearance = new IconAppearance(filename); Check(appearance.Style == IconStyle.Rounded && appearance.Size == IconSize.Small, "legacy or invalid size lost style");
                }
                File.WriteAllText(filename, "{\"version\":1,\"style\":false,\"size\":\"large\"}");
                Check(new IconAppearance(filename).Size == IconSize.Large, "invalid style lost size");
                File.WriteAllText(filename, "{\"version\":1,\"style\":\"classic\",\"size\":\"large\"}");
                var migrated = new IconAppearance(filename);
                Check(migrated.Style == IconStyle.Flat && migrated.Size == IconSize.Large, "removed style lost fallback or size");
            } finally { File.Delete(filename); }
        });
        Test("larger presets visibly occupy more of the same Windows icon slot", () => {
            foreach (var style in IconStyles.All) foreach (var pixels in new[] { 16, 20, 24, 32 }) {
                var previous = 0;
                foreach (var size in IconSizes.All) {
                    using var image = IconRenderer.RenderBitmap("P", "idle", pixels, style, iconSize: size);
                    var coverage = 0;
                    for (var y = 0; y < pixels; y++) for (var x = 0; x < pixels; x++) if (image.GetPixel(x, y).A >= 128) coverage++;
                    Check(coverage > previous, $"size did not grow: {style}/{pixels}/{size} ({previous} -> {coverage})"); previous = coverage;
                    Check(image.Width == pixels && image.Height == pixels, "changed Windows slot");
                }
            }
        });
        Test("corrupt and oversized appearance files use a safe modern default", () => {
            var filename = Path.Combine(Path.GetTempPath(), "codex-style-" + Guid.NewGuid().ToString("N") + ".json");
            try { foreach (var contents in new[] { "{", "[]", "{\"version\":\"1\",\"style\":\"rounded\"}", "{\"version\":1,\"style\":\"unknown\"}", new string('x', 5000) }) { File.WriteAllText(filename, contents); Check(new IconAppearance(filename).Style == IconStyle.Flat, "unsafe preference accepted"); } }
            finally { File.Delete(filename); }
        });
        Test("a failed preference write preserves the style for the current session", () => {
            var directory = Path.Combine(Path.GetTempPath(), "codex-style-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
            var filename = Path.Combine(directory, "blocked.json"); Directory.CreateDirectory(filename);
            try { var appearance = new IconAppearance(filename); Check(!appearance.Select(IconStyle.Minimal) && appearance.Style == IconStyle.Minimal, "session choice lost"); Check(!appearance.SelectSize(IconSize.Large) && appearance.Size == IconSize.Large && appearance.Style == IconStyle.Minimal, "failed size write lost pair"); Check(Directory.GetFiles(directory).Length == 0, "failed write leaked"); }
            finally { Directory.Delete(filename); Directory.Delete(directory); }
        });
        Test("icon colors independent and stable native wrapper starts hidden", () => { Check(IconRenderer.StateColor("idle") != IconRenderer.StateColor("working"), "colors"); using var icon = IconRenderer.Create("A", "idle"); var identity = Guid.NewGuid(); using var native = new StableNotifyIcon(identity) { Icon = icon, Text = "Codex Status test" }; Check(native.Identity == identity && !native.Visible, "icon identity or hidden initialization"); });
        Test("unknown focus never launches new Code window", () => { var focus = new WindowFocus(); Check(!focus.Focus(Guid.NewGuid().ToString(), "NO_SUCH_WORKSPACE_" + Guid.NewGuid()), "focus ambiguity"); });
        Test("focus matches exact workspace title, not a prefix or domain", () => { Check(WindowFocus.TitleMatchesWorkspace("README.md - Pascale - Visual Studio Code", "Pascale"), "workspace segment"); Check(!WindowFocus.TitleMatchesWorkspace("Codex Diff - assistant.example [SSH: assistant.example] - Visual Studio Code", "Pascale"), "domain collision"); Check(!WindowFocus.TitleMatchesWorkspace("Admin-tools - Visual Studio Code", "Admin"), "prefix collision"); Check(WindowFocus.TitleMatchesWorkspace("ENT – Visual Studio Code", "ENT"), "unicode separator"); });
    }
    private static async Task RunPipeTestsAsync()
    {
        var pipeName = "codex_status_test_" + Guid.NewGuid().ToString("N");
        await using var server = new PipeServer(pipeName);
        var received = new List<(Guid Id, ClientMessage Message)>(); var disconnected = new List<Guid>();
        server.MessageReceived += (connection, message) => { lock (received) received.Add((connection.Id, message)); _ = connection.SendAsync(new { version = 1, type = "welcome", server_pid = Environment.ProcessId }); };
        server.Disconnected += id => { lock (disconnected) disconnected.Add(id); }; server.Start();
        using var first = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        using var second = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await first.ConnectAsync(5000); await second.ConnectAsync(5000);
        await first.WriteAsync(Encoding.UTF8.GetBytes(Protocol.Serialize(Message("Pascale")))); await second.WriteAsync(Encoding.UTF8.GetBytes(Protocol.Serialize(Message("Admin", "working"))));
        await WaitAsync(() => { lock (received) return received.Count >= 2; });
        Test("real named pipe accepts independent clients", () => { lock (received) Check(received.Select(item => item.Id).Distinct().Count() == 2 && received.Select(item => item.Message.Workspace!.WorkspaceName).Order().SequenceEqual(new[] { "Admin", "Pascale" }), "pipe clients"); });
        var bytes = Encoding.UTF8.GetBytes(Protocol.Serialize(Message("Pascale", "working", "update"))); await first.WriteAsync(bytes.AsMemory(0, 17)); await first.WriteAsync(bytes.AsMemory(17));
        await WaitAsync(() => { lock (received) return received.Count >= 3; }); Test("pipe reconstructs fragmented JSON", () => { lock (received) Check(received.Last().Message.Snapshot!.State == "working", "fragments"); });
        await first.WriteAsync(Encoding.UTF8.GetBytes(Protocol.Serialize(Message("intruder", "working", "update")))); await WaitAsync(() => { lock (disconnected) return disconnected.Count > 0; });
        Test("connection cannot change its workspace identity", () => { lock (received) Check(received.Count == 3, "identity switch accepted"); });
        using var oversized = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous); await oversized.ConnectAsync(5000);
        try { await oversized.WriteAsync(new byte[17000]); } catch (IOException) { }
        await WaitAsync(() => { lock (disconnected) return disconnected.Count >= 2; }); Test("oversized peer is disconnected without affecting others", () => Check(second.IsConnected, "other client"));
        second.Dispose(); await WaitAsync(() => { lock (disconnected) return disconnected.Count >= 3; }); Test("dead pipe client generates disconnect", () => { lock (disconnected) Check(disconnected.Count >= 3, "disconnect event"); });
    }
    private static async Task WaitAsync(Func<bool> condition) { var deadline = DateTime.UtcNow.AddSeconds(5); while (!condition()) { if (DateTime.UtcNow > deadline) throw new TimeoutException("test event timeout"); await Task.Delay(20); } }
    private static void WriteIconPreview()
    {
        Directory.CreateDirectory("icons");
        using var preview = new System.Drawing.Bitmap(640, 256);
        using var graphics = System.Drawing.Graphics.FromImage(preview);
        graphics.Clear(System.Drawing.Color.FromArgb(245, 247, 250));
        using var font = new System.Drawing.Font("Segoe UI", 10);
        using var dark = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(28, 32, 39));
        using var ink = new System.Drawing.SolidBrush(System.Drawing.Color.FromArgb(35, 40, 47));
        using var white = new System.Drawing.SolidBrush(System.Drawing.Color.White);
        graphics.DrawString("Codex Status — tailles réelles, 100 / 125 / 150 / 200 %", font, ink, 14, 10);
        var states = new[] { "idle", "working", "rate_limited", "unknown" };
        var labels = new[] { "P", "A", "E", "W", "?" };
        for (var column = 0; column < states.Length; column++)
        {
            var x = 15 + column * 124;
            graphics.DrawString(labels[column] + " / " + states[column], font, ink, x, 45);
            for (var row = 0; row < 2; row++)
            {
                var y = 78 + row * 75;
                if (row == 1) graphics.FillRectangle(dark, x - 3, y - 5, 116, 66);
                var offset = 0;
                foreach (var size in new[] { 16, 20, 24, 32 })
                {
                    using var icon = IconRenderer.RenderBitmap(labels[column], states[column], size);
                    graphics.DrawImageUnscaled(icon, x + offset, y + (32 - size) / 2);
                    graphics.DrawString(size.ToString(), font, row == 1 ? white : ink, x + offset, y + 36);
                    offset += size + 5;
                }
            }
        }
        preview.Save("icons/preview.png", System.Drawing.Imaging.ImageFormat.Png);
        File.WriteAllBytes("icons/pascale-idle.ico", IconRenderer.RenderIco("P", "idle"));
    }
}
