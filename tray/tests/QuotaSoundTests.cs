using System.Buffers.Binary;
using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class QuotaSoundTests
{
    private static WorkspaceEntry Entry(DateTimeOffset now) => new(new("test", "Projet [SSH: fixture.example]", "root", ["root"], "P"), new("idle", "task_complete", "session"), Guid.Empty, 1, now, false, true, false);
    private static byte[] Wave(int seconds = 1)
    {
        var dataSize = seconds * 8000; var bytes = new byte[44 + dataSize];
        "RIFF"u8.CopyTo(bytes); BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)bytes.Length - 8);
        "WAVEfmt "u8.CopyTo(bytes.AsSpan(8)); BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(16), 16);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(20), 1); BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(22), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(24), 8000); BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(28), 8000);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(32), 1); BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(34), 8);
        "data"u8.CopyTo(bytes.AsSpan(36)); BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(40), (uint)dataSize);
        Array.Fill(bytes, (byte)128, 44, dataSize); return bytes;
    }
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        test("quota tooltip is localized and missing expired disconnected or stale data leaves no extra line", () => {
            var now = DateTimeOffset.UtcNow; var entry = Entry(now) with { Quota = new(now.ToString("O"), [new(72.9, 300, now.AddHours(1).ToUnixTimeSeconds()), new(84, 10080, now.AddDays(1).ToUnixTimeSeconds())]) };
            try {
                foreach (var code in new[] { "fr", "en" }) {
                    UiText.Select(code); var text = TrayPresentation.Tooltip(entry, now);
                    check(text.Split(Environment.NewLine).Length == 3 && text.EndsWith("[5h : 72% | " + UiText.Get("quota.days", "7") + " : 84%]"), "quota line missing or incorrect");
                    foreach (var missing in new[] { entry with { Quota = null }, entry with { Quota = entry.Quota with { CheckedAt = now.AddMinutes(-3).ToString("O") } }, entry with { Quota = entry.Quota with { CheckedAt = now.AddMinutes(1).ToString("O") } }, entry with { Quota = entry.Quota with { Windows = [new(50, 300, now.AddSeconds(-1).ToUnixTimeSeconds())] } }, entry with { Snapshot = new("unknown", "remote_unavailable", "none") } })
                        check(TrayPresentation.QuotaText(missing, now) is null && TrayPresentation.Tooltip(missing, now).Split(Environment.NewLine).Length == 2, "missing data produced a quota placeholder");
                }
            } finally { UiText.Select("fr"); }
        });
        test("working time and quota remain readable within Windows tooltip size", () => {
            var now = DateTimeOffset.UtcNow; var entry = Entry(now) with { Workspace = Entry(now).Workspace with { WorkspaceName = new string('x', 256) }, Snapshot = new("working", "task_started", "session", Since: now.AddMinutes(-3).ToString("O")), Quota = new(now.ToString("O"), [new(0, 300, now.AddHours(1).ToUnixTimeSeconds()), new(100, 10080, now.AddDays(1).ToUnixTimeSeconds())]) };
            var tooltip = TrayPresentation.Tooltip(entry, now);
            check(tooltip.Length <= 127 && tooltip.Contains("03:00") && tooltip.Contains("100%") && tooltip.Split(Environment.NewLine).Length == 3, "tooltip truncated state or quota");
        });
        test("quota protocol accepts only bounded numeric windows and clears omitted observations", () => {
            var now = DateTimeOffset.UtcNow; var entry = Entry(now); var valid = new QuotaInfo(now.ToString("O"), [new(72, 300, now.AddHours(1).ToUnixTimeSeconds())]);
            var message = new ClientMessage(1, "hello", entry.Workspace, entry.Snapshot, Quota: valid);
            check(Protocol.Parse(Protocol.Serialize(message))?.Quota?.Windows[0].RemainingPercent == 72, "valid quota lost");
            foreach (var invalid in new[] { valid with { CheckedAt = "invalid" }, valid with { Windows = [new(101, 300, 1)] }, valid with { Windows = [new(50, 0, 1)] }, valid with { Windows = [new(50, 300, -1)] }, valid with { Windows = [new(50, 300, 1), new(50, 300, 1), new(50, 300, 1)] } })
                check(Protocol.Parse(Protocol.Serialize(message with { Quota = invalid })) is null, "invalid quota accepted");
            var registry = new WorkspaceRegistry(); registry.Update(message, Guid.Empty, 1, now); registry.Update(message with { Type = "update", Quota = null }, Guid.Empty, 1, now);
            check(registry.Get("test")?.Quota is null, "missing observation kept old percentage");
        });
        test("audio validates WAV structure duration size and refuses unsupported paths", () => {
            check(NotificationAudio.ValidWave(Wave()) && NotificationAudio.ValidWave(Wave(30)), "PCM fixture rejected");
            check(!NotificationAudio.ValidWave(Wave(31)) && !NotificationAudio.ValidWave(new byte[NotificationAudio.MaximumBytes + 1]), "limits ignored");
            var invalid = Wave(); invalid[20] = 3; check(!NotificationAudio.ValidWave(invalid), "float WAV accepted");
            invalid = Wave(); invalid[40] = 255; check(!NotificationAudio.ValidWave(invalid), "bad chunk accepted");
            foreach (var path in new[] { "https://example/sound.wav", "\\\\server\\sound.wav", "relative.wav", "C:\\sound.mp3", "C:\\sound.wav\n" })
                check(!NotificationSounds.ValidFilePath(path) && NotificationAudio.ReadWave(path) is null, "unsupported audio path");
        });
        test("bundled ChatGPT default contains the exact WAV and plays once only after the banner is visible", () => {
            var expected = NotificationAudio.ReadChatGPT();
            check(expected is not null && NotificationAudio.ValidWave(expected), "bundled WAV is missing or invalid");
            check(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(expected!)) == "D3EC08B617DEDC0D46DE8DA082E83FCD7526E129BBF6CE14354EE7F182A4E2BA", "wrong sound bundled");
            check(new TimingSettings(15, 60).NotificationSound == "chatgpt" && NotificationSounds.ValidMode("windows"), "default or Windows choice lost");
            var played = 0;
            using var audio = new NotificationSoundPlayback(bytes => { check(bytes.SequenceEqual(expected!), "bundled audio changed"); played++; }, () => {});
            audio.Prepare("chatgpt", ""); check(played == 0, "queued sound played");
            audio.Shown(); audio.Shown(); check(played == 1, "visible sound missing or duplicated");
            audio.Prepare("chatgpt", ""); audio.Closed(); audio.Shown(); check(played == 1, "suppressed sound played");
            audio.Prepare("chatgpt", ""); audio.Disable(); audio.Shown(); check(played == 1, "disabled sound played");
            expected![0] = 0; check(NotificationAudio.ValidWave(NotificationAudio.ReadChatGPT()!), "consumer mutated the embedded sound");
        });
        test("custom audio plays only on a visible banner once and silent suppressed or disabled notifications stay quiet", () => {
            var filename = Path.Combine(Path.GetTempPath(), "codex-sound-" + Guid.NewGuid().ToString("N") + ".wav");
            File.WriteAllBytes(filename, Wave()); var played = 0; var stopped = 0;
            try {
                using var audio = new NotificationSoundPlayback(bytes => { check(bytes.SequenceEqual(Wave()), "changed audio data"); played++; }, () => stopped++);
                audio.Prepare("custom", filename); check(played == 0, "queued banner played sound"); audio.Shown(); audio.Shown(); check(played == 1, "duplicate visible callback");
                audio.Prepare("custom", filename); audio.Closed(); audio.Shown(); check(played == 1, "suppressed banner played sound");
                audio.Prepare("custom", filename); audio.Disable(); audio.Shown(); check(played == 1 && stopped == 1, "disabled pending sound played");
                foreach (var mode in new[] { "windows", "silent" }) { audio.Prepare(mode, filename); audio.Shown(); }
                audio.Prepare("custom", filename + ".missing"); audio.Shown(); check(played == 1, "non-custom or unavailable audio played");
            } finally { File.Delete(filename); }
        });
        test("sound settings and preview preserve the selected mode while legacy clients remain read-only", () => {
            var settings = new TimingSettings(15, 60, ConfigurationVersion: 7, NotificationsEnabled: true); TimingSettings? saved = null; string? tested = null;
            using var dialog = new TimingSettingsDialog("Test", true, settings, value => { saved = value; return Task.FromResult(true); }, (mode, _) => { tested = mode; return true; });
            SettingsPreview.ShowOffScreen(dialog);
            ((TabControl)dialog.Controls.Find("settings_tabs", true).Single()).SelectedIndex = 1;
            var input = (ComboBox)dialog.Controls.Find("notification_sound", true).Single();
            check(input.SelectedItem?.ToString() == "ChatGPT", "default preset not displayed");
            ((Button)dialog.Controls.Find("test_sound", true).Single()).PerformClick(); check(tested == "chatgpt", "default preview ignored preset");
            input.SelectedIndex = Array.IndexOf(NotificationSounds.Modes, "silent");
            ((Button)dialog.Controls.Find("test_sound", true).Single()).PerformClick(); check(tested == "silent", "preview ignored mode");
            check(dialog.SaveAsync().GetAwaiter().GetResult() && saved?.NotificationSound == "silent", "mode not saved");
            foreach (var capability in new[] { 5, 6 }) {
                using var legacy = new TimingSettingsDialog("Test", true, settings with { ConfigurationVersion = capability, NotificationSound = "silent" }, _ => Task.FromResult(true));
                var old = (ComboBox)legacy.Controls.Find("notification_sound", true).Single(); check(!old.Enabled, "legacy client writable"); old.SelectedIndex = 0;
                check(legacy.TryGetSettings(out var unchanged) && unchanged.NotificationSound == "silent", "legacy client changed preference");
            }
        });
        test("custom mode rejects missing WAV files and protocol rejects unknown sound modes", () => {
            var settings = new TimingSettings(15, 60, ConfigurationVersion: 7, NotificationsEnabled: true);
            using var dialog = new TimingSettingsDialog("Test", true, settings, _ => Task.FromResult(true));
            ((ComboBox)dialog.Controls.Find("notification_sound", true).Single()).SelectedIndex = Array.IndexOf(NotificationSounds.Modes, "custom");
            check(!dialog.TryGetSettings(out _), "missing custom file accepted");
            var message = new ClientMessage(1, "hello", Entry(DateTimeOffset.UtcNow).Workspace, Entry(DateTimeOffset.UtcNow).Snapshot, Settings: settings with { NotificationSound = "invalid" });
            check(Protocol.Parse(Protocol.Serialize(message)) is null, "unknown mode accepted");
        });
    }
}
