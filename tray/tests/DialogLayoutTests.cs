using CodexStatusTray.Core;
using CodexStatusTray.Windows;

internal static class DialogLayoutTests
{
    public static void Run(Action<string, Action> test, Action<bool, string> check)
    {
        test("real settings and help windows have matching readable widths in both languages", () => {
            try {
                foreach (var code in new[] { "fr", "en" }) {
                    UiText.Select(code);
                    using var settings = SettingsPreview.CreateSettings();
                    using var help = SettingsPreview.CreateHelp();
                    SettingsPreview.ShowOffScreen(settings);
                    SettingsPreview.ShowOffScreen(help);
                    check(settings.ClientSize.Width > 500 && settings.Width == help.Width, "native form width collapsed or differs");
                    foreach (var dialog in new Form[] { settings, help })
                        check(!dialog.HorizontalScroll.Visible && dialog.Controls[0].Right <= dialog.ClientSize.Width, "content clipped horizontally");
                    ((ComboBox)settings.Controls.Find("notification_sound", true).Single()).SelectedIndex = Array.IndexOf(NotificationSounds.Modes, "custom");
                    Application.DoEvents();
                    check(!settings.HorizontalScroll.Visible && settings.Width == help.Width, "custom sound expanded the dialog horizontally");
                    var width = help.Width;
                    check(help.CopyDiagnostics() && help.Width == width && !help.HorizontalScroll.Visible, "feedback changed width");
                }
            }
            finally { UiText.Select("fr"); }
        });
        test("short real dialogs scroll vertically and keep their final action reachable", () => {
            using var settings = SettingsPreview.CreateSettings();
            using var help = SettingsPreview.CreateHelp();
            foreach (var dialog in new Form[] { settings, help }) {
                SettingsPreview.ShowOffScreen(dialog);
                var width = dialog.Width;
                dialog.MaximumSize = new Size(width, 420);
                Application.DoEvents();
                check(dialog.Height <= 420 && !dialog.HorizontalScroll.Visible, "short-screen scrollbar layout");
                if (dialog == help) check(dialog.VerticalScroll.Visible, "help cannot scroll");
                else {
                    check(!dialog.VerticalScroll.Visible, "footer should stay fixed");
                    var tabs = (TabControl)dialog.Controls.Find("settings_tabs", true).Single();
                    foreach (TabPage page in tabs.TabPages) {
                        tabs.SelectedTab = page; Application.DoEvents();
                        check(page.VerticalScroll.Visible && !page.HorizontalScroll.Visible, "tab cannot scroll vertically or overflows horizontally");
                    }
                }
                var button = dialog.Controls.Find(dialog == settings ? "save" : "close", true).Single();
                dialog.ScrollControlIntoView(button);
                var topLeft = dialog.PointToClient(button.PointToScreen(Point.Empty));
                var bottomRight = new Point(topLeft.X + button.Width - 1, topLeft.Y + button.Height - 1);
                check(dialog.ClientRectangle.Contains(topLeft) && dialog.ClientRectangle.Contains(bottomRight), "final action cannot be reached by scrolling");
                check(dialog.Width == width && !dialog.HorizontalScroll.Visible, "scrolling changed width");
            }
        });
        test("scaled real dialog content remains within the shared width", () => {
            using var settings = SettingsPreview.CreateSettings();
            using var help = SettingsPreview.CreateHelp();
            foreach (var dialog in new Form[] { settings, help }) {
                SettingsPreview.ShowOffScreen(dialog);
                dialog.Scale(new SizeF(1.25f, 1.25f));
                Application.DoEvents();
                check(dialog.Controls[0].Right <= dialog.ClientSize.Width && !dialog.HorizontalScroll.Visible, "scaled content overflows");
            }
            check(settings.Width == help.Width, "scaled widths differ");
        });
        test("switching settings tabs preserves unsaved choices and cancel never writes", () => {
            var writes = 0;
            using var dialog = new TimingSettingsDialog("Project", true, new(15, 60, ConfigurationVersion: 7, NotificationsEnabled: true), _ => { writes++; return Task.FromResult(true); });
            SettingsPreview.ShowOffScreen(dialog);
            var tabs = (TabControl)dialog.Controls.Find("settings_tabs", true).Single();
            check(tabs.TabPages.Count == 3 && tabs.TabPages[0].Text == UiText.Get("settings.tab.general"), "tab labels missing");
            ((ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single()).Text = "617";
            tabs.SelectedIndex = 1; ((CheckBox)dialog.Controls.Find("notifications_enabled", true).Single()).Checked = false;
            tabs.SelectedIndex = 2; ((TextBox)dialog.Controls.Find("workspace_label", true).Single()).Text = "Q";
            tabs.SelectedIndex = 0;
            check(dialog.TryGetSettings(out var selected) && selected.StaleWorkingMinutes == 617 && selected.NotificationsEnabled == false && selected.WorkspaceLabel == "Q", "tab changes discarded unsaved values");
            ((Button)dialog.CancelButton!).PerformClick(); check(writes == 0, "cancel saved values");
        });
        test("validation selects the correct tab and keeps save actions visible", () => {
            using var dialog = SettingsPreview.CreateSettings(); SettingsPreview.ShowOffScreen(dialog);
            var tabs = (TabControl)dialog.Controls.Find("settings_tabs", true).Single();
            var letter = (TextBox)dialog.Controls.Find("workspace_label", true).Single(); letter.Text = "QQ";
            check(!dialog.TryGetSettings(out _) && tabs.SelectedTab!.Name == "tab_icons", "letter error hidden in another tab");
            letter.Text = "Q";
            var freshness = (ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single(); freshness.Text = "0";
            check(!dialog.TryGetSettings(out _) && tabs.SelectedTab!.Name == "tab_general", "freshness error hidden in another tab");
            freshness.Text = "600";
            ((ComboBox)dialog.Controls.Find("notification_sound", true).Single()).SelectedIndex = Array.IndexOf(NotificationSounds.Modes, "custom");
            check(!dialog.TryGetSettings(out _) && tabs.SelectedTab!.Name == "tab_notifications", "sound error hidden in another tab");
            Application.DoEvents();
            var button = dialog.Controls.Find("save", true).Single();
            var point = dialog.PointToClient(button.PointToScreen(Point.Empty));
            check(dialog.ClientRectangle.Contains(point) && point.Y + button.Height <= dialog.ClientSize.Height, "feedback hid save button");
        });
        test("save lettering stays white during hover press and pending persistence in both languages", () => {
            try {
                foreach (var code in new[] { "fr", "en" }) {
                    UiText.Select(code);
                    var completion = new TaskCompletionSource<bool>();
                    using var dialog = SettingsPreview.CreateSettings(_ => completion.Task);
                    SettingsPreview.ShowOffScreen(dialog);
                    var save = (Button)dialog.Controls.Find("save", true).Single();
                    CheckWhiteLettering(save, check);
                    InvokeMouse(save, "OnMouseEnter", EventArgs.Empty);
                    CheckWhiteLettering(save, check);
                    InvokeMouse(save, "OnMouseDown", new MouseEventArgs(MouseButtons.Left, 1, save.Width / 2, save.Height / 2, 0));
                    CheckWhiteLettering(save, check);
                    InvokeMouse(save, "OnMouseUp", new MouseEventArgs(MouseButtons.None, 0, 0, 0, 0));
                    ((ComboBox)dialog.Controls.Find("stale_working_minutes", true).Single()).Text = "601";
                    var writing = dialog.SaveAsync();
                    check(!save.Enabled && !writing.IsCompleted, "save did not enter the pending state");
                    CheckWhiteLettering(save, check);
                    Directory.CreateDirectory("dist");
                    using (var preview = new Bitmap(dialog.Width, dialog.Height)) {
                        dialog.DrawToBitmap(preview, new Rectangle(Point.Empty, preview.Size));
                        preview.Save($"dist/settings-saving-preview-{code}.png", System.Drawing.Imaging.ImageFormat.Png);
                    }
                    completion.SetResult(false);
                    var deadline = DateTime.UtcNow.AddSeconds(3);
                    while (!writing.IsCompleted && DateTime.UtcNow < deadline) Application.DoEvents();
                    check(writing.IsCompleted && !writing.GetAwaiter().GetResult() && save.Enabled, "failed save did not restore the button");
                    CheckWhiteLettering(save, check);
                }
            }
            finally { UiText.Select("fr"); }
        });
    }

    private static void InvokeMouse(Button button, string method, EventArgs args) => button.GetType()
        .GetMethod(method, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.Invoke(button, [args]);

    private static void CheckWhiteLettering(Button button, Action<bool, string> check)
    {
        using var bitmap = new Bitmap(button.Width, button.Height);
        button.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
        var white = 0;
        // Exclude the focus outline so that only the rendered lettering counts.
        for (var y = 8; y < bitmap.Height - 8; y++)
            for (var x = 8; x < bitmap.Width - 8; x++) {
                var pixel = bitmap.GetPixel(x, y);
                if (pixel.R > 240 && pixel.G > 240 && pixel.B > 240) white++;
            }
        check(white > 20, "save text lost its white rendering");
    }
}
