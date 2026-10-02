using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;
public sealed class TrayContext : ApplicationContext
{
    private readonly Control dispatcher = new();
    private readonly PipeServer server;
    private readonly WorkspaceRegistry registry = new();
    private readonly WindowFocus focus = new();
    private readonly IconAppearance appearance;
    private bool lightTaskbar = IconStyles.LightTaskbar();
    private readonly Dictionary<string, StableNotifyIcon> icons = [];
    private readonly IconIdentityRegistry iconIdentities = new();
    private readonly Dictionary<string, TrayVisualState> visuals = [];
    private readonly Dictionary<string, (TaskNotification Kind, StateSnapshot Snapshot)> pendingNotifications = [];
    private readonly Dictionary<string, int> notificationsSent = [];
    private bool notificationsEnabled = true;
    private string notificationSound = NotificationSounds.DefaultMode;
    private string notificationSoundFile = "";
    private readonly Dictionary<string, NotificationSoundPlayback> notificationAudio = [];
    private readonly Dictionary<string, (Guid ConnectionId, string WorkspaceId, TaskCompletionSource<bool> Completion)> pendingFocus = [];
    private readonly Dictionary<string, (Guid ConnectionId, string WorkspaceId, TaskCompletionSource<bool> Completion)> pendingSettings = [];
    private readonly HashSet<string> settingsDialogs = [];
    private readonly HashSet<string> helpDialogs = [];
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private const int exitGrace = TimingSettings.DefaultExitGraceSeconds;
    private bool keepAlive;
    private DateTimeOffset? emptySince = DateTimeOffset.UtcNow;
    private bool quitting;
    private readonly IconCleanupResult? cleanup;
    public TrayContext(string pipeName, bool keepAlive, IconAppearance? appearance = null, IconCleanupResult? cleanup = null)
    {
        this.cleanup = cleanup;
        this.appearance = appearance ?? new IconAppearance();
        this.keepAlive = keepAlive; dispatcher.CreateControl();
        server = new PipeServer(pipeName);
        server.MessageReceived += (connection, message) => Dispatch(() => Receive(connection, message));
        server.Disconnected += connectionId => Dispatch(() => { foreach (var id in registry.RemoveConnection(connectionId)) RemoveIcon(id); UpdateAssociations(); });
        server.Start(); timer.Tick += (_, _) => Tick(); timer.Start();
    }
    private void Dispatch(Action action)
    {
        if (quitting || dispatcher.IsDisposed) return;
        try { dispatcher.BeginInvoke(action); } catch (InvalidOperationException) { /* UI shutting down */ }
    }
    private async void Receive(PipeConnection connection, ClientMessage message)
    {
        if (message.Type == "disconnect") { if (registry.Remove(message.WorkspaceId!, connection.Id)) RemoveIcon(message.WorkspaceId!); UpdateAssociations(); return; }
        if (message.Type == "focus_result")
        {
            if (message.RequestId is { } requestId && pendingFocus.TryGetValue(requestId, out var pending) && pending.ConnectionId == connection.Id && pending.WorkspaceId == message.WorkspaceId) pending.Completion.TrySetResult(message.Focused);
            return;
        }
        if (message.Type == "configuration_result")
        {
            if (message.RequestId is { } requestId && pendingSettings.TryGetValue(requestId, out var pending) && pending.ConnectionId == connection.Id && pending.WorkspaceId == message.WorkspaceId)
                pending.Completion.TrySetResult(message.Success == true);
            return;
        }
        if (message.Type == "restart_tray") { _ = QuitAsync("restart"); return; }
        if (message.Type is "diagnostics" or "request_focus")
        {
            var target = registry.Get(message.WorkspaceId!);
            if (target is null || target.ConnectionId != connection.Id) return;
            bool? focusSucceeded = message.Type == "request_focus" ? await FocusWorkspace(message.WorkspaceId!) : null;
            var targetIcon = icons.GetValueOrDefault(message.WorkspaceId!);
            _ = server.SendAsync(connection.Id, new { version = 1, type = "diagnostics", request_id = message.RequestId, connected_count = registry.Entries.Count, icon_visible = targetIcon?.Visible == true, icon_guid = targetIcon?.Identity, executable_path = Environment.ProcessPath, icon_history_cleanup = cleanup, state = target.Snapshot.State, reason = target.Snapshot.Reason, status_text = TrayPresentation.SnapshotText(target.Snapshot), tooltip = targetIcon?.Text, label = target.Workspace.Label, extension_version = target.ExtensionVersion, location = target.Location, bridge_version = target.BridgeVersion, window_handle = focus.Resolve(message.WorkspaceId!, target.Workspace.WorkspaceName).ToString(), focus_succeeded = focusSucceeded, icon_style = IconStyles.Id(appearance.Style), icon_size = IconSizes.Id(appearance.Size), tray_version = SupportDiagnostics.Version, exit_grace_seconds = exitGrace, stale_working_minutes = target.Settings?.StaleWorkingMinutes, exit_when_no_windows = !keepAlive, language = UiText.Code, language_preference = UiText.Preference, notifications_enabled = notificationsEnabled, notifications_sent = notificationsSent.GetValueOrDefault(message.WorkspaceId!), notification_sound = notificationSound });
            return;
        }
        var previous = registry.Get(message.Workspace!.WorkspaceId);
        if (!registry.Update(message, connection.Id, connection.ClientPid, DateTimeOffset.UtcNow)) return;
        if (previous is not null && previous.ConnectionId != connection.Id) server.Disconnect(previous.ConnectionId);
        emptySince = null;
        var entry = registry.Get(message.Workspace!.WorkspaceId)!;
        if (entry.Settings is { ConfigurationVersion: >= 5, NotificationsEnabled: { } enabled } && enabled != notificationsEnabled) {
            notificationsEnabled = enabled;
            if (!enabled) { pendingNotifications.Clear(); foreach (var audio in notificationAudio.Values) audio.Disable(); }
        }
        if (entry.Settings is { ConfigurationVersion: >= 6 } soundSettings)
            SelectNotificationSound(soundSettings.NotificationSound, soundSettings.NotificationSoundFile);
        if (entry.Settings is { ConfigurationVersion: >= 3 } localized && (previous?.Settings is null || previous.Settings.Language != localized.Language) && UiText.Select(localized.Language))
            foreach (var other in registry.Entries) UpdateIcon(other);
        if (entry.Settings is { } settings && (previous?.Settings is null || previous.Settings.ExitWhenNoWindows != settings.ExitWhenNoWindows))
        {
            keepAlive = !settings.ExitWhenNoWindows;
            foreach (var other in registry.Entries) UpdateIcon(other);
        }
        var notification = NotificationTransition.Detect(previous, entry, message.Type, notificationsEnabled, registry.IsAmbiguous(entry));
        if (notification is { } kind) pendingNotifications[entry.Workspace.WorkspaceId] = (kind, entry.Snapshot);
        focus.Observe(entry); UpdateIcon(entry);
        _ = server.SendAsync(connection.Id, new { version = 1, type = "welcome", server_pid = Environment.ProcessId, language = UiText.Code });
        UpdateAssociations();
    }
    private void UpdateAssociations()
    {
        foreach (var entry in registry.Entries)
            _ = server.SendAsync(entry.ConnectionId, new { version = 1, type = "association", ambiguous = registry.IsAmbiguous(entry) });
    }
    private void UpdateIcon(WorkspaceEntry entry)
    {
        var id = entry.Workspace.WorkspaceId;
        if (visuals.TryGetValue(id, out var existingVisual) && existingVisual.MenuOpen) return;
        var guid = iconIdentities.Assign(entry.Workspace);
        if (icons.TryGetValue(id, out var existing) && existing.Identity != guid)
        {
            DisposeIcon(id);
        }
        if (!icons.TryGetValue(id, out var icon))
        {
            icon = new StableNotifyIcon(guid); icon.MouseClick += (_, args) => { if (args.Button == MouseButtons.Left) _ = FocusWorkspace(id); };
            var audio = new NotificationSoundPlayback(); notificationAudio[id] = audio;
            icon.BalloonTipShown += (_, _) => audio.Shown();
            icon.BalloonTipClosed += (_, _) => audio.Closed();
            icon.BalloonTipClicked += (_, _) => { audio.Closed(); _ = FocusWorkspace(id); };
            icons[id] = icon;
            visuals[id] = new TrayVisualState();
        }
        var visual = visuals[id];
        if (visual.MenuOpen) return;
        var key = $"{entry.Workspace.Label}/{entry.Snapshot.State}/{appearance.Style}/{appearance.Size}/{lightTaskbar}";
        if (visual.SetIcon(key))
        {
            var old = icon.Icon; icon.Icon = IconRenderer.Create(entry.Workspace.Label, entry.Snapshot.State, appearance.Style, lightTaskbar, appearance.Size); old?.Dispose();
        }
        var text = TrayPresentation.Tooltip(entry, DateTimeOffset.UtcNow);
        if (visual.SetTooltip(text)) icon.Text = text;
        if (visual.SetMenu(TrayVisualState.MenuKey(entry, appearance.Style, appearance.Size, exitGrace)))
        {
            var menu = TrayPresentation.CreateMenu(entry, () => { _ = FocusWorkspace(id); }, appearance.Style, style => Dispatch(() => SelectStyle(style)), appearance.Size, size => Dispatch(() => SelectSize(size)), () => Dispatch(() => OpenSettings(id)), () => Dispatch(() => OpenHelp(id)));
            menu.Opening += (_, _) => visual.MenuOpen = true;
            menu.Closed += (_, _) => {
                visual.MenuOpen = false;
                // Avoid disposing a menu inside its own Closed event/click dispatch.
                Dispatch(() => { if (registry.Get(id) is { } current) UpdateIcon(current); });
            };
            var oldMenu = icon.ContextMenuStrip; icon.ContextMenuStrip = menu; oldMenu?.Dispose();
        }
        if (!icon.Visible) icon.Visible = true;
        ShowPendingNotification(entry, icon);
    }
    private void ShowPendingNotification(WorkspaceEntry entry, StableNotifyIcon icon)
    {
        var id = entry.Workspace.WorkspaceId;
        if (!pendingNotifications.Remove(id, out var pending) || !notificationsEnabled || pending.Snapshot != entry.Snapshot || registry.IsAmbiguous(entry)) return;
        var text = TaskNotificationText.Create(pending.Kind, entry.Workspace);
        if (ShowNotification(id, text.Title, text.Body, text.Icon, notificationSound, notificationSoundFile))
            notificationsSent[id] = notificationsSent.GetValueOrDefault(id) + 1;
    }
    private bool ShowNotification(string id, string title, string body, ToolTipIcon kind, string mode, string file)
    {
        if (!icons.TryGetValue(id, out var icon) || !icon.Visible || !notificationAudio.TryGetValue(id, out var audio)) return false;
        audio.Prepare(mode, file);
        var sent = icon.ShowBalloonTip(10000, title, body, kind, silent: mode != "windows");
        if (!sent) audio.Closed();
        return sent;
    }
    private void SelectNotificationSound(string mode, string file)
    {
        if (mode == notificationSound && file == notificationSoundFile) return;
        foreach (var audio in notificationAudio.Values) audio.Disable();
        notificationSound = mode; notificationSoundFile = file;
    }
    private void SelectStyle(IconStyle style)
    {
        RefreshAppearance(appearance.Select(style), UiText.Get("notify.style"));
    }
    private void SelectSize(IconSize size)
    {
        RefreshAppearance(appearance.SelectSize(size), UiText.Get("notify.size"));
    }
    private void RefreshAppearance(bool saved, string setting)
    {
        foreach (var entry in registry.Entries) UpdateIcon(entry);
        if (!saved && icons.Values.FirstOrDefault() is { } icon)
            icon.ShowBalloonTip(4000, "Codex Status Icons", UiText.Get("notify.preference_failure", setting), ToolTipIcon.Info);
    }
    private void OpenSettings(string id)
    {
        var entry = registry.Get(id);
        if (entry?.Settings is not { ConfigurationVersion: >= 3 } || !settingsDialogs.Add(id)) return;
        try {
            var initial = entry.Settings with { ExitGraceSeconds = exitGrace, Language = UiText.Preference, NotificationsEnabled = notificationsEnabled, NotificationSound = notificationSound, NotificationSoundFile = notificationSoundFile };
            using var dialog = new TimingSettingsDialog(entry.Workspace.WorkspaceName, entry.Workspace.WorkspaceRoots.Length > 0, initial,
                selected => SaveSettings(id, entry.ConnectionId, initial, selected),
                (mode, file) => ShowNotification(id, UiText.Get("sound.test_title"), UiText.Get("sound.test_body"), ToolTipIcon.Info, mode, file));
            dialog.ShowDialog();
        }
        finally { settingsDialogs.Remove(id); }
    }
    private async Task<bool> SaveSettings(string id, Guid connectionId, TimingSettings initial, TimingSettings selected)
    {
        var entry = registry.Get(id);
        if (!selected.Valid || entry is null || entry.ConnectionId != connectionId || entry.Settings is not { ConfigurationVersion: >= 3 } || pendingSettings.Values.Any(pending => pending.WorkspaceId == id)) return false;
        var changes = new Dictionary<string, object>();
        if (selected.StaleWorkingMinutes != initial.StaleWorkingMinutes) changes["stale_working_minutes"] = selected.StaleWorkingMinutes;
        if (selected.Language != initial.Language) changes["language"] = selected.Language;
        if (selected.WorkspaceLabel != initial.WorkspaceLabel) {
            if (entry.Settings.ConfigurationVersion < 4 || !TimingSettings.ValidLabel(selected.WorkspaceLabel)) return false;
            changes["workspace_label"] = selected.WorkspaceLabel;
        }
        if (selected.NotificationsEnabled != initial.NotificationsEnabled) {
            if (entry.Settings.ConfigurationVersion < 5 || selected.NotificationsEnabled is null) return false;
            changes["notifications_enabled"] = selected.NotificationsEnabled.Value;
        }
        if (selected.NotificationSound != initial.NotificationSound || selected.NotificationSoundFile != initial.NotificationSoundFile) {
            if (entry.Settings.ConfigurationVersion < 7) return false;
            changes["notification_sound"] = selected.NotificationSound;
            changes["notification_sound_file"] = selected.NotificationSoundFile;
        }
        if (changes.Count == 0) return true;
        var requestId = Guid.NewGuid().ToString();
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        pendingSettings[requestId] = (entry.ConnectionId, id, completion);
        var saved = false;
        try
        {
            // A single request avoids replacing the window transport between two writes.
            await server.SendAsync(entry.ConnectionId, new { version = 1, type = "configure_settings", request_id = requestId, changes });
            saved = await Task.WhenAny(completion.Task, Task.Delay(20000)) == completion.Task && await completion.Task;
        }
        finally { pendingSettings.Remove(requestId); }
        if (quitting) return false;
        if (saved)
        {
            if (changes.ContainsKey("language")) UiText.Select(selected.Language);
            if (changes.ContainsKey("notifications_enabled")) {
                notificationsEnabled = selected.NotificationsEnabled!.Value;
                if (!notificationsEnabled) { pendingNotifications.Clear(); foreach (var audio in notificationAudio.Values) audio.Disable(); }
            }
            if (changes.ContainsKey("notification_sound")) SelectNotificationSound(selected.NotificationSound, selected.NotificationSoundFile);
            foreach (var other in registry.Entries) UpdateIcon(other);
            await server.BroadcastAsync(new { version = 1, type = "welcome", server_pid = Environment.ProcessId, language = UiText.Code });
        }
        return saved;
    }
    private void OpenHelp(string id)
    {
        var entry = registry.Get(id);
        if (entry is null || !helpDialogs.Add(id)) return;
        try {
            using var dialog = new HelpDialog(entry, () => {
                var current = registry.Get(id) ?? entry with { Snapshot = new("unknown", "window_disconnected", "none") };
                var icon = icons.GetValueOrDefault(id);
                return SupportDiagnostics.Build(current, registry.Entries.Count, icon?.Visible == true, icon?.Identity, IconStyles.Id(appearance.Style), IconSizes.Id(appearance.Size), notificationsEnabled, notificationsSent.GetValueOrDefault(id), notificationSound);
            });
            dialog.ShowDialog();
        }
        finally { helpDialogs.Remove(id); }
    }
    private async Task<bool> FocusWorkspace(string id)
    {
        var entry = registry.Get(id); if (entry is null) return false;
        var succeeded = focus.Focus(id, entry.Workspace.WorkspaceName);
        // Always confirm with the window host: Win32 can return before VS Code
        // delivers its focus event, and a positive call alone is not an acknowledgement.
        {
            var requestId = Guid.NewGuid().ToString();
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            pendingFocus[requestId] = (entry.ConnectionId, id, completion);
            try
            {
                await server.SendAsync(entry.ConnectionId, new { version = 1, type = "focus", request_id = requestId });
                var finished = await Task.WhenAny(completion.Task, Task.Delay(2000));
                succeeded = finished == completion.Task && await completion.Task;
            }
            finally { pendingFocus.Remove(requestId); }
        }
        if (quitting) return succeeded;
        if (!succeeded && icons.TryGetValue(id, out var icon)) icon.ShowBalloonTip(4000, "Codex Status Icons", UiText.Get("notify.focus_failure"), ToolTipIcon.Info);
        return succeeded;
    }
    private void RemoveIcon(string id)
    {
        pendingNotifications.Remove(id); notificationsSent.Remove(id);
        focus.Remove(id); iconIdentities.Remove(id); DisposeIcon(id);
        if (registry.Entries.Count == 0) emptySince ??= DateTimeOffset.UtcNow;
    }
    private void DisposeIcon(string id)
    {
        visuals.Remove(id);
        if (notificationAudio.Remove(id, out var audio)) audio.Dispose();
        if (icons.Remove(id, out var icon)) { icon.Visible = false; var image = icon.Icon; var menu = icon.ContextMenuStrip; icon.Dispose(); image?.Dispose(); menu?.Dispose(); }
    }
    private void Tick()
    {
        var now = DateTimeOffset.UtcNow;
        var nextTheme = IconStyles.LightTaskbar();
        if (nextTheme != lightTaskbar) { lightTaskbar = nextTheme; foreach (var entry in registry.Entries) UpdateIcon(entry); }
        var beforeExpiry = registry.Entries.ToDictionary(entry => entry.Workspace.WorkspaceId, entry => entry.ConnectionId);
        var expired = registry.Expire(now);
        foreach (var id in expired) { RemoveIcon(id); server.Disconnect(beforeExpiry[id]); }
        if (expired.Length > 0) UpdateAssociations();
        foreach (var entry in registry.Entries) UpdateIcon(entry);
        if (!keepAlive && registry.Entries.Count == 0 && emptySince is { } since && (now - since).TotalSeconds >= exitGrace) { _ = QuitAsync("no_windows"); }
    }
    private async Task QuitAsync(string reason)
    {
        if (quitting) return; quitting = true; timer.Stop();
        if (reason == "restart") await server.BroadcastAsync(new { version = 1, type = "shutdown", reason });
        await server.DisposeAsync();
        foreach (var id in icons.Keys.ToArray()) RemoveIcon(id);
        ExitThread();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { timer.Dispose(); dispatcher.Dispose(); }
        base.Dispose(disposing);
    }
}
