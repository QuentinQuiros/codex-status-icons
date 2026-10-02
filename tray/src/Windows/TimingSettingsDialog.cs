using System.Diagnostics;
using System.Globalization;
using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

public class TimingSettingsDialog : Form
{
    private readonly TimingSettings initial;
    private readonly Dictionary<string, ComboBox> inputs = [];
    private readonly Label feedback;
    private readonly Button save;
    private readonly Button cancel;
    private readonly Func<TimingSettings, Task<bool>> persist;
    private readonly ComboBox language;
    private readonly TextBox workspaceLabel;
    private readonly CheckBox notifications;
    private readonly ComboBox notificationSound;
    private readonly TextBox soundFile;
    private readonly Button browseSound;
    private readonly Button testSound;
    private readonly TableLayoutPanel customSound;
    private readonly Func<string, string, bool>? previewSound;
    private readonly TabControl tabs;
    private bool saving;

    public TimingSettingsDialog(string workspace, bool hasWorkspace, TimingSettings current, Func<TimingSettings, Task<bool>> persist, Func<string, string, bool>? previewSound = null)
    {
        initial = current;
        this.persist = persist;
        this.previewSound = previewSound;
        Text = UiText.Get("settings.title") + " — Codex Status Icons";
        Font = new Font("Segoe UI", 10);
        BackColor = Color.FromArgb(244, 247, 251);
        AutoScaleMode = AutoScaleMode.Font;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ShowIcon = false;
        TopMost = true;

        var layout = new TableLayoutPanel { ColumnCount = 1, RowCount = 3, Padding = new Padding(24, 20, 24, 18) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(TextLabel(UiText.Get("settings.title"), 17, FontStyle.Bold, bottom: 0), 0, 0);
        tabs = new SettingsTabs();
        layout.Controls.Add(tabs, 0, 1);
        var generalPage = CreateTab("general");
        var notificationsPage = CreateTab("notifications");
        var iconsPage = CreateTab("icons");
        var languageSection = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 0, 0, 22) };
        languageSection.Controls.Add(TextLabel(UiText.Get("settings.language"), 11, FontStyle.Bold, bottom: 5));
        languageSection.Controls.Add(TextLabel(UiText.Get("scope.all"), color: SystemColors.GrayText, bottom: 8));
        language = new ComboBox { Name = "language", DropDownStyle = ComboBoxStyle.DropDownList, Width = 220, AccessibleName = UiText.Get("settings.language") };
        foreach (var choice in UiText.Preferences) language.Items.Add(UiText.Get("language." + choice));
        language.SelectedIndex = Array.IndexOf(UiText.Preferences, current.Language);
        languageSection.Controls.Add(new SettingsField(language));
        generalPage.Controls.Add(new SettingsCard(languageSection));

        var notificationSection = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 0, 0, 22) };
        notificationSection.Controls.Add(TextLabel(UiText.Get("notifications.title"), 11, FontStyle.Bold, bottom: 5));
        notificationSection.Controls.Add(TextLabel(UiText.Get("scope.all"), color: SystemColors.GrayText, bottom: 8));
        notifications = new CheckBox { Name = "notifications_enabled", Text = UiText.Get("notifications.enabled"), AutoSize = true, MaximumSize = new Size(480, 0), Checked = current.NotificationsEnabled ?? true, Enabled = current.ConfigurationVersion >= 5, Margin = new Padding(0, 0, 0, 8), AccessibleName = UiText.Get("notifications.enabled") };
        notificationSection.Controls.Add(notifications);
        notificationSection.Controls.Add(TextLabel(UiText.Get(current.ConfigurationVersion >= 5 ? "notifications.help" : "notifications.reload"), bottom: 10));
        notificationsPage.Controls.Add(new SettingsCard(notificationSection));
        var soundSection = new TableLayoutPanel { AutoSize = true, ColumnCount = 1 };
        soundSection.Controls.Add(TextLabel(UiText.Get("sound.title"), 11, FontStyle.Bold, bottom: 5));
        soundSection.Controls.Add(TextLabel(UiText.Get("scope.all"), color: SystemColors.GrayText, bottom: 8));
        notificationSound = new ComboBox { Name = "notification_sound", DropDownStyle = ComboBoxStyle.DropDownList, Width = 250, AccessibleName = UiText.Get("sound.title"), Enabled = current.ConfigurationVersion >= 7 };
        foreach (var mode in NotificationSounds.Modes) notificationSound.Items.Add(UiText.Get("sound." + mode));
        notificationSound.SelectedIndex = Array.IndexOf(NotificationSounds.Modes, current.NotificationSound);
        soundSection.Controls.Add(new SettingsField(notificationSound));
        customSound = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 8, 0, 8) };
        soundFile = new SettingsTextBox { Name = "notification_sound_file", Text = current.NotificationSoundFile, ReadOnly = true, Width = 420, AccessibleName = UiText.Get("sound.file") };
        customSound.Controls.Add(new SettingsField(soundFile, UiText.Get("sound.no_file")));
        browseSound = new Button { Name = "browse_sound", Text = UiText.Get("sound.browse"), AutoSize = true, Padding = new Padding(10, 3, 10, 3) };
        browseSound.Click += (_, _) => BrowseSound();
        customSound.Controls.Add(browseSound);
        customSound.Controls.Add(TextLabel(UiText.Get("sound.help"), bottom: 0));
        soundSection.Controls.Add(customSound);
        testSound = new Button { Name = "test_sound", Text = UiText.Get("sound.test"), AutoSize = true, Padding = new Padding(10, 3, 10, 3), Margin = new Padding(0, 8, 0, 0) };
        testSound.Click += (_, _) => TestSound();
        soundSection.Controls.Add(testSound);
        if (current.ConfigurationVersion < 7) soundSection.Controls.Add(TextLabel(UiText.Get("sound.reload")));
        notificationSound.SelectedIndexChanged += (_, _) => UpdateSoundControls();
        UpdateSoundControls();
        notificationsPage.Controls.Add(new SettingsCard(soundSection));

        var labelSection = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 0, 0, 22) };
        labelSection.Controls.Add(TextLabel(UiText.Get("label.title"), 11, FontStyle.Bold, bottom: 5));
        labelSection.Controls.Add(TextLabel(hasWorkspace ? UiText.Get("scope.workspace", TrayPresentation.DisplayName(workspace)) : UiText.Get("scope.all"), color: SystemColors.GrayText, bottom: 8));
        labelSection.Controls.Add(TextLabel(UiText.Get(current.ConfigurationVersion >= 4 ? "label.help" : "label.reload"), bottom: 8));
        workspaceLabel = new SettingsTextBox { Name = "workspace_label", Text = current.WorkspaceLabel, Width = 180, MaxLength = 8, AccessibleName = UiText.Get("label.title"), Enabled = current.ConfigurationVersion >= 4 };
        labelSection.Controls.Add(new SettingsField(workspaceLabel, UiText.Get("label.auto")));
        iconsPage.Controls.Add(new SettingsCard(labelSection));

        foreach (var spec in TimingSettingSpec.All)
        {
            var global = !hasWorkspace;
            var section = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 0, 0, 22) };
            section.Controls.Add(TextLabel(spec.Label, 11, FontStyle.Bold, bottom: 5));
            section.Controls.Add(TextLabel(global ? UiText.Get("scope.all") : UiText.Get("scope.workspace", TrayPresentation.DisplayName(workspace)), color: SystemColors.GrayText, bottom: 8));
            section.Controls.Add(TextLabel(UiText.Get(spec.Key + ".help"), bottom: 10));

            var currentValue = current.StaleWorkingMinutes;
            var input = new ComboBox { Name = spec.Key, DropDownStyle = ComboBoxStyle.DropDown, Width = 160, MaxLength = 24, AccessibleName = spec.Label };
            foreach (var choice in spec.Choices(currentValue)) input.Items.Add(Format(choice));
            input.SelectedIndex = input.Items.IndexOf(Format(currentValue));
            input.TextChanged += (_, _) => { if (!saving && feedback is not null) feedback.Text = ""; };
            inputs.Add(spec.Key, input);
            var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 6) };
            row.Controls.Add(new SettingsField(input));
            row.Controls.Add(new Label { AutoSize = true, Text = spec.Unit, Margin = new Padding(10, 12, 0, 0) });
            section.Controls.Add(row);
            generalPage.Controls.Add(new SettingsCard(section));
        }

        var visibilitySection = new TableLayoutPanel { AutoSize = true, ColumnCount = 1, Margin = new Padding(0, 0, 0, 22) };
        visibilitySection.Controls.Add(TextLabel(UiText.Get("taskbar.label"), 11, FontStyle.Bold, bottom: 5));
        visibilitySection.Controls.Add(TextLabel(UiText.Get("taskbar.help"), bottom: 10));
        var configureWindows = new Button { Name = "configure_windows", Text = UiText.Get("taskbar.button"), AutoSize = true, Padding = new Padding(10, 3, 10, 3) };
        configureWindows.Click += (_, _) => OpenTaskbarSettings();
        visibilitySection.Controls.Add(configureWindows);
        iconsPage.Controls.Add(new SettingsCard(visibilitySection));

        feedback = TextLabel("", color: Color.Firebrick, bottom: 8);
        feedback.Name = "feedback";
        feedback.AccessibleRole = AccessibleRole.Alert;
        feedback.Visible = false;
        feedback.TextChanged += (_, _) => feedback.Visible = feedback.Text.Length > 0;
        var footer = new TableLayoutPanel { Name = "settings_footer", AutoSize = true, ColumnCount = 1, Dock = DockStyle.Fill, Margin = Padding.Empty };
        footer.Controls.Add(feedback);
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, Margin = Padding.Empty };
        save = ActionButton("save", UiText.Get("button.save"), primary: true);
        cancel = ActionButton("cancel", UiText.Get("button.cancel"));
        cancel.DialogResult = DialogResult.Cancel;
        save.Click += async (_, _) => await SaveAsync();
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        footer.Controls.Add(buttons);
        layout.Controls.Add(footer, 0, 2);
        DialogLayout.AttachTabbed(this, layout);
        AcceptButton = save;
        CancelButton = cancel;
        FormClosing += (_, args) => { if (saving) args.Cancel = true; };
        Shown += (_, _) => language.Focus();
    }

    private TableLayoutPanel CreateTab(string id)
    {
        var page = new TabPage(UiText.Get("settings.tab." + id)) { Name = "tab_" + id, AutoScroll = true, BackColor = BackColor, Padding = new Padding(12) };
        var body = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 1, MinimumSize = new Size(520, 0), MaximumSize = new Size(520, 0), Margin = Padding.Empty, Location = new Point(12, 12) };
        page.Controls.Add(body); tabs.TabPages.Add(page);
        return body;
    }
    private static Button ActionButton(string name, string text, bool primary = false)
    {
        var button = primary ? new SettingsPrimaryButton() : new Button();
        button.Name = name; button.Text = text; button.AutoSize = true;
        button.Padding = new Padding(14, 5, 14, 5); button.FlatStyle = FlatStyle.Flat;
        button.UseVisualStyleBackColor = false;
        button.BackColor = primary ? Color.FromArgb(37, 99, 235) : Color.White;
        button.ForeColor = primary ? Color.White : Color.FromArgb(35, 49, 70);
        button.FlatAppearance.BorderSize = primary ? 0 : 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(210, 220, 232);
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(29, 78, 216) : Color.FromArgb(235, 241, 249);
        button.FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(30, 64, 175) : Color.FromArgb(220, 230, 244);
        return button;
    }
    private void FocusInput(Control input)
    {
        for (Control? parent = input.Parent; parent is not null; parent = parent.Parent)
            if (parent is TabPage page) { tabs.SelectedTab = page; page.ScrollControlIntoView(input); break; }
        input.Focus();
    }

    private static string Format(double value) => value.ToString("0.########", CultureInfo.CurrentCulture);
    private string SelectedSound => notificationSound.Enabled && notificationSound.SelectedIndex >= 0 ? NotificationSounds.Modes[notificationSound.SelectedIndex] : initial.NotificationSound;
    private void UpdateSoundControls()
    {
        var supported = initial.ConfigurationVersion >= 7 && !saving;
        notificationSound.Enabled = supported;
        customSound.Visible = SelectedSound == "custom";
        soundFile.Enabled = browseSound.Enabled = supported;
        testSound.Enabled = supported && previewSound is not null;
    }
    private void BrowseSound()
    {
        using var picker = new OpenFileDialog { Filter = UiText.Get("sound.filter"), CheckFileExists = true, Multiselect = false, Title = UiText.Get("sound.browse") };
        if (picker.ShowDialog(this) != DialogResult.OK) return;
        if (NotificationAudio.ReadWave(picker.FileName) is null) { feedback.Text = UiText.Get("sound.invalid"); return; }
        soundFile.Text = picker.FileName; feedback.Text = "";
    }
    private bool ValidSelectedSound()
    {
        if (SelectedSound != "custom" || NotificationAudio.ReadWave(soundFile.Text) is not null) return true;
        feedback.ForeColor = Color.Firebrick; feedback.Text = UiText.Get("sound.invalid"); FocusInput(browseSound); return false;
    }
    private void TestSound()
    {
        if (!ValidSelectedSound()) return;
        feedback.ForeColor = SystemColors.GrayText;
        feedback.Text = previewSound?.Invoke(SelectedSound, soundFile.Text) == true ? UiText.Get("sound.test_sent") : UiText.Get("sound.test_failed");
    }
    private static Label TextLabel(string text, float size = 10, FontStyle style = FontStyle.Regular, Color? color = null, int bottom = 8) => new() {
        AutoSize = true, MaximumSize = new Size(480, 0), Text = text, Font = new Font("Segoe UI", size, style), ForeColor = color ?? Color.FromArgb(28, 42, 62), Margin = new Padding(0, 0, 0, bottom)
    };

    private void OpenTaskbarSettings()
    {
        var wasTopMost = TopMost;
        // Let the Windows page come in front without saving or closing this dialog.
        TopMost = false;
        try {
            using var process = Process.Start(new ProcessStartInfo("ms-settings:taskbar") { UseShellExecute = true });
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException) {
            TopMost = wasTopMost;
            feedback.ForeColor = Color.Firebrick;
            feedback.Text = UiText.Get("taskbar.failure");
        }
    }

    public bool TryGetSettings(out TimingSettings settings)
    {
        if (initial.ConfigurationVersion >= 7 && notifications.Checked && !ValidSelectedSound()) { settings = initial; return false; }
        var selectedLabel = workspaceLabel.Enabled ? workspaceLabel.Text.Trim() : initial.WorkspaceLabel;
        if (selectedLabel != initial.WorkspaceLabel && !TimingSettings.ValidLabel(selectedLabel)) {
            feedback.Text = UiText.Get("label.invalid");
            FocusInput(workspaceLabel);
            settings = initial;
            return false;
        }
        var values = new Dictionary<string, double>();
        foreach (var spec in TimingSettingSpec.All)
        {
            var text = inputs[spec.Key].Text.Trim();
            if (!(double.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.CurrentCulture, out var value)
                || double.TryParse(text.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value)) || !spec.Accepts(value))
            {
                feedback.Text = UiText.Get("validation.number", spec.Label, spec.Minimum, spec.Maximum, spec.Unit);
                FocusInput(inputs[spec.Key]);
                settings = initial;
                return false;
            }
            values[spec.Key] = value;
        }
        settings = initial with { StaleWorkingMinutes = values["stale_working_minutes"], Language = language.SelectedIndex >= 0 ? UiText.Preferences[language.SelectedIndex] : initial.Language, WorkspaceLabel = selectedLabel, NotificationsEnabled = notifications.Enabled ? notifications.Checked : initial.NotificationsEnabled, NotificationSound = SelectedSound, NotificationSoundFile = initial.ConfigurationVersion >= 7 ? soundFile.Text : initial.NotificationSoundFile };
        return true;
    }

    public async Task<bool> SaveAsync()
    {
        if (saving || !TryGetSettings(out var selected)) return false;
        if (selected == initial) { DialogResult = DialogResult.OK; Close(); return true; }
        saving = true;
        save.Enabled = cancel.Enabled = false;
        language.Enabled = false;
        workspaceLabel.Enabled = false;
        notifications.Enabled = false;
        notificationSound.Enabled = soundFile.Enabled = browseSound.Enabled = testSound.Enabled = false;
        foreach (var input in inputs.Values) input.Enabled = false;
        feedback.ForeColor = SystemColors.GrayText;
        feedback.Text = UiText.Get("save.progress");
        var saved = false;
        try { saved = await persist(selected); }
        catch { /* Keep the dialog open and never claim a failed save succeeded. */ }
        finally {
            saving = false;
            save.Enabled = cancel.Enabled = true;
            language.Enabled = true;
            workspaceLabel.Enabled = initial.ConfigurationVersion >= 4;
            notifications.Enabled = initial.ConfigurationVersion >= 5;
            UpdateSoundControls();
            foreach (var input in inputs.Values) input.Enabled = true;
        }
        if (saved) { DialogResult = DialogResult.OK; Close(); }
        else {
            feedback.ForeColor = Color.Firebrick;
            feedback.Text = UiText.Get("save.failure");
        }
        return saved;
    }
}
