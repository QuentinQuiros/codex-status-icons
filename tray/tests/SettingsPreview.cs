using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class SettingsPreview
{
    public static void Write()
    {
        var previous = UiText.Preference;
        try {
            foreach (var code in new[] { "fr", "en" }) { UiText.Select(code); WriteLanguage(code); }
            File.Copy("dist/settings-preview-fr.png", "dist/settings-preview.png", true);
        }
        finally { UiText.Select(previous); }
    }
    private static void WriteLanguage(string code)
    {
        using var dialog = CreateSettings();
        WriteForm(dialog, $"dist/settings-preview-{code}.png");
        using var notifications = CreateSettings();
        ((TabControl)notifications.Controls.Find("settings_tabs", true).Single()).SelectedIndex = 1;
        WriteForm(notifications, $"dist/settings-notifications-preview-{code}.png");
        using var customSound = CreateSettings();
        ((TabControl)customSound.Controls.Find("settings_tabs", true).Single()).SelectedIndex = 1;
        ((ComboBox)customSound.Controls.Find("notification_sound", true).Single()).SelectedIndex = Array.IndexOf(NotificationSounds.Modes, "custom");
        WriteForm(customSound, $"dist/settings-sound-preview-{code}.png");
        using var icons = CreateSettings();
        ((TabControl)icons.Controls.Find("settings_tabs", true).Single()).SelectedIndex = 2;
        WriteForm(icons, $"dist/settings-icons-preview-{code}.png");
        using var help = CreateHelp();
        WriteForm(help, $"dist/help-preview-{code}.png");
    }
    private static void WriteForm(Form dialog, string filename)
    {
        ShowOffScreen(dialog);
        Console.WriteLine($"LAYOUT {filename}: size={dialog.Size}, client={dialog.ClientSize}, dpi={dialog.DeviceDpi}, preferred={dialog.Controls[0].PreferredSize}, horizontal={dialog.HorizontalScroll.Visible}");
        using var image = new Bitmap(dialog.Width, dialog.Height);
        dialog.DrawToBitmap(image, new Rectangle(Point.Empty, image.Size));
        Directory.CreateDirectory("dist");
        image.Save(filename, System.Drawing.Imaging.ImageFormat.Png);
    }

    internal static TimingSettingsDialog CreateSettings(Func<TimingSettings, Task<bool>>? persist = null) => new PreviewSettings(persist);
    internal static HelpDialog CreateHelp() => new PreviewHelp();
    internal static void ShowOffScreen(Form dialog)
    {
        // Render the real form, including Load, DPI scaling, frame and scrollbars,
        // without activating it or moving any user window.
        dialog.TopMost = false;
        dialog.StartPosition = FormStartPosition.Manual;
        dialog.Location = new Point(-32000, -32000);
        dialog.Show();
        Application.DoEvents();
        dialog.PerformLayout();
    }
    private static WorkspaceEntry Entry() => new(new("preview", "Projet [SSH: workspace.example]", "vscode-remote://ssh-remote+workspace.example/srv/project", ["vscode-remote://ssh-remote+workspace.example/srv/project"], "P"), new("unknown", "stale_session", "session", CliVersion: "0.155.0"), Guid.NewGuid(), 1, DateTimeOffset.UtcNow, false, true, false, new(15, 600, ConfigurationVersion: 7, NotificationsEnabled: true), SupportDiagnostics.Version, "ssh-remote", "1.0.0");
    private sealed class PreviewSettings : TimingSettingsDialog
    {
        internal PreviewSettings(Func<TimingSettings, Task<bool>>? persist) : base("Projet [SSH: workspace.example]", true, new(TimingSettings.DefaultExitGraceSeconds, 600, ConfigurationVersion: 7, NotificationsEnabled: true), persist ?? (_ => Task.FromResult(true)), (_, _) => true) { }
        protected override bool ShowWithoutActivation => true;
    }
    private sealed class PreviewHelp : HelpDialog
    {
        internal PreviewHelp() : base(Entry(), () => SupportDiagnostics.Build(Entry(), 2, true, Guid.Empty, "rounded", "large"), _ => {}, _ => {}) { }
        protected override bool ShowWithoutActivation => true;
    }
}
