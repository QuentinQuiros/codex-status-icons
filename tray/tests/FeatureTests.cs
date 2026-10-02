using System.Text.Json;
using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class FeatureTests
{
    private static WorkspaceEntry Entry(string reason = "stale_session") => new(new("fixture", "Projet [SSH: fixture.example]", "vscode-remote://ssh-remote+fixture/srv/project", ["vscode-remote://ssh-remote+fixture/srv/project"], "P"), new("unknown", reason, "session", "session-id", "fixture-cli"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow, false, true, false, new(15, 600, ConfigurationVersion: 4), "fixture-extension", "ssh-remote", "fixture-bridge");
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        test("grey reasons are translated and unknown codes never appear as raw user-facing text", () => {
            try {
                foreach (var code in new[] { "fr", "en" }) {
                    UiText.Select(code);
                    foreach (var reason in new[] { "stale_session", "no_matching_session", "remote_unavailable", "remote_bridge_reload_required", "codex_extension_absent", "ambiguous_workspace_windows", "initializing", "remote_reply_mismatch", "PRIVATE_PROMPT" }) {
                        var entry = Entry(reason);
                        var tooltip = TrayPresentation.Tooltip(entry, DateTimeOffset.UtcNow);
                        check(tooltip.Contains(TrayPresentation.UnknownReason(reason)) && tooltip.Length <= 127, "reason or tooltip bound");
                        using var menu = TrayPresentation.CreateMenu(entry, () => {});
                        check(menu.Items[3].Text!.Contains(TrayPresentation.UnknownReason(reason)) && !tooltip.Contains("PRIVATE_PROMPT"), "raw reason leaked to interface");
                    }
                    var visual = new TrayVisualState();
                    check(visual.SetMenu(TrayVisualState.MenuKey(Entry(), IconStyle.Flat, IconSize.Small, 15)), "initial menu");
                    check(visual.SetMenu(TrayVisualState.MenuKey(Entry("remote_unavailable"), IconStyle.Flat, IconSize.Small, 15)), "changed grey reason not refreshed");
                }
            }
            finally { UiText.Select("fr"); }
        });
        test("custom letters save with other fields, restore automatic mode and stay read-only for older clients", () => {
            foreach (var value in new[] { "", "Q", "7", "é", "e\u0301", "𝔄" }) check(TimingSettings.ValidLabel(value), "valid letter " + value);
            foreach (var value in new[] { "QQ", " ", "?", "🧩", "Q\n", "\u0301" }) check(!TimingSettings.ValidLabel(value), "invalid letter");
            var settings = new TimingSettings(15, 60, ConfigurationVersion: 4); TimingSettings? saved = null; var writes = 0;
            using (var dialog = new TimingSettingsDialog("Projet", true, settings, value => { saved = value; writes++; return Task.FromResult(true); })) {
                var label = (TextBox)dialog.Controls.Find("workspace_label", true).Single(); check(label.Enabled && label.Text == "", "automatic default");
                label.Text = "QQ"; check(!dialog.SaveAsync().GetAwaiter().GetResult() && writes == 0, "invalid label saved");
                label.Text = "é"; ((ComboBox)dialog.Controls.Find("language", true).Single()).SelectedIndex = 2;
                ((ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single()).Text = "90";
                check(dialog.SaveAsync().GetAwaiter().GetResult() && saved == (settings with { WorkspaceLabel = "é", Language = "en", StaleWorkingMinutes = 90 }), "combined save");
            }
            using (var reopened = new TimingSettingsDialog("Projet", true, saved!, value => { saved = value; writes++; return Task.FromResult(true); })) {
                var label = (TextBox)reopened.Controls.Find("workspace_label", true).Single(); check(label.Text == "é", "saved letter missing"); label.Text = "";
                check(reopened.SaveAsync().GetAwaiter().GetResult() && saved!.WorkspaceLabel == "" && writes == 2, "automatic restore");
            }
            using var older = new TimingSettingsDialog("Projet", true, settings with { ConfigurationVersion = 3 }, _ => throw new Exception("unsupported write"));
            var oldLabel = (TextBox)older.Controls.Find("workspace_label", true).Single(); check(!oldLabel.Enabled, "old client label writable"); oldLabel.Text = "Q";
            check(older.TryGetSettings(out var unchanged) && unchanged.WorkspaceLabel == "", "old client mutated hidden label");
        });
        test("help action is usable for old clients and does not invoke focus", () => {
            var calls = 0; using var menu = TrayPresentation.CreateMenu(Entry() with { Settings = null }, () => throw new Exception("focus"), openHelp: () => calls++);
            check(!menu.Items[8].Enabled && menu.Items[9].Enabled, "help gated by settings capability"); menu.Items[9].PerformClick(); check(calls == 1, "help action");
        });
        test("support diagnostics whitelist technical metadata and reject malformed version fields", () => {
            var message = new ClientMessage(1, "hello", Entry().Workspace, Entry().Snapshot, Settings: Entry().Settings, ExtensionVersion: "fixture-extension", Location: "ssh-remote", BridgeVersion: "fixture-bridge");
            var raw = Protocol.Serialize(message).TrimEnd(); raw = raw[..^1] + ",\"prompt\":\"PRIVATE_PROMPT\",\"access_token\":\"SECRET_TOKEN\"}";
            var parsed = Protocol.Parse(raw); check(parsed is not null, "unknown fields broke compatible message");
            var registry = new WorkspaceRegistry(); registry.Update(parsed!, Guid.NewGuid(), 1, DateTimeOffset.UtcNow);
            var report = SupportDiagnostics.Build(registry.Get("fixture")!, 2, true, Guid.NewGuid(), "rounded", "large");
            using var json = JsonDocument.Parse(report);
            check(json.RootElement.GetProperty("extension_version").GetString() == "fixture-extension" && json.RootElement.GetProperty("remote").GetProperty("bridge_version").GetString() == "fixture-bridge", "versions not copied");
            check(json.RootElement.GetProperty("snapshot").GetProperty("reason").GetString() == "stale_session" && json.RootElement.GetProperty("tray").GetProperty("connected_count").GetInt32() == 2, "wrong selected workspace report");
            check(!report.Contains("PRIVATE_PROMPT") && !report.Contains("SECRET_TOKEN"), "unmapped data copied");
            check(Protocol.Parse(Protocol.Serialize(message with { ExtensionVersion = new string('a', 61) })) is null, "oversized version");
            check(Protocol.Parse(Protocol.Serialize(message with { Location = "ssh\nremote" })) is null, "control characters");
        });
        test("help is bilingual, copies current diagnostics and reports clipboard and documentation failures", () => {
            try {
                foreach (var code in new[] { "fr", "en" }) {
                    UiText.Select(code); var current = "{\"state\":\"unknown\"}"; string? copied = null; string? opened = null;
                    using var dialog = new HelpDialog(Entry(), () => current, value => copied = value, url => opened = url);
                    check(dialog.Text.StartsWith(UiText.Get("menu.help")) && ((Label)dialog.Controls.Find("versions", true).Single()).Text.Contains("fixture-extension"), "help language or versions");
                    check(dialog.CopyDiagnostics() && copied == current, "copy failed"); current = "{\"state\":\"working\"}";
                    check(dialog.CopyDiagnostics() && copied == current, "copy used stale report");
                    check(((Label)dialog.Controls.Find("feedback", true).Single()).Text == UiText.Get("help.copied"), "copy feedback language");
                    check(dialog.OpenDocumentation() && opened == HelpDialog.DocumentationUrl, "documentation URL");
                    using var failure = new HelpDialog(Entry(), () => current, _ => throw new System.Runtime.InteropServices.ExternalException("clipboard locked"), _ => throw new System.ComponentModel.Win32Exception());
                    check(!failure.CopyDiagnostics() && ((Label)failure.Controls.Find("feedback", true).Single()).Text == UiText.Get("help.copy_failure"), "clipboard failure not reported");
                    check(!failure.OpenDocumentation() && failure.TopMost && ((Label)failure.Controls.Find("feedback", true).Single()).Text == UiText.Get("help.open_failure"), "documentation failure not reported");
                }
            }
            finally { UiText.Select("fr"); }
        });
    }
}
